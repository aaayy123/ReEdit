---
name: recon-pipeline
description: ProjectDiscovery 信息收集流水线：subfinder→dnsx→naabu→httpx→gospider 一键铺开域名资产面
whenToUse: 信息收集阶段拿到域名/单位名后，系统化铺开子域→解析→端口→存活→页面与接口
role: recon
enabled: true
---

# 外部信息收集流水线（ProjectDiscovery）

把"一个域名"变成"一份带标题、技术栈、端口的存活资产清单"，是信息收集阶段的标准动作。
五个工具**有固定顺序**：先枚举子域 → 再解析 → 再探端口 → 再判存活 → 最后爬页面、抠 JS 接口与密钥。

## 本机工具

| 工具 | 路径 | 版本 | 作用 |
| --- | --- | --- | --- |
| subfinder | `$DSH_HOME/redteam/toolkit/subfinder/subfinder` | v2.16.0 | 被动子域枚举（多源聚合） |
| dnsx | `$DSH_HOME/redteam/toolkit/dnsx/dnsx` | v1.3.1 | 批量解析、DNS 爆破、泛解析过滤 |
| naabu | `$DSH_HOME/redteam/toolkit/naabu/naabu` | v2.6.1 | 高速端口扫描（SYN 需 root，否则 `-scan-type c`） |
| httpx | `$DSH_HOME/redteam/toolkit/httpx/httpx`（包装器 `~/.local/bin/pd-httpx`） | v1.12.0 | HTTP 存活/标题/技术栈/状态码 |
| **gospider** | `$DSH_HOME/redteam/toolkit/gospider/gospider` | v1.1.6 | 轻量爬虫：URL/JS 收集（内置 LinkFinder 从 JS 提链接）、sitemap/robots 解析；`-c 1 -k` 串行+延迟、流式落盘，内存平缓——小内存服务器的主力 |

> ⚠️ **`/usr/bin/httpx` 是 Python httpx 库的 CLI，不是 ProjectDiscovery 的**——必须用 `pd-httpx` 或绝对路径。

## 标准流水线

```bash
mkdir -p runs
TK=$DSH_HOME/redteam/toolkit
D=example.com

# ① 子域枚举（被动，多源）
$TK/subfinder/subfinder -d $D -all -silent -o runs/subfinder-$D.txt

# ② 泛解析过滤 + 解析存活（dnsx 会剔除泛解析噪声，这一步很关键）
cat runs/subfinder-$D.txt | $TK/dnsx/dnsx -silent -a -resp -o runs/dnsx-$D.txt
awk '{print $1}' runs/dnsx-$D.txt | sort -u > runs/alive-domains-$D.txt

# ③ 端口扫描（先 top100 快速过一遍，再对存活主机扫全端口）
$TK/naabu/naabu -l runs/alive-domains-$D.txt -top-ports 100 -silent -o runs/naabu-$D.txt
# 全端口（慢，确认在范围内再做）：-p - -rate 300

# ④ HTTP 存活与指纹（标题/状态码/技术栈/服务器）
$TK/httpx/httpx -l runs/alive-domains-$D.txt -ports 80,443,8080,8443,8000,8888,9000 \
  -title -status-code -tech-detect -web-server -follow-redirects -silent \
  -json -o runs/httpx-$D.jsonl

# ⑤ 爬站 + 抠 JS 里的接口与密钥（信息收集阶段的活，不能留给后面）
$TK/gospider/gospider -s "https://target.example.com" -c 1 -d 2 -k 1 -K 2 -m 15 --js --sitemap --robots -o runs/gospider
# -c 1 单并发 + -k/-K 每请求 1~3 秒延迟 + 结果流式落盘：内存平缓（小内存服务器禁用正文囤积型爬虫）
# --js 内置 LinkFinder 直接从 JS 提链接并验证；加 -a 可顺带 Wayback/CommonCrawl 历史 URL（被动源，零流量打目标）
# 内网/需走隧道：加 -p socks5://127.0.0.1:1080

# ⑥ **你自己把 JS 读一遍提接口与密钥**（不依赖解析工具）：把 gospider 输出里的 .js 链接
#    逐个下载到 runs/（走隧道挂 --socks5-hostname），通读源码，提取**接口 URL 与硬编码
#    AK/SK/token/连接串**——按下面「输出与落库」入库；看不懂的混淆先跳过并记录。

# ⑦ 整理成资产清单（URL 清单给目录爆破/漏洞扫描用）
python3 - <<'PY'
import json
out=set()
for line in open('runs/httpx-'+'$D'+'.jsonl'):
    try: j=json.loads(line)
    except: continue
    if j.get('url'): out.add(j['url'])
open('runs/alive-urls.txt','w').write('\n'.join(sorted(out)))
print('存活 URL:', len(out))
PY
```

> **JS 里的接口与密钥属于资产面，在信息收集阶段就要落库**：接口 URL 用 `redteam_asset_add` 记 `url`；
> 密钥/连接串用 `redteam_credential_add`（`source=配置泄露`）。不要等"后面有人再挖"。

