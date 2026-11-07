# New API 定制构建「全关闭」实例排查清单（2026-10-18 example.com 实测）

## 快速判定流（拿到 version 后 15 分钟内可完成）
1. `GET /api/setup`：`{"status":true,"root_init":false,"database_type":""}` —— root_init 恒 false 是假象（controller/target453.example.com:31，Setup=true 提前 return）。直接 `POST /api/setup` 一发验证：`{"success":false,"message":"系统已经初始化完成"}` 即关闭，别再投入。
2. `POST /api/user/register` 一发：报 "New user registration has been disabled by administrator" ⇒ RegisterEnabled=false。**同用户名二连注册仍报 disabled 而非"用户名已注册"⇒ 无用户存在性 oracle，且第一条注册也没生效。**
3. 弱口令预算：CriticalRateLimit=20次/20min/IP（common/target454.example.com:122，GlobalAPIRateLimit=180/180s 另算）。只给 root/admin 各 3 组。错误响应统一为 "Username or password is incorrect, or user has been banned"，无 oracle，喷洒无意义。
4. 密码重置：`GET /api/verification` 看 SMTP（本例 "invalid SMTP account"）；`/api/user/reset` 的 token=GenerateVerificationCode(0)=32 字符 UUID（target455.example.com:312/353），不可爆破；`GET /api/reset_password?email=` 恒 success:true（邮箱存在性被掩码）。
5. 版本面差集：非官方 tag 定制构建可能**没有** KB#7 清单里的 /api/rankings、/api/perf-metrics/*（本例 404 Invalid URL）。用 `curl -w '%{http_code}'` 复核再下结论。
6. /mj/image/:id 与 /<任意段>/mj/image/:id 未认证可达（target36.example.com:204 挂在 TokenAuth 之前）但仅 400 midjourney_task_not_found，无数据价值。
7. 前端 chunk 二次收割（主包+全部异步 chunk grep `/api/` 路径）确认无私有端点、无硬编码 key 后，Web 层即可收口。

## 链路依赖速查（为什么注册一关全链断）
- 明文 sk- key：`POST /api/token/:id/key` 挂 UserAuth（target456.example.com:259）⇒ 必须有账号。
- 无限额度：`PUT /api/token/` 同样 UserAuth ⇒ 必须有账号。
- 渠道明文 key：`POST /api/channel/:id/key` 挂 RootAuth+SecureVerificationRequired（target456.example.com:218）⇒ 必须 root。
- 管理员 access_token 直登：authHelper 走 Authorization 头（model/target457.example.com:763）+ 头 New-Api-User=用户id ⇒ 只有 token 泄露才有输入。

## 本例最终判定
/info-leak/low 维持：/api/status 泄露 version/server_address/passkey_rp_id/start_time/配额定价/OAuth 开关（选型价值有限——该构建已关注册、关 OAuth、无 rankings 面，公开 N-day 前提全不成立）。DB key 需走服务器层或凭据泄露源，Web 层零路径。