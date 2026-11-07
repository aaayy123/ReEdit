# tgt2403 版本指纹 + 未修复安全补丁对照法

## 为什么用
tgt2403 是「独角数卡」的 Go 重写版（GitHub `tgt2403/tgt2403`，在线文档 target155.example.com），
发卡网圈部署量大。它**把精确版本号放在一个免认证接口里**，拿到版本号就能把 Nday 面从
「未知」压缩成「精确清单」—— 因为上游 changelog 把每个安全修复都写得很清楚。

## 第一步：取版本（零凭据）
```bash
curl.exe -sk --noproxy '*' -H "Host: <目标host>" https://<源站IP>/api/v1/public/config
```
响应 `{"status_code":0,"msg":"success","data":{"app_version":"v1.0.2",...}}`
→ `data.app_version` 即精确版本。

⚠️ 判据要点：该框架**所有响应都是 HTTP 200**，真实语义码在 `body.data.status_code`
（0=成功、400=参数校验、401=缺少 Authorization header、403=功能关闭、404=未找到、429=限流）。
按 HTTP 状态分类会得出「全部匿名可达」的错误结论。

其余高价值字段（同一响应内，零凭据）：
`registration_enabled`、`email_verification_enabled`、`captcha.provider` / `captcha.scenes.{login,register_send_code,reset_send_code,guest_create_order,gift_card_redeem}`、
`payment_channels`、`affiliate.enabled`、`brand.site_url`、`contact`。

## 第二步：拉上游 release 定版本差
```bash
curl -s "https://api.github.com/repos/tgt2403/tgt2403/releases?per_page=30"
```
按 `published_at` 排序定位目标版本，取它之后到 HEAD 的全部 changelog。

## 第三步：把 changelog 里「安全类」条目逐条实测可达性（关键，别只看不动手）
> **本方法是「发现」不是「判定」** —— changelog 说缺什么，不等于在目标上打得动。
> 每条都必须实测到「匿名能不能触达」，否则会把「代码里已修」误当「这里能打」。

已知 v1.0.2 之后落地的安全修复（实测清单，可直接复用于其它 tgt2403 站点）：