## 测绘平台（配几家查几家 + 融合去重 —— 唯一出处）

单位名 → 互联网资产面（含未备案、同主体）用测绘平台。**平台上配了几家 key 就查几家，不许查一家就收工**。
可用的查询标识都试一遍：单位全称 / 简称 / 品牌词 / 英文名 / 拼音缩写 / 域名关键字 / 备案号 / 证书组织名（cert 的 O=）/ whois 注册组织 / 客服电话 / 版权声明——**哪个出数据用哪个，查不到的渠道直接换**。

| 平台 | 技能 | 覆盖特点 |
| --- | --- | --- |
| FOFA | `fofa-recon` | 国内资产最全、语法强（`icon_hash` / `body` / `cert`），限额较低（1 秒 1 次） |
| Hunter | `hunter-recon` | 国内政企/备案资产，接口只允国内 IP 访问（未配 `CN_PROXY` 时客户端自动用免费国内代理池，见 `cn-proxy-pool`） |
| Quake | `quake-recon` | 国内资产，指纹/证书字段丰富 |
| Shodan | `shodan-recon` | 海外资产与未备案边缘资产更全，可补国内平台漏掉的 |

四家覆盖面不同，**同一组资产线索在每个已配置的平台都跑一遍**，结果都 `redteam_asset_add`
（`provenance="passive"`）——资产库自动按 IP/域名融合去重（技能 `asset-correlation`），不需要人工比对。

## 单条命令速查（不想跑全流程时）

```bash
# 只要子域
$TK/subfinder/subfinder -d example.com -all -silent

# 只要存活 URL（已有域名清单）
pd-httpx -l domains.txt -silent -o alive.txt

# 只要端口（单 IP，全端口）
nmap -sS -p- --min-rate 300 -T4 1.2.3.4 -oX runs/nmap-1.2.3.4.xml   # 技能 active-scan
$TK/naabu/naabu -host 1.2.3.4 -p - -rate 300 -silent

# 只要 JS 接口与密钥（单站，低内存）：
$TK/gospider/gospider -s "https://target.example.com" -c 1 -d 2 -k 1 -m 15 --js -q
# 输出里的 .js 自己下载通读提接口/密钥（见上步骤 ⑥）
```

## 与其它技能的分工

| 场景 | 用哪个 |
| --- | --- |
| 单位名/域名 → 互联网资产面（含未备案、同主体） | 测绘平台四家（见上「测绘平台」节） |
| 域名 → 子域 → 存活 → 指纹 → JS 接口 | **本技能**（流水线，标准化） |
| 不接触目标（纯被动） | `passive-recon`（crt.sh/dig/whois） |
| 内网大网段铺面与打点 | 技能 `gogo-scan`（备用 `fscan-intranet`） |
| 存活主机端口/服务版本 | 技能 `active-scan` |

**推荐顺序**：已配置的测绘平台全部铺面（拿单位资产全景，结果融合去重）→ 本技能对每个域名做流水线（拿存活、指纹与 JS 接口）→ `active-scan` 对重点 IP 定版本。

## 纪律

1. **只测授权范围内目标**：naabu 全端口属于**主动**行为，确认在范围内再做。
2. **限速**：`naabu -rate 300` 起步；`subfinder` 用被动源不加 `-all` 时更安静（配额消耗也少）。
3. **泛解析**：`dnsx` 会过滤；如果结果里出现大量同 IP 的随机子域，说明目标有泛解析，改用 `-wd` 或换爆破字典。
4. **API key（可选增强）**：`subfinder` 配置 `~/.config/subfinder/provider-config.yaml` 可接
   Shodan/Censys/VirusTotal 等源（**需要用户提供 key**，见技能 `redteam-setup`）；没 key 也能用免费源。

## 输出与落库（强制）

1. **逐条 `redteam_asset_add`**：`target`（域名/IP）、`names`（域名）、`ports`（带 `url=host`、`title`、`product=server`）、
   `provenance=passive`（subfinder/dnsx 阶段）或 `active`（naabu/httpx/gospider 主动探测）、`tool`（具体工具名）。
2. **按 /24 自动建 C 段**（`redteam_asset_add` 已自动处理）→ 用 `redteam_asset_link` 建立
   `resolves`（域名→IP）、`contains`（C 段→IP）关系，形成图谱（技能 `asset-correlation`）。
3. 每个阶段 `redteam_chain_add`：`stage_code=recon`，`tool` 写实际命令原文，`result` 写数量摘要
   （如 `subfinder 命中 42 个子域 → dnsx 存活 31 → naabu 开放 87 端口 → httpx 存活 19 个站点 → gospider+通读抠出 23 个接口/2 个密钥`）。
4. **重点标注边缘资产**：测试/预发环境（test/dev/uat/pre/staging）、老旧系统、非标准端口、
   非备案主体但同 C 段/IP 的站点——写进 `note`，这些是资产梳理阶段的高优先级目标。
5. 结论给指挥者时**给数字**：子域数 / 存活 IP 数 / 开放端口数 / 存活站点数 / 其中高优先级几条。
