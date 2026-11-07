// cloud-mail 认证机制（源码定性，含关键判定点与两条可复用探测原语）
//
// === 1. 鉴权中间件 mail-worker/src/security/security.js ===
// app.use('*', async (c, next) => {
//   const path = c.req.path;
//   if (path.startsWith('/test')) return await next();          // ★ 无认证放行
//   if (exclude.some(i => path.startsWith(i))) return await next();
//   const jwt = c.req.header(constant.TOKEN_HEADER);            // 'Authorization'
//   const result = await jwtUtils.verifyToken(c, jwt);
//   if (!result) throw new BizError('authExpired', 401);
//   const { userId, token } = result;
//   const authInfo = await c.env.kv.get('auth-uid:' + userId, { type: 'json' }); // ★ 二次校验
//   if (!authInfo) throw new BizError('authExpired', 401);
//   if (!authInfo.tokens.includes(token)) throw new BizError('authExpired', 401);
//   ... requirePerms 权限判定（authInfo.user.email === c.env.admin 直接放行）
//   c.set('user', authInfo.user);
//   return await next();
// });
//
// ★ 判定结论：仅拿到 env.jwt_secret **不足以**伪造可用 token ——
//   JWT 里的 token 字段必须命中 KV auth-uid:<userId>.tokens 数组，而该 uuid
//   只在 login-service.login() 成功时由服务端 uuidv4() 生成写入。
//
// === 2. token 格式 mail-worker/src/utils/jwt-utils.js ===
// verifyToken(c, token) { const [h,p,s] = token.split('.'); ... }   // ★ 直接 split
//   → Authorization 头必须是**裸 JWT**，写成 "Bearer <jwt>" 会使 h="Bearer eyJ..." 验签失败
// HS256 / 密钥 c.env.jwt_secret / 仅校验 payload.exp（无 exp 也通过）
// payload 结构：{ userId, token, iat [, exp] }   TOKEN_EXPIRE = 60*60*24*30
//
// === 3. 可复用探测原语 ===
// (a) /init/<secret> —— jwt_secret 预言机（源码：init/init.js）
//     const secret = c.req.param('secret');
//     if (secret !== c.env.jwt_secret) return c.text('jwt_secret 不匹配');
//     await this.intDB(c); ... v1_1DB..v1_5DB; return c.text(t('initSuccess'));
//     ⚠ 命中即执行 DB 迁移（ALTER TABLE / UPDATE perm / settingService.refresh），
//       有业务影响且 CREATE TABLE IF NOT EXISTS 对已存在表跳过（修不了缺列），
//       谨慎使用；默认值线索：wrangler-dev.toml / wrangler-test.toml 里写死
//       jwt_secret = "b7f29a1d-18e2-4d3b-941f-f6b2c97c02fd"
// (b) /open_api/settings —— 免认证泄露部署配置（defaultDomains 全量邮件域名、
//     version、needAuth、enableUserCreateEmail、disableAdminPasswordCheck 等）
//
// === 4. KV 键名规律 mail-worker/src/const/kv-const.js ===
//   AUTH_INFO: 'auth-uid:'   → auth-uid:<userId> = {tokens:[uuid...], user:{...}, refreshTime}
//   SETTING:   'setting:'
//   SEND_DAY_COUNT: 'send_day_count:'
//   → 若目标另有暴露的 KV 读取端点（如本项目遇到的 /get?key=），用这些 key 精确打
//
// === 5. 常见坑 ===
// - exclude 用 path.startsWith()，而线上路由统一挂 /api 前缀时 exclude 全部失效
//   （表现为 /api/login 也被自身中间件拦成 401 "Invalid address credential"，
//    即 authExpired 的英文文案）→ 登录功能不可用，但也不是绕过
// - /api/new_address 是少数能过中间件的写入端点，可用它判断站点是否允许匿名建邮箱
//   （403 New address is disabled / 400 D1_ERROR no such column: password 等）
// - 报错文案 "Invalid address credential" 即 authExpired，**验签失败与 KV 无记录不可区分**
//   → 不要用它当作 jwt_secret 是否正确的判据