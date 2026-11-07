---
name: redteam-kit-host-notes
description: 红队技能包的【本机 Windows 适配说明】。ARTEX 跑在 Windows 上，而技能原文按 Kali/Linux 写。本文件把技能里点名的工具映射到本机真实路径与替代方案，并说明 redteam_* 工具在 ARTEX 里对应的落库工具。凡用到技能包里任一技能，先读本文件再执行。
---

# 红队技能包 · 本机（Windows）适配说明

技能正文按 **Kali/Linux** 写（`/usr/bin/…`、`~/.dsh/redteam/toolkit/<工具>/<工具>` 无扩展名二进制）。
ARTEX 跑在 **Windows**，Shell 是 **PowerShell**（`powershell -NoProfile -NonInteractive -Command`）。
直接照抄技能里的命令会失败（Linux 变体是 ELF，Windows 跑不了）。执行前按本表换成 Windows 路径。

工具根目录（本机）：`$env:USERPROFILE\.dsh\redteam\toolkit`，等价于 Git Bash 的 `~/.dsh/redteam/toolkit`。

## 一、本机可用工具（已实测能跑）

| 技能里的写法 | Windows 实际路径 | 说明 |
| --- | --- | --- |
| `toolkit/fscan/fscan` | `~\.dsh\redteam\toolkit\fscan\fscan_windows_x64.exe` | 内网综合扫描 |
| `toolkit/gogo/gogo` | `~\.dsh\redteam\toolkit\gogo\gogo_windows_amd64.exe` | 内网测绘/指纹 |
| `toolkit/suo5/suo5-linux-amd64` | `~\.dsh\redteam\toolkit\suo5-windows-amd64.exe` | HTTP 隧道 |
| `toolkit/subfinder/subfinder` | `$env:USERPROFILE\go\bin\subfinder.exe` | 子域枚举 |
| `toolkit/dnsx/dnsx` | `~\.dsh\redteam\toolkit\dnsx\dnsx.exe` | DNS 解析 |
| `toolkit/httpx/httpx` | `$env:USERPROFILE\go\bin\httpx.exe` | Web 存活/指纹 |
| `toolkit/nuclei` / `/usr/bin/nuclei` | `$env:USERPROFILE\go\bin\nuclei.exe`（v3.11.1） | 模板化漏洞扫描 |
| `ffuf` | `$env:USERPROFILE\go\bin\ffuf.exe` | 目录/参数爆破 |
| `nmap` | `C:\Program Files (x86)\Nmap\nmap.exe` | 端口/服务扫描 |

nuclei 模板库（**不要联网重下**）：`$env:USERPROFILE\nuclei-templates`
nuclei 配置目录：`$env:USERPROFILE\AppData\Roaming\nuclei`

## 一·补、字典与端口预设（本机路径）

**字典**（`$env:USERPROFILE\.dsh\redteam\toolkit\wordlists`）：

| 用途 | 文件 | 条数 |
| --- | --- | --- |
| 目录/文件爆破 | `dir-common-10769.txt` | 10,769 |
| 子域/vhost 前缀 | `subdomain-20024.txt` | 20,024 |
| 弱口令 | `top_100.txt` | 100 |

本机**没有** `/usr/share/seclists`、`/usr/share/wordlists`、`rockyou.txt`——技能正文里出现这些路径时，
一律换成本表里的文件；需要更大字典时再用目标自造字典（品牌名/拼音），不要执行 `sudo gunzip`。

**端口预设**（`D:\ARTEX\packaging\ports`，即 `$env:ARTEX_HOME\packaging\ports`）：

| 文件 | 内容 |
| --- | --- |
| `common100.txt` | 100 个常见端口（逗号串，可直接给 `naabu -p`） |
| `nmap-top1000.txt` | nmap top1000 端口表（逗号串） |
| `all.txt` | `1-65535` |

gogo 继续用自带预设 `top1/top2/win/db`；naabu/nmap 用上面的文件。

## 二、本机**没有**的工具（技能原样跑不通，按降级走）

以下在 toolkit 里只有 Linux ELF 或完全未装，**本机 Windows 上不可用**：

