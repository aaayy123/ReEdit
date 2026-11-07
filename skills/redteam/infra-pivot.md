---
name: infra-pivot
description: 同源扩线：从单个域名/站点种子出发，用指纹反查、CDN 穿透、旁站反查把同一主体的全部基础设施铺开
whenToUse: 手上只有单个域名/站点，或按单位名查不到更多关联资产时；信息收集阶段铺开同源资产面
role: recon
enabled: true
---

# 同源扩线（单域名/弱信息种子 → 全部同源基础设施）

有些目标给不出更多标识，或标识查不到关联——这时**指纹就是它的"单位名"**。
基础被动源（crt.sh / whois / 被动 DNS）见技能 `passive-recon`，本技能只写扩线增量。

## 纪律
- 被动为主：指纹提取与测绘反查不触碰目标之外的资产；
  主动探测（直连真实 IP 验证、端口扫）只限**授权清单范围内**的目标，速率保守，并排除办公网、打印机、工控/OT 与云元数据 `169.254.169.254`。
- 指纹太宽泛（命中几十万条）时必须收窄特征（body 取长特征串、叠加 title），
  宁可多试几组窄特征，不要一条宽特征圈进无关第三方。
- 已查过的指纹记账（runs/pivot-seen.txt），防重复劳动。

## 第一步：指纹提取（种子站点）
- favicon mmh3 哈希（测绘反查的主力指纹）：
```bash
cat > runs/favicon_hash.py <<'PY'
#!/usr/bin/env python3
"""favicon mmh3 哈希（FOFA icon_hash / Shodan http.favicon.hash 反查用）。
用法: python3 runs/favicon_hash.py <站点URL | 图标URL | 本地文件>
约定: 与 Shodan/FOFA 一致——favicon 字节做 MIME base64（76 列换行）后算 mmh3 x86_32。
零依赖，纯 Python 实现，不要 pip install mmh3。
"""
import base64, os, re, subprocess, sys

def mmh3_32(data, seed=0):
    data = bytearray(data)
    length = len(data)
    h1 = seed & 0xFFFFFFFF
    c1, c2 = 0xcc9e2d51, 0x1b873593
    end = length & ~3
    for i in range(0, end, 4):
        k1 = data[i] | data[i+1] << 8 | data[i+2] << 16 | data[i+3] << 24
        k1 = k1 * c1 & 0xFFFFFFFF
        k1 = (k1 << 15 | k1 >> 17) & 0xFFFFFFFF
        k1 = k1 * c2 & 0xFFFFFFFF
        h1 ^= k1
        h1 = (h1 << 13 | h1 >> 19) & 0xFFFFFFFF
        h1 = (h1 * 5 + 0xe6546b64) & 0xFFFFFFFF
    k1 = 0
    tail = length & 3
    if tail == 3:
        k1 ^= data[end + 2] << 16
    if tail >= 2:
        k1 ^= data[end + 1] << 8
    if tail >= 1:
        k1 ^= data[end]
        k1 = k1 * c1 & 0xFFFFFFFF
        k1 = (k1 << 15 | k1 >> 17) & 0xFFFFFFFF
        k1 = k1 * c2 & 0xFFFFFFFF
        h1 ^= k1
    h1 ^= length
    h1 ^= h1 >> 16
    h1 = h1 * 0x85ebca6b & 0xFFFFFFFF
    h1 ^= h1 >> 13
    h1 = h1 * 0xc2b2ae35 & 0xFFFFFFFF
    h1 ^= h1 >> 16
    return h1 - 0x100000000 if h1 & 0x80000000 else h1

def favicon_bytes(arg):
    if os.path.isfile(arg):
        with open(arg, 'rb') as f:
            return f.read()
    url = arg if re.match(r'https?://', arg) else 'https://' + arg
    if 'favicon' not in url:
        url = url.rstrip('/') + '/favicon.ico'
    out = subprocess.run(['curl', '-fsSL', '--max-time', '20', '-o', '-', url],
                         capture_output=True)
    if out.returncode != 0 or not out.stdout:
        sys.exit(f'[error] 拉取 favicon 失败: {url}')
    return out.stdout

def main():
    raw = favicon_bytes(sys.argv[1])
    h = mmh3_32(base64.encodebytes(raw))   # encodebytes = MIME 76 列换行
    print(h)
    print(f'FOFA   icon_hash="{h}"')
    print(f'Shodan http.favicon.hash:{h}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
PY
mkdir -p runs
python3 runs/favicon_hash.py https://example.com
```
- 其它指纹（curl 即可）：
  - `title`：`<title>` 原文；`body` 特征串：版权行、统计代码 ID（如 51la/百度统计/GA 的站点 ID）、
    页面内嵌的第三方服务域名（客服/支付/推送 SDK）——这些都是跨站点复用的强特征；
  - 证书：`echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -noout -subject -issuer -fingerprint -sha256`；
  - 识别"这套站点是什么"用技能 `web-fingerprint`（本技能只管拿指纹去扩线）。

