## 系统识别指纹（用于判定目标是否为 acg-faka）
前端 HTML/JS 特征（命中即判定为 acg-faka 异次元发卡）：
- Cookie 名 `ACG-SHOP`（JS: `var cookieName = 'ACG-SHOP'; var storageKey = 'Remember';`）
- 路由风格：`/user/api/<Controller>/<action>`（驼峰 action：`commodity` / `cardFormat/format` / `index/secret`）
- 登录/后台：`/user/authentication/login?goto=/user/dashboard/index`、`/user/index/query`
- 插件路由：`/plugin/SmmPanel/UserAction/precheck`、`/plugin/tgAutoAfterSale/api/status`
- 主题：Haocang（獒藏）系列，含 `hc-*` 前缀 CSS 类与 `Pay.trade(...)` 全局 JS 对象
- 典型主题文件：`/assets/static/haocang-translate.js`
> 注意：**不要**凭"发卡网 + 后台"就判成独角数卡/dujiaoka。dujiaoka 的路径是 `/user/api/*` 之外的一套（Laravel 版为 `/order/create`、`/pay/checkout/{orderSN}`），dcat-admin 版后台在 `/admin`。两者前端 cookie 与路由风格完全不同。

## 官方源码与权威判定基准
- 仓库：`https://github.com/lizhipay/acg-faka`（默认分支 main）
- 免登录接口所在类：`app/Controller/User/Api/Index.php`
  类注解 `#[Interceptor([Waf::class, UserVisitor::class])]` —— **`UserVisitor` 只做访客识别，不是登录墙**，所以 `User\Api\Index` 下所有 action（`commodity`/`commodityDetail`/`card`/`valuation`/`stock`/`pay`/`query`/`secret`/`data`）**均为免登录设计**。
- 关键文件：`app/Entity/Query/Get.php`（`setFilterColumns()` 列白名单，其注释记载了历史漏洞）

## ① /user/api/index/secret —— 取卡密（判定：**设计如此，非可利用越权**）
```php
$tradeNo  = trim((string)$this->request->post("tradeNo",  flags: Filter::NORMAL));  // ※ 参数名是 tradeNo
$password = (string)$this->request->post("password", flags: Filter::NORMAL);
if (Throttle::tooMany("secret:ip:{$ip}", 40, 600)
    || Throttle::tooMany("secret:no:{$tradeNo}:{$ip}", 8, 600)) throw new JSONException("请求过于频繁，请稍后再试");
$order = Order::with(['commodity'])->where("trade_no", $tradeNo)->first();   // 无 where('user_id',...) 归属校验
if (!$order) throw new JSONException("未查询到相关信息");
if (!empty($order->password)) {   // 订单设了"查单密码"才校验，hash_equals 常量时间比较
    if (!hash_equals($order->password, $password) && !hash_equals($order->password, $legacyPassword))
        throw new JSONException("密码错误");
}
if ($order->status != 1) throw new JSONException("订单还未支付");
return $this->json(data: ['secret' => $order->secret, 'widget' => $widget, 'leave_message' => ...]);
```
**结论口径**：接口确实不做买家归属校验（凭订单号取货，等价取货码模型），但访问控制实质有效 ——
① `trade_no` = **18 位纯数字**（同控制器 `query()` 用 `preg_match('/^\d{18}$/')` 分支证实）→ 枚举空间 10^18；
② 硬限流 `secret:ip` 40 次/600s + `secret:no:{trade_no}` 8 次/600s（≈每天 ≤5760 次）；
③ 订单若设查单密码则强校验。
→ **不可判为 critical**。仅"自己下单拿自己的 orderId 再查"不构成越权（只证明能读自己的订单）。

## ② /user/api/index/query —— 订单查询（可能返回他人 secret，但被图形验证码挡住）
```php
$keywords = trim((string)$this->request->post("keywords", flags: Filter::NORMAL));
if (Throttle::tooMany("query:ip:" . Client::getAddress(), 30, 600)) throw new JSONException("请求过于频繁，请稍后再试");
$get->setColumn('id','trade_no','sku','secret','user_id','password','amount',...);
if (preg_match('/^\d{18}$/', $keywords)) { $builder = $builder->where("trade_no", $keywords); }
else { $builder = $builder->whereIn("contact", $keywordsCandidates); }   // 按联系方式查
// 出口处理：status != 1 → unset(secret)；订单有 password → 把 password 置 true 并 unset(secret)
```
**判定**：按 `contact`（买家联系方式）即可查到订单并**在未设查单密码时回吐 `secret` 明文**。官方 main 的 `query()` **源码中没有 captcha 校验**，但实测目标站点**服务端强制校验图形验证码**（无 captcha / `0000` / 空 / `0` 四种全部返回「验证码错误」）→ 站点版本叠加了 captcha 或旧版行为，此路在当前目标不通。**这是本接口唯一可能的突破点，需先解决验证码。**

## ③ /user/api/index/commodity —— 商品全量列表（实测未授权可读）
`POST /user/api/index/commodity` body `page=1`（无 Cookie）→ 单次即返回全站商品（实测 9,608 条 / 1.82 MB），字段含 `id/name/price/stock/card_count/category/owner/status/hide/delivery_way`。
源码侧注释已说明 `limit=0` 为"返回全部"的既有约定，`limit` 为负会被归 0（旧版会 `take(-N)` 触发 500）。

## ④ /user/api/index/card —— 预选库存列表（**历史高危：列过滤布尔预言机，可匿名盲注未售卡密 secret**）
`app/Entity/Query/Get.php::setFilterColumns()` 的注释原文：
> 用于**匿名/低权限**接口：客户端能任意指定过滤列时，`total` 的 0/1 就是一个布尔预言机——攻击者用 `search-secret` / `betweenStart-secret` 之类逐字符盲注，能把未售卡密的 secret 拖出来。
客户端过滤条件格式为 **`<操作符>-<列名>`**，如 `search-secret`、`betweenStart-secret`、`equal-owner`。
- **旧版（无 `setFilterColumns(['draft'])` 白名单）**：`POST /user/api/index/card` body `item_id=<id>&page=1&limit=1&search-secret=<猜测>` → 用 `total` 的 0/1 作预言机逐字符拖出未售卡密。
- **新版已修**：`card()` 里 `$get->setFilterColumns(['draft'])` 只放行 draft 列 → 其余列静默丢弃。
- 同文件还记载另一类：`setWhere()` 里对归一化撞名的键（`equal-owner` 与 `equal-owner·1`、编码别名 `%C2%B7`）直接抛「查询条件存在冲突的参数名」，防 CWE-639 越权覆盖。
**实测提示**：`card()` 要求商品 `draft_status == 1`（支持预选），否则回「该商品暂不支持预选」；商品不存在回「商品不存在」。

## 通用探测要点（踩过的坑）
1. `secret` 的参数名是 **`tradeNo`**；`card` 的是 **`item_id`**；`query` 的是 **`keywords`**。传错参数名服务端不报参数缺失错误，而是统一回「未查询到相关信息」——**不要据此下"参数名无关"的结论**，必须回源码确认。
2. 本平台机器若存在 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量，python `urllib` 会默认走代理，导致直连判定失真，必须 curl `--noproxy '*'` 或 `http.client` 直连。
3. 有限流：`secret` 40次/600s、`query` 30次/600s、`card`（draft:ip）60次/60s。**探测定性即可，不要枚举。**