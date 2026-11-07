---
name: active-scan
description: 主动端口与服务扫描，严格遵守授权范围
whenToUse: 手上已有授权清单里的 CIDR/域名、要确认存活主机与开放端口/服务版本时（外网主动探测；内网落地后的批量扫描先过技能 `host-enum` 的门禁）
role: recon
enabled: true
---

## 前置检查
1. 确认目标 CIDR 在**授权清单**内；清单外的段一律不碰，发现新段先报再扫。
2. 确认当前时间窗口允许主动扫描；`--min-rate` / `-T` 起步档，别对整段开激进档。
3. **内网落地后的批量扫描**：先按技能 `host-enum` 完成「本机清单 + 存活清单」门禁——清点没做完不派扫描器。
4. 排除清单：办公网、打印机、工控/OT、云元数据 `169.254.169.254`。
5. 只用本机已有的 `nmap`，**不装工具**（铁律见技能 `host-enum`）。

## 命令
- 快速存活：`nmap -sn <cidr>`
- 全端口（限速）：`nmap -sS -p- --min-rate 300 -T4 <target> -oX runs/nmap-full.xml`
- 服务版本：`nmap -sV -sC -p <ports> <target> -oX runs/nmap-svc.xml`

## 能力 → 技能名（工具、命令与选型都在各自 owner 技能里）
| 用途 | 归属（技能 + 本机路径） |
| --- | --- |
| 端口扫描 / 全端口 / 服务版本 | 本技能（`nmap`，`/usr/bin/nmap`；高速端口扫描见技能 `recon-pipeline` 的 naabu） |
| 内网综合扫描 | 技能 `gogo-scan`（`$DSH_HOME/redteam/toolkit/gogo/gogo`；备用 `fscan-intranet`） |
| 子域 / 解析 / 存活 / 技术栈 | 技能 `recon-pipeline`（`$DSH_HOME/redteam/toolkit/{subfinder,dnsx,naabu,httpx,gospider}`，包装器 `~/.local/bin/pd-httpx`） |
| POC 扫描 | 技能 `nuclei-scan`（`/usr/bin/nuclei`，模板在 `~/.local/nuclei-templates`） |
| 目录爆破 | 见技能 `dir-bruteforce`（`/usr/bin/ffuf`） |
| 隧道 | 技能 `tunnel-selection`（`$DSH_HOME/redteam/toolkit/` 下 suo5 / chisel / frp） |

## 落库要求
写入 fingerprint/asset：provenance = `active`，tool = 实际工具名，记录 scan_run。