## 第二步：测绘反查（指纹 → 同源资产清单）
**配了几家平台就查几家**（FOFA / Hunter / Quake / Shodan 覆盖面不同，同一组指纹在每个已配置的平台都跑一遍，
结果落库自动去重——不许查一家就收工），**复用现有客户端，不要写新的**：

| 指纹 | FOFA（`fofa-recon`） | Hunter（`hunter-recon`） | Quake（`quake-recon`） | Shodan（`shodan-recon`） |
|---|---|---|---|---|
| favicon mmh3 | `icon_hash="<h>"` | 图标哈希字段（语法以平台文档为准） | `favicon:"<h>"`（字段名以平台文档为准） | `http.favicon.hash:<h>` |
| body 特征串 | `body="<pattern>"` | `body="<pattern>"` | `body:"<pattern>"` | `http.html:"<pattern>"` |
| 标题 | `title="<title>"` | `title="<title>"` | `title:"<title>"` | `http.title:"<title>"` |
| 证书 | `cert="<cert>"` | `cert="<cert>"`（以平台文档为准） | `cert:"<cert>"` | `ssl:"<cert>"` |

例：`python3 runs/fofa_client.py 'icon_hash="<hash>"' --pages 3`（Hunter/Quake/Shodan 换成各自客户端与语法，
Shodan 用 `python3 runs/shodan_client.py 'http.favicon.hash:<hash>' --pages 2`）。
结果逐条落库（`redteam_asset_add`，`provenance="passive"`、`tool` 写实际平台名）。
> **检索词用英文技术串**（`title` / `body` / `cert` 落库都是英文形态，中文词检索不到）；只有主体标识（`org=` / `icp.name=`）才用中文。

## 第三步：CDN 穿透（站点在 CDN 后面时找真实 IP）
- 历史 DNS：SecurityTrails 免费页（`https://securitytrails.com/domain/<域名>/history/a`）、
  ViewDNS（`https://viewdns.info/iphistory/?domain=<域名>`）——拿过 CDN 前的 A 记录；
- 裸域/子域差异：www 上了 CDN 而裸域或 mail/dev/test 子域没上的很常见，逐个 `dig +short`；
- SPF/MX/TXT 记录常直接带 origin：`dig +short <域名> TXT`、`dig +short <域名> MX`；
- 全球解析比对：`dig +short <域名> @8.8.8.8` 与 `dig +short <域名> @223.5.5.5` 结果不一致即 CDN，
  多找几个公共 DNS 比对，少数派可能就是真实 IP；
- **验证候选真实 IP**（三选二才算数）：`curl -sk --resolve <域名>:443:<候选IP> https://<域名>/`
  能出同页；证书与站点一致；favicon 哈希一致。

## 第四步：旁站与同 NS 反查（真实 IP/NS → 更多站点）
- 真实 IP 上的全部站点：**已配置的测绘平台逐家查**（FOFA `ip="<真实IP>"` / Hunter `ip="<真实IP>"` / Quake `ip:"<真实IP>"` / Shodan `net:"<真实IP>/32"`）；rapiddns.io（`https://rapiddns.io/sameip/<IP>#result`）；
  ViewDNS reverse IP（`https://viewdns.info/reverseip/?host=<IP>`）；
- 同 NS 的域名簇：ViewDNS reverse NS（`https://viewdns.info/reversens/?ns=<NS>`）——
  批量注册的域名往往共用一组 NS；
- 结果同样逐条落库。

## 第五步：迭代收口
- 新发现的每个域名回第一步再提指纹、再反查，**直到一轮没有新增为止**；
- 新资产与种子资产的关系用 `redteam_asset_link` 落 edge（关联规则见 `asset-correlation`，不重述）；
- 每轮用 `redteam_asset_stats` 核对新增数，向指挥者报"这轮扩出多少、还有没有未查指纹"。
