# 80 端口明文提供完整应用 + 全站缺失 HSTS（SSL-strip 利用面）

## 结论
- `http://<target>:80` 直接 `200 OK` 返回完整 SPA 与业务 API，**无 301/308**；
- HTTPS 侧所有响应**均无 `Strict-Transport-Security`**；
- http 与 https 是**同一应用**（首页正文等长、Etag/Server 相同、安全头一致），降级后功能无损，用户无察觉；
- 应用把 access_token / refresh_token 存 localStorage 并以相对 origin 调 API，令牌对同源 JS 可读 ⇒ 明文信道下可被中间人直接取走。

## 影响
1. SSL-strip / 协议降级：浏览器首次以 `http://` 进入后没有任何升级信号，登录口令、Bearer、refresh_token 全程明文。
2. 同网段攻击者（ARP 欺骗 / 恶意热点 / 上游代理）即可拿到一次性口令与**长效 refresh_token**，重放接管账号；失窃窗口远大于会话本身。
3. 判定为 low 而非 info：不是「多一个明文端口」的冗余资产，而是可组合成实际降级攻击的缺保护面。

## 复现（全部 --noproxy 直连，勿经代理）

### 1) 明文口直接给应用、不跳转
```
curl.exe --noproxy "*" -sS -D - -o NUL http://<target>/
```
```
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Server: Photon-Edge
Etag: "4fd048c036095271-c03ee9a328086de0"
（无 Location / 无 301/308 / 无 Strict-Transport-Security）
```
判据：**200 + 无 Location**。若为 301/308 指向 https，本条即证伪。

### 2) http 与 https 同一应用（正文等长）
```
http_len=3288  https_len=3288     # 两端口同一 Etag、同一 Server、同一组 CSP / XFO: DENY / nosniff
```

### 3) 业务 API 明文可达
```
curl.exe --noproxy "*" -sS -D - http://<target>/api/v1/settings/public
→ HTTP/1.1 200 OK, application/json, 返回完整公开配置 JSON（含 "version":"0.2.19"）

curl.exe --noproxy "*" -sS http://<target>/api/v1/auth/me
→ 401 {"code":"UNAUTHORIZED","message":"Authorization header is required"}
```

### 4) 凭据接口在明文与 HTTPS 行为完全一致（只少了加密层）
```
POST http://<target>/api/v1/auth/login  {"email":"a@b.c","password":"wrong"}
→ 401, Content-Length: 81, {"code":401,...,"reason":"INVALID_CREDENTIALS"}
POST https://<target>/... 同 body → 401, Content-Length: 81, 同一 JSON

POST http(s)://<target>/api/v1/auth/refresh {"refresh_token":"junk"} → 两边均 401, Content-Length: 79
```

### 5) HSTS 缺失
```
curl.exe --noproxy "*" -sk -D - -o NUL https://<target>/
→ 有 CSP / X-Frame-Options: DENY / X-Content-Type-Options: nosniff / Referrer-Policy，唯独无 Strict-Transport-Security
```
连续 3 次均无；把全部响应头落盘后 `Select-String Strict-Transport-Security` 命中 0（39 份捕获）。

### 6) 令牌暴露面
index bundle 内 `localStorage.setItem("auth_token", ...)` / `setItem("refresh_token", ...)` ⇒ 令牌可由同源 JS 读取，明文 HTTP 下同样暴露。

## 证伪条件
http 端口返回 301/308 指向 https，**或** https 响应带 Strict-Transport-Security —— 实测两者均缺失。

## 利用方式
同网段 `sslstrip`（或 bettercap `caplets/sslstrip`）配合 ARP 欺骗，或将目标流量引入恶意热点；受害者在 `http://<target>` 登录后，明文口令与 `POST /api/v1/auth/login` 响应中的 `access_token`/`refresh_token` 即可被抓取，随后直接 `Authorization: Bearer <token>` 重放。

限制：信道级漏洞，单独不能 getshell；无已知账号口令时拿不到真实被窃 token（需真实用户登录才有样本）。

## 对照项（说明缺的只是传输层强制）
CSP `frame-ancestors 'none'`、X-Frame-Options: DENY、nosniff、Referrer-Policy 均在位；logout 下发的 23 个 `oauth_*` cookie 均为 `HttpOnly; Secure; SameSite=Lax`。即：应用层安全头齐备，唯独缺「升级强制」与 HSTS。

## 修复建议
1. 边缘（nginx/CDN）对 80 统一 `return 301 https://$host$request_uri;`，80 仅做跳转。
2. 所有 HTTPS 响应下发 `Strict-Transport-Security: max-age=31536000; includeSubDomains`（确认全子域 HTTPS 后加 `preload` 并提交 hstspreload）。
3. refresh_token 改为 `HttpOnly; Secure; SameSite=Strict` Cookie，降低 XSS 与明文信道双面暴露。

## 落盘证据
39 份响应头捕获（*.hdr），http/https 双端口对照正文与头，全部为 --noproxy 直连、finding traffic binding 为空，证据以命令回显为准。
