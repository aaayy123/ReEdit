## 1) 判定是 1Panel v2 且安全入口启用（不用猜字节数）
拉官方模板对比即可定论：
- v2 模板：`https://raw.githubusercontent.com/1Panel-dev/1Panel/dev-v2/core/cmd/server/res/html/200.html`（英文 "Access Temporarily Unavailable" + "…secure login access." + `1pctl user-info`）
- 同目录另有 `200_err_domain.html`（域名绑定）与 `200_err_ip_limit.html`（授权IP访问）——**三者的可见文案不同，可直接区分拦截原因**。
> 注意：`NoAuthSetting=200`（默认）时，**未登录的 API 也会返回同一个 200.html**，所以"看到 200.html"不等于"被安全入口拦"，要用下面的匿名路由来区分。

## 2) 安全入口的实现（v2，core/utils/security/security.go）
```go
func checkEntrance(c *gin.Context) bool {
	entrance := service.NewIAuthService().GetSecurityEntrance()   // 10 位随机串
	if entrance == "" { return true }
	cookieValue, err := c.Cookie("SecurityEntrance")              // ← 只看这个 cookie
	if err != nil { return false }
	entranceValue, err := base64.StdEncoding.DecodeString(cookieValue)
	if err != nil { return false }
	return string(entranceValue) == entrance
}
// CheckSecurity: if entrance != "" && !checkEntrance(c) && !checkSession(c) { 返回 200.html }
```
⇒ 绕过入口只有两条路：拿到 entrance（`1pctl user-info`，需 SSH）或已有合法会话。**XFF/Real-IP/Forwarded 等头无法伪造入口**（入口与 IP 无关）。

## 3) 真正免安全入口、免登录的路由（v2，core/middleware/session.go 的 isAnonymousAuthPath + 实测）
```
/api/v2/core/auth/captcha        GET  -> 200 {"captchaID":..,"imagePath":"data:image/png;base64,.."} + Set-Cookie panel_public_key
/api/v2/core/auth/setting        GET  -> 200 {"isDemo":..,"panelName":"1Panel","needCaptcha":true,"passkeySetting":..}
/api/v2/core/auth/welcome        GET  -> 200 {"code":200,"message":"success","data":null}
/api/v2/core/auth/login          POST
/api/v2/core/auth/{logout,mfalogin,passkey/begin,passkey/finish}
```
`/api/v2/core/dashboard/base/os`、`/api/v2/core/settings/base`、`/api/v2/*`（非 core）均不可用（200.html 或 401）。

## 4) 面板版本与"验证码是否可绕"的硬判据
- CVE-2025-66507（验证码绕过，`ignoreCaptcha:true`）：**< 2.0.14 才生效**；>=2.0.14 会返回 `{"code":401,"message":"ErrCaptchaCode"}`。
- CVE-2025-66508（XFF 伪造 ClientIP 绕 AllowIPs/API IP 白名单/**localhost-only**）：**< 2.0.14 才生效**。对**安全入口无效**，对 `AllowIPs`/`BindDomain` 有效（此时拦截页是 200_err_ip_limit/200_err_domain）。
- 判定法：`POST /api/v2/core/auth/login` 用正确三段式加密 + 错口令。
  - `ErrCaptchaCode` ⇒ 验证码未被绕过 ⇒ 已修复（>=2.0.14）⇒ **必须人工/OCR 解验证码**才能让口令被真实校验。
  - `ErrAuth` ⇒ 验证码已过、口令被判错；**这才是有效的口令审计**。

## 5) 三段式加密与提交体
见 KB `1panel-login-password-encryption-rsa-aes-3seg`（RSA 保护 32 hex 的 AES 密钥 + AES-256-CBC）。提交体：
```json
{"name":"1panel","password":"<rsa_b64>:<iv_b64>:<ct_b64>","ignoreCaptcha":false,"captcha":"<人工识别的4位>","captchaID":"<captchaID>","authMethod":"session","language":"zh"}
```
**空口令 → 400 参数校验错误；解密为空 → ErrAuth；验证码错 → ErrCaptchaCode。** 三种错误可区分，可用来定位卡在哪一步。

## 6) 验证码可人工识别（无需 OCR 库）
`/api/v2/core/auth/captcha` 的 `imagePath` 是 120×50 的 PNG（base64）。字符集为 `234567890abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ`（去掉了歧义字符），**区分大小写**，验证一次即失效（每次尝试都要新取一张）。实测把 data URI 落地成 png 后直接看图，识别正确率约 2/3；识别对了响应从 `ErrCaptchaCode` 变 `ErrAuth`。

## 7) 其它
- `LOCAL_REQUEST`（`core/middleware/ip_limit.go`）会让 `SessionAuth`/`BindDomain`/`CSRF`/`PasswordExpired` 全部放行，但它要求 `X-Panel-Local-Token` 头 + 本地 `GetRealClientIP`，**纯 XFF 伪造无效**（实测 swagger 路由加 XFF 仍 401）。
- 面板端口：**9527**（不是 10086）；不要只扫 top-1000，10086/8888 全落空。
