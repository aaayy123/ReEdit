---
name: db-utilization
description: 数据库利用的唯一出处：拿到数据库凭据或发现可未授权连接的库后，经 MDUT（自带 MCP，工具名形如 mcp__<name>__*）从数据库侧拿服务器权限或批量拖数据；引擎矩阵、MCP 用法、运行依赖与落库口径都在这里
whenToUse: 拿到数据库账号密码、发现可未授权 / 弱口令连接的数据库（3306/1433/5432/1521/6379 等）、或需要从数据库侧拿服务器权限（UDF/CLR/Java 命令执行）与批量数据时
role: exploit
enabled: true
---

# 数据库利用（MDUT，走 MCP）

> 本文件是**数据库利用能力的唯一来源**：角色稿与其它技能只引用、不复述；具体命令与引擎差异以本文件为准。

## 红线（先看这条）

**云厂商 RDS 与云托管数据库地址一律不测**：那是云侧资产、不在演练目标内，测了没有实际价值（云托管实例通常没有 UDF / 写文件 / 命令执行面）。**只测目标自建 / 自托管的实例。**

## 什么时候用

- 拿到数据库账号密码（弱口令 / 配置泄露 / 注入拖库 / 凭据复用 / 默认口令）；
- 端口扫描或指纹发现 3306 / 1433 / 5432 / 1521 / 6379 等端口可直接连接（未授权或弱口令）；
- 需要从数据库侧拿**服务器权限**（命令执行）或**批量数据成果**（拖库）。

## 引擎与能力矩阵（MDUT README 口径，v3.x）

各引擎都有：连接管理 / SQL 编辑器 / 表浏览编辑 / 结构查看；下表是额外的利用能力。**MSSQL 的命令执行**另有 xp_cmdshell、OLE Automation、Agent Job 三种执行策略可选。

| 引擎 | 支持版本 | 命令执行 | 文件管理 | 反弹 Shell | Shellcode | SOCKS5 正向代理 |
|---|---|---|---|---|---|---|
| MySQL / MariaDB | 5.5+ / 8.0+（含 MariaDB） | UDF | ✓ | ✓ | **仅 MySQL** ✓ | ✓ |
| MSSQL | 2005+ | CLR | ✓ | — | — | — |
| PostgreSQL | 8.2+ | Java | ✓ | ✓ | — | ✓ |
| Oracle | 11g+ | Java | ✓ | ✓ | — | ✓ |
| Redis | 4.0+ | ✅（RDB / rogue server 路线，非 UDF/CLR/Java） | ✓ | ✓ | — | ✓ |

Redis 还支持 **RDB 写**（写计划任务 / 公钥等落地点）。

> 来源：MDUT 仓库 README 的能力矩阵（v3.x）。上表"是否支持"与版本下限按 README 标注；MSSQL 的命令执行另有 xp_cmdshell、OLE Automation、Agent Job 三种策略（见本节开头）。

## 用法：走 MCP

- **工具名以你自己的工具目录为准**：MDUT 挂载后工具名形如 `mcp__<name>__*`（`<name>` 通常是 `mdut`，也可能是用户在演练台起的任意名字）。**没有这个前缀就是没挂载**，不要凭记忆调用——本文件不硬编工具名。
- **CLI 与 GUI 互斥**：GUI 模式下启动 MCP 必须保持窗口打开；无头 / 智能体场景一律走 **CLI / stdio**。GUI 是给人用的备用通道。
- 三种传输（由用户在演练台「MCP」页签配，或插件已自动种入 `mdut` 行）：
  - **stdio（默认）**：`command` = 工具箱里 MDUT 二进制的绝对路径，`argsLine` = `mcp`（等价于命令行 `mdut mcp`）。
  - **Streamable HTTP**：服务端跑 `mdut mcp --streamable --bind 127.0.0.1 --port 16699 [--token X]`，演练台填 URL + `Authorization: Bearer <token>` 头。
  - **旧式 SSE**：服务端跑 `mdut mcp --http --bind 127.0.0.1 --port 16699 [--token X]`，演练台 Transport 选 `sse`、URL 填 SSE 端点（默认形如 `http://127.0.0.1:16699/sse`）；Headers 放 `Authorization: Bearer <token>`（SSE 传输由宿主补丁 #76 原生支持，无需 mcp-proxy 中转）。

### 演练台「MCP」页签怎么加（插件已自动种入 `mdut` 行时直接用即可）

- **stdio**：Name 随意；Transport=stdio；Command=工具箱里 MDUT 二进制的绝对路径；Args=`mcp`；CWD=该二进制所在目录。
- **streamable-http**：Name 随意；URL=streamable 端点（默认形如 `http://127.0.0.1:16699/mcp`，以 `mdut mcp` 启动日志打印的路径为准）；Headers 放 `Authorization: Bearer <token>`。
- **sse**：Name 随意；Transport=sse；URL=SSE 端点（默认形如 `http://127.0.0.1:16699/sse`）；Headers 放 `Authorization: Bearer <token>`。

## 安装与运行依赖

- **发布资产**：`v3.1.1_Multiple_Database_Utilization_Tools_linux_amd64.zip`（Linux amd64）；
- 解压后二进制名 `Multiple_Database_Utilization_Tools`，需 `chmod +x`；官方建议软链成 `mdut`（**需要 sudo，由用户自己执行**，智能体不代替）；
- `bash "$DSH_HOME/redteam/setup.sh" --yes` 会在 Linux x86_64 上自动拉取并解压到工具箱的 `mdut/` 子目录（`--optional` 会逐项询问；系统依赖命令脚本只打印、不代跑 sudo）；
- **Linux 运行库**（GUI / MCP 依赖 webkit2gtk，**需要 sudo，由用户自己执行**）：
  - Ubuntu / Debian / Linux Mint：`sudo apt update && sudo apt install libwebkit2gtk-4.1-0`
  - Arch / Manjaro：`sudo pacman -S webkit2gtk-4.1`
  - Fedora / Rocky / RHEL：`sudo dnf install webkit2gtk4.1`
- **macOS 首次启动**：`sudo xattr -r -d com.apple.quarantine /Applications/Multiple_Database_Utilization_Tools.app`。

## Redis 在 NAT / SOCKS5 后面

Redis 反连在 NAT / 代理后面时，用官方中继 `Ch1ngg/mdut-relay`（资产 `mdut-relay-linux-amd64`）做中转。

## 落库口径（与全局一致）

- 凭据 `redteam_credential_add`：`source` 填 弱口令 / 配置泄露 / 凭据复用 / 默认口令，获取手段写 `tool`，明文口令写 `secret_value`；
- 数据库权限成果与**实际导出条数**（批量数据写 `runs/` 证据 + 条数字段）；
- 每个动作 `redteam_chain_add`：`tool` 写**实际调用**（含工具名与关键参数，如 `mcp__<name>__<tool> {host, engine, payload}`；智能体自己跑 CLI 就写命令原文），`result` 写回显；
- 从数据库侧拿到的服务器权限照常登记：`redteam_webshell_add` / `redteam_access_add`，并 `redteam_session_check` 实测连通。
