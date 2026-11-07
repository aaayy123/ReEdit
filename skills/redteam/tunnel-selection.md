---
name: tunnel-selection
description: 打进入口后该用哪条隧道：suo5 / chisel / frp / C2 socks5 的适用条件、优先级与登记口径
whenToUse: 已拿到 WebShell / RCE / C2 agent，需要进内网、给用户浏览器入口、或长期稳定通道时
role: exploit,recon,internal
enabled: true
---

# 隧道选型（唯一出处）

> 本文件是**隧道选型的唯一来源**：角色稿与其它技能只引用、不复述。
> 每条隧道建好后都要 `redteam_tunnel_add` 登记，并 `redteam_session_check` 实测。

## 优先级表（按"手上有什么入口"选）

| 手上有什么 | 首选 | 为什么 | 命令与细节 |
|---|---|---|---|
| WebShell（HTTP 通道） | **suo5** | 走 WebShell 的 HTTP 流量，**不需要目标出网**，最不容易被出网策略拦 | 技能 `suo5-tunnel` |
| 只有命令执行（RCE），目标能出网 | **chisel** | HTTP/WebSocket 单端口，穿透出网限制最省事 | 技能 `chisel-tunnel` |
| 需要长期稳定 + 把内网端口/浏览器入口给用户 | **frp** | frps 在我方 VPS，目标跑 frpc，端口映射最稳 | 技能 `frp-tunnel` |
| 已有 C2 agent（**可选、非优先**；`mcp__<name>__*`，如 supershell） | C2 自带 socks5 | **仅临时应急**：不扛大流量、不做持久作业 | 技能 `c2-supershell` |

**硬约束**：
- **持续内网作业与大流量铺面（技能 `gogo-scan`／备用 `fscan-intranet`）走 frp**，不要压 C2 的 socks5（会拖垮 C2 通道）。
- **隧道要备多条**：一条掉了还有别的能进内网。
- **代理只覆盖 TCP**：命令只在单条命令上临时用代理配置（绝不改系统配置）；Kerberos 的 UDP 流量与反连场景 socks5 盖不住，要走端口映射型隧道（frp）。
- **`entry_kind` 必须说清目标侧那一端**：`target-http`（经目标 WebShell）/ `target-outbound`（目标主动出网）/ `target-agent`（目标上有植入物）。只在自己 VPS 上开代理填 `self-only` —— 会被标"不算突破"。
- 建好**必须实测**：`curl --socks5-hostname 127.0.0.1:<port> http://<内网IP>/` 通一个内网目标，才算打进内网。
- **给用户浏览器入口**：交付时给出可直接粘贴的 `socks5://127.0.0.1:<listen端口>`，或 `ssh -D` / frp 映射到用户机器的方法，写清监听地址与端口。
- **自建通道只有三条（suo5 / chisel / frp），不要自行引入第四条**（C2 自带 socks5 仅作临时应急、不算自建；TUN 类隧道已从本项目删除，需要 TUN 的场景用 frp 的端口映射替代）。
