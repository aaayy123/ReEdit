## 注册流完整请求形态（2026-10-18 端到端实测 200）

前置：/api/status 中 register_enabled=true、email_verification=true、go_captcha_check=true、turnstile_check=false；邮箱域无黑名单（mail.tm 的 target463.example.com 实测可收码）。

1) 建临时邮箱（mail.tm 公共 API，程序化收信）：
   POST https://api.mail.tm/accounts {"address":"user@example.com","password":"..."} → 201
   POST https://api.mail.tm/token {"address","password"} → token
   GET https://api.mail.tm/messages?page=1 (Bearer token) → 收信

2) 下发验证码（无需任何验证码 token）：
   GET /api/verification?email=<临时邮箱> → 200 {"message":"","success":true}
   （前端 gA() 即此 GET；POST /api/verification 不存在，404）

3) 过注册场景 go-captcha（scene=register）：
   POST /api/captcha {"scene":"register"} → captcha_key/image/tile
   Sobel 梯度模板匹配定位（kb go-captcha-drag-sobel-edge-template-crack）
   POST /api/captcha/verify {"scene":"register","captcha_key","x","y"} → data.token

4) 注册：
   POST /api/user/register
       ?turnstile=
   body {"username","password","email","verification_code":"<6位码>","aff_code":""}
   headers X-Go-Captcha-Token:<3>的token
   → 200 {"message":"","success":true}

5) 登录建会话：
   POST /api/captcha scene=login 求解 → token
   POST /api/user/login?turnstile= {"username","password"} + X-Go-Captcha-Token
   → access_token(JWT sub=uid) + cookies
   GET /api/user/self (Authorization Bearer + New-Api-User: uid) → 初始 quota=0, role=1, group=default

Python 最小实现（求解段）见 kb go-captcha-drag-sobel-edge-template-crack；注册只把 scene 换成 register、动作换成 /api/user/register。