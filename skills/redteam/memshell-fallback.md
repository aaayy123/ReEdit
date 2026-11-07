---
name: memshell-fallback
description: 内存马与"马被查杀/特殊容器"的兜底流程：用 memshell MCP 生成（GSL5 无内存马工具），经已有写入面在目标落地
whenToUse: 哥斯拉马被查杀 / 目标是特殊容器或框架 / 需要无文件落地 / 已有会话想加隐蔽通道时
role: exploit
enabled: true
---

# 内存马兜底（memshell MCP 生成 + 已有会话落地）

## 什么时候用它（而不是常规哥斯拉马）

1. 常规哥斯拉马**被查杀 / 落地即死 / 无法访问**；
2. 目标是**特殊容器或框架**（Spring / Tomcat / Jetty / Undertow / Weblogic / Resin / JBoss 等），
   常规 JSP 马受限于目录或权限；
3. 需要**无文件落地**（不写磁盘、重启即失）；
4. 已有会话，想加一条**更隐蔽的常驻通道**。

## 工具分工

> ⚠️ **GSL5 哥斯拉 MCP 没有内存马工具**（只有 shell / file / db / plugin 几族）。内存马的
> **生成**一律走 `mcp__memshell__*`；哥斯拉会话只用来**把 payload 送进目标**。

| 场景 | 用哪个 | 为什么 |
|---|---|---|
| **生成内存马 payload**（按容器/框架/工具链/打包器） | `mcp__memshell__*`（先 `memshell_capabilities` 查支持矩阵，再 `generate_*`） | 它按目标环境生成字节码 payload —— GSL5 不提供这一步 |
| **把 payload 送进目标**（已有会话时） | GSL5 的文件/命令工具（`mcp__godzilla__file_upload_local`、`mcp__godzilla__shell_exec`，按 `shellId`） | 在活会话上写文件/执行，无需另开通道 |
| **没有会话**，或目标是特殊容器 | 走漏洞自身的上传点 / 命令执行面，或按本文末的替代入口 | 没有现成写入面时先拿到一个入口 |

**两者都没有挂载时**：如实回报指挥者（"内存马能力不可用"），改回常规马（技能 `webshell-toolkit`）或换入口，不要硬造。

## 落地顺序（硬性）

1. 先 `memshell_capabilities` 确认**目标容器/框架在支持矩阵里**；
2. 生成 payload → 通过**已有写入面**落地（漏洞上传点、命令执行、或已有哥斯拉会话的 `mcp__godzilla__file_upload_local`）；
3. **注入后必须验证**：用生成时的密码/密钥按对应 cryption 实际连一次并执行命令，把回显写进证据；
4. 登记：`redteam_webshell_add` 的 `shell_type=memshell`、`pass_key` 写连接密码、`cryption` 写加密方式、
   `note` 写明**容器/框架 + 注入方式 + 是否重启即失**；
5. `redteam_session_check` 复查状态（内存马尤其容易随重启/热部署消失）。

## 注意

- 内存马**重启即失**（无文件落地的代价）：交付说明里要写清"重启后需要重新注入"。
- 注入前先确认目标容器/框架/中间件版本在支持矩阵里；不在矩阵里 → 不要硬试，回退常规马并如实说明。
- 交付物是"生成用的密码/密钥/cryption + 注入位置"，登记时一起写清（用户按它自己连）。