| 版本 | commit | 修复 | 攻击面 | 匿名可达性判据 |
|---|---|---|---|---|
| v1.4.8 | `19654a3` | 支付回调/上游回调/渠道 API/**礼品卡兑换**增加限流 | `POST /api/v1/gift-cards/redeem` 兑换码猜解 | 该端点需 token → 匿名 401；**拿到任意用户 token 后此项立刻成立，优先验证** |
| v1.4.8 | `bb3564f` | 取消订单事务内加锁复核状态、回滚优惠券、**游客订单密码最少 6 位** | 游客查单双要素被弱化 / 并发取消 | 需受害者订单三要素，不可自证 |
| v1.4.8 | `8d73eb7` | 下游回调客户端**只连公网地址且不跟随重定向** | 下游回调配置处 SSRF | 需 admin token |
| v1.4.8 | `2f870d5` | 网关验签改**常量时间比较并拒绝空密钥** | 时序/空密钥 | 需可用支付渠道 |
| v1.4.8 | `f517f12` | 上游回调状态机守卫、body 限 1MB、密钥解密失败直接拒绝 | 回调伪造 / DoS | 需渠道 API 凭据（`/api/v1/channel/*`，10 种凭据形态全 401） |
| v1.4.8 | `9f8579c` | 鉴权中间件只更新 last_used_at、限流 key 绑定来源 IP | 渠道 API 限流绕过 | 同上 |
| v1.4.8 | `393079a` | 注册与换绑邮箱拒绝 Telegram 占位邮箱 | 用 TG 占位邮箱批量注册 | 需 `telegram_auth.enabled=true`，未启用则不可达 |
| example.com | `47cc620` | **采购单归属校验：必须属于本次认证的连接** | 渠道 API IDOR 读他人采购单 | 认证在归属校验之前 → 需渠道凭据 |
| example.com | `ad9b7e2` | okpay 协议升 HMAC-SHA256（含 timestamp/nonce 防重放） | MD5 弱签名 + 无防重放 | 需 okpay 渠道 |
| v1.4.6 | `0407f2a` | 防止**并发下单绕过优惠券使用次数限制** | 券次数限制并发绕过 | 需登录态下单 |
| v1.4.6 | `f57247b` | 增强订单履约校验 | 履约/发卡校验 | 需真实下单支付 |
| v1.4.1 | `a7ba2c1` | epusdt 验签 MD5 → HMAC-SHA256 | 弱签名 | 需 epusdt 渠道 |
| v1.2.1 | `faacb3f` | 防止**邮件轰炸攻击** | `/api/v1/auth/send-verify-code`、`/forgot-password` | 先看 `email_verification_enabled`；为 false 时该端点返回 `403 邮箱验证功能已关闭` → 不可达 |
| v1.2.1 | `b1e527f` | Telegram OIDC **tgid 身份混淆** | TG 登录账号接管 | 需 TG 登录启用 |
| v1.0.4 | `51a43d8` | RFC 5322 通用邮件头 | 邮件头注入 | 需邮件功能开启 |
| v1.0.3 | `0c1f2aa` | 隐藏支付记录自增 id | 支付记录遍历 | 需登录态 |

## 第四步（顺带、零成本）：匿名面全量过一遍
```bash
# 接口清单从 SPA 抽：入口 bundle 的 __vite__mapDeps 展开全部 chunk，再提取
# (["'`]|\})/([A-Za-z][A-Za-z0-9_-]*(/[A-Za-z0-9_.{}$:-]*)*)["'`]
# baseURL 源码原文：Ta="/api/v1"（入口 bundle 内）
```
- 三个 API 模块给出权威契约：`assets/product-*.js`（公共）、`assets/order-*.js`（订单/游客）、`assets/wallet-*.js`（钱包/礼品卡）。
- 前端两个客户端：`Wn(!1)` = 无 token（`public/*`），`Wn(!0)` = 需 token（其余）。
- 判据：**匿名可达面应当正好等于无 token 客户端声明的集合**；出现越界才是漏洞。
- 免费命中（本项目实测）：`GET /api/v1/public/products` 免认证返回全站商品，**slug 形如
  `upstream-<上游站ID>-<上游商品ID>-<时间戳>` 直接泄露上游供应链映射**，且含
  `auto_stock_available` 与 SKU 级 `upstream_stock`（= 卡密库存总量）。`GET /api/v1/public/config` 泄露版本与全部风控开关。
- 值得实测的两处（本项目均为负结论，但值得在每个站点重测）：
  `POST /api/v1/guest/orders/preview`（游客可用的**价格计算**接口 → 试 14 个客户端价格字段 + 数量 0/负数/小数/超库存）；
  `GET /api/v1/guest/orders/{no}`（游客查单双要素）。
  注意：只有 `purchase_type=guest` 的商品能走游客流程，`member` 商品会返回「当前商品仅限会员购买」。

## 判定纪律
1. **HTTP 状态一律 200** → 必须读 `body.data.status_code`。
2. `401 缺少 Authorization header` 出现在**参数校验之前**（三种 body 返回逐字节相同的 401）→ 无未授权参数 oracle，别在该端点做盲探。
3. 登录限流按 **(email, IP)** 计数，不是 IP 级：**同一 email 第 6 次 → 429「登录尝试过多，请在 900 秒后重试」，换 email 立即回 401**。
   做枚举测试时必须给每个候选换新 email，否则会把自己的连打当成「响应差异 → 存在枚举」的假信号（本项目第一轮就踩过这个坑）。
4. 用户口令登录必须退避：先探明限流窗口再决定投入，别把 IP 打进 900 秒冷却。