| 缺失工具 | 涉及技能 | 降级口径 |
| --- | --- | --- |
| `hydra` / `hashcat` / `john` | credential-attack | 本机无；在线爆破改用 ARTEX 的 Python 脚本工具跑 requests 逻辑，或把爆破放到跳板机（Linux）执行 |
| `naabu` / `masscan` | active-scan、recon-pipeline | 端口扫描改用本机 `nmap.exe`；SYN 需管理员权限，否则 `-sT` |
| `ksubdomain` / `oneforall` | recon-pipeline | 子域改 `data\tools\subfinder.exe` + `data\tools\dnsx.exe`（这两个本机有） |
| `dirsearch` / `gobuster` / `feroxbuster` | dir-bruteforce | 目录爆破统一用 `ffuf.exe`（本机有） |
| `cfr.jar` / `procyon` | chains-rev、reverse-skill | 反编译器不随包（体积 + 许可）。技能里给了 `curl` 在线下载的步骤，首次用时自己拉一次到 `redteam\toolkit\decompilers\` |
| `kimi-webbridge` | kimi-webbridge | 本机组件不存在；简单取页面改用 browser-automation / playwright-cli |

### 补充：这些是**本机有**的，别按"缺失"处理

技能正文按 Linux 写，路径形如 `$DSH_HOME/redteam/toolkit/xxx/xxx`。Windows 包里的实际位置不同，但**工具都在**：

| 技能里的 Linux 路径 | Windows 实际路径 | 说明 |
| --- | --- | --- |
| `redteam/toolkit/chisel/chisel` | `data\tools\chisel.exe` | v1.12.0，服务端客户端同一二进制，本机可跑 `server` 和 `client` |
| `redteam/toolkit/frp/frpc` | `data\tools\frpc.exe` | v0.62.1 |
| `redteam/toolkit/frp/frps` | `data\tools\frps.exe` | v0.62.1，本机也能当服务端（需公网或端口映射） |
| `redteam/toolkit/gospider/gospider` | `data\tools\gospider.exe` | v1.1.6（官方不发 Windows 构建，此项由源码交叉编译） |
| `redteam/toolkit/{subfinder,dnsx,naabu,httpx}` | `data\tools\{subfinder,dnsx,naabu,httpx}.exe` | 后两个部分无 `.exe` 后缀，直接写全路径调用 |
| `redteam/toolkit/gogo/gogo` | `redteam\toolkit\gogo\gogo_windows_amd64.exe` | 技能里给的 `$TK/gogo/gogo` 在 Windows 上要换成这个全名 |

> 调工具时**优先用 autobind 注册的逻辑名**（`nuclei` / `ffuf` / `chisel` / `gospider` …），
> 系统会按平台自动补 `.exe`；写死路径反而容易在换版本后失效。

### 关于 `redteam/toolkit/vps/`

技能里出现的 `vps/id_rsa`、`vps/vps.sh` 是**操作者自己的 VPS 凭据**，分发包里**故意不带**（私钥不能外发）。

要跑 VPS 相关技能（`vps-reverse-shell`、`frp-tunnel`），自己准备：

```
redteam\toolkit\vps\id_rsa      你的 SSH 私钥
redteam\toolkit\vps\vps.sh      登录脚本（自己写，改 IP）
```

## 三、`redteam_*` 工具 → ARTEX 对应工具

技能正文大量引用 DSH 的 `redteam_*` 事实库工具。**ARTEX 里没有这套工具**，用下列等价工具落库：

| 技能里的调用 | ARTEX 对应 | 用途 |
| --- | --- | --- |
| `redteam_asset_add` / `redteam_asset_upsert` / `redteam_asset_link` / `redteam_asset_query` / `redteam_web_list` | `insert_assets` / `list_assets` / `list_untested_assets` / `graph_overview` | 资产落库与查询 |
| `redteam_vuln_add` / `redteam_vuln_update` | `report_finding` / `record_fact` | 漏洞落库（report_finding 写 findings 表） |
| `redteam_http_evidence_add` | `traffic_get` / `traffic_search` + `bind_finding_traffic` | 原始报文证据（ARTEX 用流量库） |
| `redteam_credential_add` / `redteam_credential_list` | `record_fact`（type=credential） | 凭据记录 |
| `redteam_access_add` / `redteam_access_list` | `record_fact`（type=access） | 访问会话记录 |
| `redteam_tunnel_add` / `redteam_tunnel_update` / `redteam_session_check` | `record_fact`（type=tunnel） | 隧道登记 |
| `redteam_webshell_add` | `record_fact`（type=webshell） | WebShell 登记 |
| `redteam_chain_add` | `record_fact`（type=chain_step） | 攻击链步骤 |
| `redteam_poc_search` / `redteam_poc_get` / `redteam_poc_add` | `kb_search` / `kb_get` / `kb_add` | **跨靶标知识库（一一对应）** |
| `redteam_asset_test` | `record_fact`（type=asset_test） | 资产测试状态 |
| `redteam_score_hit` / `redteam_attack_file_add` / `redteam_preflight` | 无对应 | ARTEX 无评分/攻击文件/预检体系，跳过 |

**知识库是唯一一一对应的部分**（`kb_search`/`kb_get`/`kb_add` 与 `redteam_poc_search`/`redteam_poc_get`/`redteam_poc_add` 同构，且共用同一份 `~/.dsh/redteam` 事实库）——红队技能里"先查库再动手、验证后回填"的纪律在 ARTEX 里完整可用。

## 四、执行纪律（照技能原文，仅替换工具/路径）

1. 先读技能，按它自己的「前置检查 / 可用性判定」逐项确认。
2. 命令里的工具名按**表一/表二**换成 Windows 路径或降级方案；`redteam_*` 落库调用按**表三**换成 ARTEX 工具。
3. 技能里的 `$DSH_HOME` / `~/.dsh` 在 PowerShell 下等价于 `$env:USERPROFILE\.dsh`。
4. 缺工具且无降级 → 如实告诉人「本机缺 X，需在 Linux 跳板机执行」，**不要伪造命令输出**。
