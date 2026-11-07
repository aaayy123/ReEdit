// cloudflare_temp_email（CF Workers 临时邮箱系统）认证机制 —— 源码定性（worker/src/worker.ts + address_auth.ts + open_api/auth.ts + utils.ts）
//
// ===== 0. 项目识别特征（比 cloud-mail 更容易混）=====
// GET /open_api/settings 免认证返回：announcement / prefix / addressRegex / defaultDomains /
//   needAuth / enableUserCreateEmail / disableAnonymousUserCreateEmail / enableAddressPassword /
//   showGithub / disableAdminPasswordCheck / statusUrl / enableGlobalTurnstileCheck / version
// 出现 disableAdminPasswordCheck 或 enableAddressPassword 即为本项目（maillab/cloud-mail 没有这些字段）
// 认证失败文案：/api/* → "Invalid address credential"
//
// ===== 1. 四套独立认证（CLAUDE.md 官方表）=====
//  | 路径          | 认证头               | 凭据                                   |
//  | /api/*        | Authorization        | Address (mailbox) credential（JWT）    |
//  | /user_api/*   | x-user-token         | 用户账号 JWT                            |
//  | /admin/*      | x-admin-auth         | 管理密码（明文）                          |
//  | (any)         | x-user-access-token  | 角色访问令牌（JWT）                        |
//  | (any)         | x-custom-auth        | 可选站点全局密码                          |
//
// ===== 2. /api/* 的 address JWT：验签 + DB 二次校验 =====
// worker/src/address_auth.ts
//   validateAddressPayload(c, payload):
//     const { address, address_id } = payload;
//     ...类型/正整数校验...
//     SELECT id FROM address WHERE id=? AND name=?   ← ★ 必须真实命中 address 表
//   addressJwtAuth: jwt({secret:c.env.JWT_SECRET, alg:'HS256'}) → 再 validateAddressPayload
//   payload = { address, address_id }（address=邮箱地址字符串, address_id=address 表自增 id）
//   ⇒ 伪造 JWT 需要 env.JWT_SECRET **且** 一组真实存在的 (address_id, name)；缺一不可
//
// ===== 3. /admin/* 的四种放行途径（worker/src/worker.ts）=====
//   ① ADMIN_API_IP_WHITELIST 配置了且 cf-connecting-ip 在列表内（否则 403 AdminApiIpNotAllowedMsg）
//   ② checkIsAdmin(c)：utils.ts → c.req.header("x-admin-auth") ∈ getAdminPasswords(c)（**明文 includes**）
//   ③ x-user-access-token + ADMIN_USER_ROLE 匹配；其中若 token 已过期且 DISABLE_ADMIN_PASSWORD_CHECK=true → 直接放行
//   ④ DISABLE_ADMIN_PASSWORD_CHECK 为 true → 直接放行（**总开关，一开就无鉴权**）
//   否则 401 NeedAdminPasswordMsg
//
// ===== 4. 三个免认证 open_api 登录端点（爆破/枚举入口，worker/src/open_api/auth.ts）=====
//   POST /open_api/site_login        {password, cf_token}         站点密码；未配置 PASSWORDS 时也返回 CustomAuthPasswordMsg（**易误判为已启用**）
//   POST /open_api/admin_login       {password, cf_token}         ★ 管理密码入口
//   POST /open_api/credential_login  {credential, cf_token}        校验 address JWT 是否有效
//   ★ admin_login 的实现要点：
//       const hashedPasswords = await Promise.all(getAdminPasswords(c).map(p => hashPassword(p)));
//       if (!hashedPasswords.length || !password || !hashedPasswords.includes(password)) → 401
//       hashPassword = crypto.subtle.digest('SHA-256', 明文) 的 hex（**无 salt、确定性**）
//       ⇒ 客户端须提交 **sha256(明文密码) 的 hex**，而不是明文！
//   ★ 这两个端点**不在** worker.ts 的速率限制白名单里（白名单仅 /api/new_address、/api/send_mail、
//      /external/api/send_mail、/user_api/address/*/send_mail、/user_api/register、/user_api/verify_code、/redeem_api/）
//      ⇒ 未启用 enableGlobalTurnstileCheck 时，管理密码可无限速无验证码在线爆破
//
// ===== 5. 免认证路径与旁路 ====≠
//   /open_api/* 与 /telegram/* 跳过 x-custom-auth 站点密码中间件 → /open_api/settings 永远可读
//   /api/new_address：只做可选 checkUserPayload，不做 addressJwtAuth ⇒ 匿名可达（建号入口）
//   /api/address_login：直接 next() ⇒ 免认证登录端点
//   全局中间件里未配 DB / JWT_SECRET / 域名时直接报错回显（可探测部署状态）
//
// ===== 6. 常见误判坑 ====
//   - 把本项目当成 maillab/cloud-mail：后者是 KV auth-uid:<userId> 双校验、文案不同，结论会全错
//   - /open_api/site_login 返回 "You have enabled the private site password..." **不代表**真的启用了站点密码
//     （PASSWORDS 为空时同样返回该文案）；判断站点密码是否启用应看 /api/* 是否先报 CustomAuthPasswordMsg
//   - x-admin-auth 是**明文**比较（includes），而 /open_api/admin_login 是 **sha256** 比较，同一密码两条路提交格式不同