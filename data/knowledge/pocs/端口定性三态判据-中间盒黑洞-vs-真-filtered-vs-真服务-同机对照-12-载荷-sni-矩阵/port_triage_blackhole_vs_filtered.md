## 问题
一个端口"TCP 能连但没 banner、TLS 握手被 reset"，是**真服务**、**被防火墙 filtered**、还是**中间盒黑洞**？三者处置完全不同：只有"真服务"才值得查版本/Nday。

## 判据（三态区分，必须做同机对照）
| 现象 | 空闲连接 | 发任意数据 | 结论 |
| --- | --- | --- | --- |
| 真服务 | 保持（或服务端先发 banner） | **有响应**（banner / HTTP 状态行 / TLS ServerHello 或 alert） | 可指纹，查 Nday |
| **真 filtered** | —— | **SYN 就超时**（连接建不起来） | 无攻击面，跳过 |
| **中间盒黑洞** | **能建成且能维持秒级** | **任何字节都被立即关闭、0 字节响应**；TLS ClientHello 直接 ECONNRESET | 无 banner/版本/协议，**查不了 Nday** |

**关键：必须用同机对照端口做基线**，否则会把"黑洞"误判成"filtered"或"服务不响应"。

## 载荷清单（一次性打完，别一条条试）
裸 socket 发以下首包，记录响应字节数与错误类型（ECONNRESET 要单独记，它≠超时≠FIN）：
`HTTP/1.0`、`HTTP/1.1+Host`、`GET /version HTTP/1.1`、`HEAD/OPTIONS/POST`、`CONNECT host:port`、
`\x05\x01\x00`(SOCKS5)、`\x04\x01\x00\x50...`(SOCKS4)、`SSH-2.0-...`、`\xffSMB`、`OPTIONS rtsp://...`、
`*1\r\n$4\r\nPING\r\n`(RESP)、`JRMI\x00\x02\x4b`、`stats\r\n`(memcached)、`PING\r\n`(redis)、
`PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n`+SETTINGS(h2c)、裸 TLS ClientHello（**并用 SNI 矩阵**：空 + 每个已知 vhost）、`\x00`*16、单字节。

## 案例（实测，2026-09-30 codex-tgt4796-com）
`nmap -sT -Pn -sV --version-all`：8443 判 open 但只猜得出 `https-alt?`（无版本）；7070 全 filtered。
- 8443：TCP 可连、**空闲连接维持 5285ms+**；`GET / HTTP/1.0` → 约 500ms 后被关闭、**0 字节**；`HTTP/1.1+Host+UA` → **ECONNRESET**；**裸 TLS ClientHello（5 种 SNI 全试）→ ECONNRESET**；12 种协议载荷**全部 0 字节 banner**。
- 同机对照：443 → 497ms 返回真实 `HTTP/1.1 400 Bad Request / Server: openresty`；4321 → 真实 `200 OK`；**8444/18443/9999/20000 → 每种载荷都 SYN 超时（那才是真 filtered）**。
- **独立旁证**：FOFA 对 203.0.113.53 与 203.0.113.97 的 8443 **无任何资产**（同 IP 的 80/443 有）⇒ 第三方爬虫同样取不到 banner。
⇒ 结论：8443 = **中间盒/防护型黑洞**，无协议无版本，**不建议再投**。7070 = 可连但任何载荷都不回一个字节（连 TLS alert 都没有）⇒ 到不了 TLS 层，同样判死。

## 附：不要指望用代理绕
若怀疑是本机出口被针对性处理，想借开放代理从别的路径复核：Squid 类代理通常只放行 80/443 —— 实测 `CONNECT 203.0.113.53:8443` → `403 ERR_ACCESS_DENIED`（`X-Squid-Error: ERR_ACCESS_DENIED`）。**要复核就得用别的出口（另一条链路/另一台机器），别把时间花在代理上。**

## 脚本
裸 socket 多载荷探针 + SNI 矩阵：`raw_proto_probe.py` / `port8443_probe.py` / `_ctrl8443.py`（同机对照）