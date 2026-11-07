# tgt2403 订单鉴权模型 / API 契约 / 订单号格式

> 适用：任何跑 **tgt2403** 的发卡站（页面标题常见「XX姐姐」之类白标，前端模板 vault，
> openresty 前置，`/api/v1` 前缀）。本条目用于**快速判定订单越权方向是否值得投入**，
> 避免在已被产品正确实现的地方反复试探。

## 0. 一句话结论

tgt2403 的订单读取在 SQL 层强制绑定身份，**`/orders/{order_no}` 与
`/guest/orders/{order_no}` 都不是 IDOR**；游客口令是服务端密钥参与的 HMAC-SHA256 摘要。
别在这里浪费时间，直接换面。

## 1. 30 秒判定线上版本

```bash
curl -s --noproxy "*" https://SITE/api/v1/public/config -H 'User-Agent: Mozilla/5.0' | \
  python -c "import sys,json;print(json.load(sys.stdin)['data']['app_version'])"
```

`data.app_version` 就是部署版本（例：`example.com`）。**拿到版本后必须按该 tag 读源码**
（`https://raw.githubusercontent.com/tgt2403/tgt2403/<tag>/<path>`），
不要用 HEAD 下结论 —— 这个产品 1.x 期间陆续加固过游客凭据。

`/public/config` 同时能白嫖到：`registration_enabled`、`email_verification_enabled`、
`captcha.provider`（`none` 即注册无验证码）、`allowed_email_domains`、`smtp_enabled`、
`payment_channels`、`storefront_template`、`tenant`、`brand`。

## 2. 接口契约（base = `/api/v1`）

用户（`Authorization: Bearer <JWT>`）
```
POST /orders/preview          POST /orders            POST /orders/create-and-pay
GET  /orders                  GET  /orders/stats      GET  /orders/{order_no}
GET  /orders/{order_no}/fulfillment/download          POST /orders/{order_no}/cancel
POST /order/payment-channels
```
游客（`Authorization: Guest base64url(email + "\n" + order_password)`，**不接受 query 传凭据**）
```
POST /guest/orders/preview    POST /guest/orders      POST /guest/orders/create-and-pay
GET  /guest/orders            GET  /guest/orders/{order_no}
GET  /guest/orders/{order_no}/fulfillment/download
POST /guest/payments          POST /guest/payments/{order_no}/capture   GET /guest/payments/latest
```
公开：`/public/{config,banners,categories,products}`

其它模块（同一 API 前缀）：`/auth/{register,login,login/verify-2fa,forgot-password,send-verify-code,google/*,telegram/*}`、
`/me/{2fa/*,affiliate,api,gift-cards,orders,profile,reseller,security,wallet}`、`/reseller/*`。

## 3. 鉴权模型（example.com 实测源码）

`internal/modules/order/infrastructure/gormstore/order_store.go`
```go
// 用户侧：user_id 来自会话，参数无法替换
WHERE order_no = ? AND user_id = ? AND parent_id IS NULL              // GetByOrderNoAndUserScoped
WHERE user_id = ? AND parent_id IS NULL                               // ListByUserScoped / StatsByUserScoped
// 游客侧：邮箱 + 口令摘要必须同时命中
WHERE order_no = ? AND user_id = 0 AND guest_email = ? AND guest_password = ? AND parent_id IS NULL
// 摘要算法（不是 MD5、不是明文，跨站不可复用）
guest_password = "hmac-sha256:" + hex(HMAC_SHA256(server_secret, lower(email) || 0x00 || password))
```
`internal/modules/order/transport/http/user_handler.go`：`uid, _ := ginutil.GetUserID(c)`；
query 里只有 `status`、`order_no`（`order_no` 走 `LIKE %x%`，但仍在 `user_id = ?` 之内）会被使用。
`internal/platform/http/ginutil/guest_auth.go`：`Guest ` 前缀 + base64url(`email\npassword`)，
任一字段为空直接 `ok=false`（**这条源码分支可以当线上指纹用**：对「邮箱非空 + 口令为空」的请求，
真实回包是 `error.guest_email_required`（"游客邮箱不能为空"）而不是 "口令不能为空"）。

## 4. 订单号格式

`internal/shared/serial/serial.go`
```go
func Generate(prefix string) string {
    return fmt.Sprintf("%s%s%s", prefix, time.Now().Format("20060102150405"), randomNumeric(6))
}
```
* 订单：`DJ` + `YYYYMMDDHHMMSS` + 6 位随机数字（22 位）
* 支付网关流水：`DJP...`；钱包充值：`WR...`
* 即使知道格式：6 位独立随机 + 必须同时匹配身份 → **枚举无收益，不要扫**。

## 5. 运行时探测模板（判定是否可越权）

```bash
B64=$(python -c "import base64;print(base64.urlsafe_b64encode('a@b.c\nPw123456'.encode()).decode().rstrip('='))")
curl -s --noproxy "*" -H 'User-Agent: Mozilla/5.0' -H "Authorization: Guest $B64" \
  https://SITE/api/v1/guest/orders/1
# 期望：{"status_code":404,"msg":"未找到匹配的游客订单",...}  ← 有匹配语义，说明绑定了多个字段
curl -s --noproxy "*" -H 'User-Agent: Mozilla/5.0' https://SITE/api/v1/orders/1
# 期望：{"status_code":401,"msg":"缺少 Authorization header"}
# 无凭据但邮箱非空、口令为空：回包应为 "游客邮箱不能为空"（源码指纹，见 §3）
```
注意：该 API 的错误一律包在 **HTTP 200** 里，判业务成败要看 `status_code`。

## 6. 判定表

| 观察 | 含义 |
|---|---|
| `错误信封为 HTTP 200 + status_code` | 正常设计，不要据此误判"未授权可访问" |
| 无凭据 `GET /orders/{no}` → 401 | 已鉴权 |
| `GET /guest/orders/{no}` 有凭据但订单不存在 → 404 "未找到匹配的游客订单" | 多字段匹配，IDOR 基本无戏 |
| `?email=` 形式传邮箱被忽略 | 凭据只走 header（example.com 起） |
| 任意 Origin 只回 `Access-Control-Allow-Credentials: true` 而不回 `Allow-Origin` | CORS **不可**跨源读，别当成漏洞报 |

## 7. 真正值得换去的方向

`/me/*` 用户中心、`/reseller/*` 分销控制台（前端 chunk 明明白白有 ResellerFinance /
ResellerWithdraws / ResellerDomains / ResellerSiteConfig，普通用户能否越权进入值得一试）、
`/auth/register` 开放注册 + 验证码逻辑（注意 captcha 为 none 时无风控）、
以及白标站之间的凭据复用（同一运营方常多站同库）。
