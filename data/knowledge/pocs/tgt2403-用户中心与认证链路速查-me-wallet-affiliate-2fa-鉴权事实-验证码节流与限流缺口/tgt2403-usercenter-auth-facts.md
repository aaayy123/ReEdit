# tgt2403：用户中心与认证链路的鉴权事实（example.com 源码实测）

> 配套条目：见知识库里的「tgt2403 发卡系统 订单鉴权模型…速查」（订单/游客订单/订单号格式）。
> 本条补上另一半：**/me/*、wallet、affiliate、gift-cards、api-credential、2FA 与 /auth/* 认证链路**。
> 结论先行：**这一整套用户态面在设计上就不存在「按他人标识查数据」的入口，别再投入。**

## 1. 一句话结论

tgt2403 的用户态端点全部以会话 uid 为准（`uid, ok := ginutil.GetUserID(c)`），
路由表里**根本不存在接收目标用户标识的端点**（没有 `/users/:id` 式用户态接口），
2FA 第二步的身份取自**签名的挑战令牌**而不是请求体参数。
→ 用户态越权（IDOR）与 2FA 绕过都无面可打；唯一值得记的是**认证端点缺少路由级限流**。

## 2. 用户态路由全集（example.com）

```
identity/userauth  GET /me · PUT /me/profile · PUT /me/password
                   POST /me/email/{send-verify-code,change}
                   GET  /me/2fa/status · POST /me/2fa/{setup,enable,disable,recovery-codes/regenerate}
                   GET  /me/telegram · POST /me/telegram/{bind,miniapp/bind} · DELETE /me/telegram/unbind
                   GET  /me/google · POST /me/google/{bind,redirect/intent,redirect/exchange} · DELETE /me/google/unbind
wallet             GET /wallet · /wallet/transactions · /wallet/recharges · /wallet/recharges/stats
                   GET /wallet/recharges/{recharge_no} · POST /wallet/{payment-channels,recharge}
                   POST /wallet/recharge/payments/{id}/capture
affiliate          POST /affiliate/open · GET /affiliate/{dashboard,commissions,withdraws} · POST /affiliate/withdraws
                   （公开埋点 POST /affiliate/click）
giftcard           仅用户侧 Redeem（POST，按 code 兑换，挂 captcha 场景 gift_card_redeem）
apicredential      GET /api-credential · POST /api-credential/{apply,regenerate} · PUT /api-credential/status
admin（勿混）      /admin/users/:id/wallet*、/admin/api-credentials/:id*、/admin/affiliates/users/:id/*、/api-credentials/:id/*
```
注意：`/wallet`、`/affiliate` 等**不带 /me 前缀**（是 `/api/v1/wallet`、`/api/v1/affiliate/...`）；
`/me/profile` 只有 PUT，用 GET 会 404（别当成"接口不存在"）。

## 3. 逐个的身份收窄方式（为什么打不通）

| 面 | 是否收窄 | 证据 |
|---|---|---|
| 订单/游客订单 | 是 | `WHERE order_no=? AND user_id=?`、`...guest_email=? AND guest_password=?` |
| wallet 提现/充值 | 是 | 带 id 的方法**同时收 uid**：`GetRechargeOrderByRechargeNo(uid, no)`、`GetRechargeOrderByPaymentIDAndUser(pid, uid)` |
| affiliate | 无 id 参数 | 只有 dashboard/commissions/withdraws 这类"我的"视角 |
| giftcard | uid + code | code 本身即凭据（设计如此）；用户侧无「列出全部卡」接口 |
| api-credential | 无 id | `GetMy*/RegenerateMy*/UpdateMy*`；带 :id 的全在 admin |
| **2FA 第二步** | 身份来自签名令牌 | 请求体只有 `{challenge_token, code, recovery_code}`，**没有 user_id** |

## 4. 2FA 实现细节（想找绕过的看这里，example.com 无绕过）

```go
// transport/http/user_2fa_handler.go
type VerifyUser2FARequest struct {
    ChallengeToken string `json:"challenge_token" binding:"required"`
    Code           string `json:"code"`
    RecoveryCode   string `json:"recovery_code"`
}
claims, err := h.auth.ParseUserChallengeToken(req.ChallengeToken)   // ← 身份只从这里来
...
h.auth.CompleteLoginAfter2FA(claims.UserID, claims.RememberMe)
```
* 挑战令牌校验 `purpose=2fa` 且 `typ=2fa_challenge`（防止被当普通 access token 用）；
* JTI 一次性：成功即 `Revoke`；失败累计 5 次即 `Revoke`（`userChallengeMaxFailures = 5`）；
* `DisableUser2FA` 必须带 `code` 或 `recovery_code`（不能裸关）；`RegenerateRecoveryCodes` 必须带 `code`。

## 5. 认证链路与限流（真正值得记的一条）

**注册/登录验证码的三重保护（都在 service 层）**：
* 发码间隔：同一 `(email, purpose)` 距上次发送 < `Email.VerifyCode.SendIntervalSeconds`（默认 **60s**）→ `ErrVerifyCodeTooFrequent`；
* 尝试次数：错误码 `IncrementAttempt`，`AttemptCount >= MaxAttempts`（默认 **5**）→ `ErrVerifyCodeAttemptsExceeded`；
* 注册强校验：`Register()` 在 `emailVerificationEnabled=true` 时显式 `verifyCode(email,"register",code)`；
  `LoginStep1` 还要求 `EmailVerifiedAt != nil` → **不存在免码注册/登录的旁路**；
* 登录抗时序枚举：账号不存在时先做一次 dummy bcrypt 比较。

**缺口（low）**：路由注册表里只有 `/auth/login`、`/auth/login/verify-2fa` 挂了 rateLimit 中间件，
**`/auth/send-verify-code`、`/auth/register`、`/auth/forgot-password` 没有**（注册函数签名里根本没有 rateLimit 参数）。
由于业务层节流是**按邮箱**而非按 IP，攻击者可对大量不同地址各触发一封邮件 → **邮件轰炸 / SMTP 滥用**（发件方是站点自己，伤其发信信誉）。
叠加 `GET /api/v1/public/config` 里 `captcha.provider="none"`（所有场景 false）时无图形码挡刀。
> 实战提示：**只记录结论，不要真的去轰炸**；要实证就对两个自有邮箱各发一次，观察 60s 间隔是不是唯一屏障。

## 6. 快速自查脚本

```bash
# 无凭据矩阵：期望全部 401（业务码在 body 里，HTTP 仍是 200）
for p in /me /me/2fa/status /wallet /wallet/transactions /wallet/recharges \
         /affiliate/dashboard /affiliate/commissions /api-credential \
         /admin/users/1/wallet /admin/api-credentials; do
  printf "%-30s " "$p"
  curl -s --noproxy "*" -H 'User-Agent: Mozilla/5.0' "https://SITE/api/v1$p" | head -c 120; echo
done
# 读配置看防护开关
curl -s --noproxy "*" -H 'User-Agent: Mozilla/5.0' https://SITE/api/v1/public/config \
  | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['app_version'], d['captcha'], d.get('email_verification_enabled'), d.get('smtp_enabled'))"
```
见 `401 {"status_code":401,"msg":"缺少 Authorization header"}` 就说明该面已鉴权，**别继续在用户态找 IDOR**；
把精力转到 `/reseller/*`（也已确认按 profile.ID 收窄）以外的地方 —— 例如 admin 分组、渠道 API（`/channel/*`）、支付回调、上游对接面。
