---
name: dir-bruteforce
description: 目录与文件爆破：后台入口、备份文件、配置泄露、源码与版本库暴露（ffuf）
whenToUse: 已确认 Web 存活但指纹无直接 Nday 线索；需要找后台入口、备份、配置、源码、上传点等隐藏路径
role: vuln-scan
enabled: true
---

# 目录与文件爆破（找入口的主力）

**实战里大部分入口不是 CVE 打进去的，是目录爆破扫出来的**：后台 `/admin`、备份 `www.zip`、配置 `.env`、
源码 `.git/`、接口文档 `swagger-ui.html`、上传点、调试页、actuator/druid 监控台。
本技能只用本机已就位的 **ffuf** 一个工具——选型与命令都在这里。

## 本机工具

| 工具 | 路径 | 版本 | 特点 |
| --- | --- | --- | --- |
| **ffuf** | `/usr/bin/ffuf` | 2.1.0-dev | 最快、最灵活，支持多字典/vhost/参数 fuzz |

## 目录与文件爆破

```bash
# 目录与文件（两轮：先目录，再按命中的目录加后缀）
ffuf -u https://target/FUZZ -w $DSH_HOME/redteam/toolkit/wordlists/dir-common-10769.txt \
  -mc 200,204,301,302,307,401,403,500 -fc 404 -t 20 -rate 40 -timeout 10 \
  -o runs/ffuf-dir.json -of json

# 带后缀（备份/配置/源码/脚本）
ffuf -u https://target/FUZZ -w $DSH_HOME/redteam/toolkit/wordlists/dir-common-10769.txt \
  -e .php,.asp,.aspx,.jsp,.html,.js,.zip,.tar.gz,.bak,.sql,.txt,.xml,.json,.config \
  -mc 200,204,301,302,307,401,403,500 -fc 404 -t 20 -rate 40 -o runs/ffuf-dir-ext.json -of json

# 敏感文件（备份/配置/源码/密钥）
ffuf -u https://target/FUZZ -w $DSH_HOME/redteam/toolkit/wordlists/dir-common-10769.txt \
  -mc all -fc 404 -t 20 -o runs/ffuf-quick.json -of json

# vhost 虚拟主机发现（同 IP 多站点，边缘资产常从这里出来）
ffuf -u https://target/ -H "Host: FUZZ.example.com" \
  -w $DSH_HOME/redteam/toolkit/wordlists/subdomain-20024.txt \
  -fs 0 -mc all -t 20 -o runs/ffuf-vhost.json -of json
```

要点：`-rate` 交给服务器喘气；`-e` 后缀表必须带**备份与配置类**；命中目录后再对目录做第二轮。

## 字典（按本机路径，优先用这些）

本机（Windows）字典目录：`$DSH_HOME/redteam/toolkit/wordlists`
即 `$env:USERPROFILE\.dsh\redteam\toolkit\wordlists`。

| 用途 | 路径 | 条数 |
| --- | --- | --- |
| 目录/文件（综合） | `$DSH_HOME/redteam/toolkit/wordlists/dir-common-10769.txt` | 10,769 |
| 子域（vhost 用） | `$DSH_HOME/redteam/toolkit/wordlists/subdomain-20024.txt` | 20,024 |

- 本机**只带这一份综合目录字典**，不再区分 raft-large/medium/quickhits；要更细的再按需下载，
  但先跑这份，命中率与速度的平衡最好。
- Linux 目标机/跳板机上若有 `/usr/share/seclists`，可直接改用其中的 raft-* / quickhits 系列。
- **缺字典时**用 `redteam_credential_list` 里已收集的单位词（品牌名、拼音缩写）自造小字典——
  针对性字典命中率往往高于通用大字典。

## 重点目标（扫到就要跟到底）

| 命中 | 下一步 |
| --- | --- |
| `/admin`、`/manage`、`/login`、后台路径 | 交给账号权限路线：默认口令/弱口令（技能 `credential-attack`） |
| `.git/`、`.svn/`、`.env`、`config.php.bak`、`www.zip`、`web.rar` | **源码与配置泄露**：拉下来找数据库连接串、密钥、硬编码账号 → `redteam_credential_add` |
| `swagger-ui.html`、`/v2/api-docs`、`/openapi.json` | 提取全量接口清单 → 未授权与越权探测（技能 `unauth-exploit`） |
| `actuator`、`druid`、`/console`、`/jmx` | 未授权监控台，常直通 RCE 或数据库 |
| 上传点、导入、备份恢复、模板/报表设计 | 交给漏洞利用角色串 getshell 链 |
| `.ssh/`、`id_rsa`、`*.pem`、`*.jks` | 私钥泄露 → 直接尝试登录（`ssh -i`） |

## 降噪与自保

1. **必须先过滤 404 的软 404**：先请求一个不存在的随机路径，看返回状态码与响应长度，用它做 `-fs`。
2. **限速**：`-rate 40` / `-t 20` 起步；被 WAF 拦（大量 403/429）先降到 5–10 req/s。
3. **别碰危险路径**：`/logout`、`/reboot`、`/shutdown`、`/delete*`、`/reset*` 这类会改状态的不要爆破，
   字典里遇到也要排除（会造成业务中断，不算成果）。
4. **被封 >3 次放弃**该资产（`redteam_asset_test` status=abandoned + blocked=true），转下一个。
5. **内网目标走隧道**：ffuf 加 `-x socks5://127.0.0.1:1080`（技能 `tunnel-selection`）。

## 输出与落库（强制）

1. **隐藏路径本身不算成果**，但**每个拿到东西的路径都要落库**：
   - 找到后台/上传点/接口文档 → 记进该资产 `redteam_asset_test` 的 `surface`（追加式），交给漏洞发现/利用的下一个动作；
   - 泄露源码/配置/密钥/凭据 → `redteam_credential_add`（`source=配置泄露`，`tool` 写路径与命令，明文写 `secret_value`）；
   - 未授权可访问的接口/监控台 → 直接 `redteam_vuln_add`（含 `evidence` 回显）+ `redteam_http_evidence_add`。
2. 每个关键动作 `redteam_chain_add`：`stage_code=internet`（或 `internal`），
   `tool` 写实际命令原文（例如 `ffuf -u https://target/FUZZ -w raft-large-directories.txt -e .php,.zip,.bak -rate 40`），
   `result` 写命中摘要（例如 `命中 /admin/、/backup/www.zip、/.env`）。
3. 跑完立刻 `redteam_asset_test` 回写 `status`/`test`/`surface`——不写状态后面的人一定重复扫。
4. 字典与结果文件一律放 `runs/`（报告要能复现）。
