---
name: cn-proxy-pool
description: 国内免费 HTTP/SOCKS5 代理池：抓取、验活、按需轮换；只用命令级代理参数，绝不改动本机网络与代理配置
whenToUse: 目标有 WAF、或已出现 429/403 激增、被封禁时；扫描/爆破/利用需要换出口 IP 时
role: recon,vuln-scan,exploit
enabled: true
---

# 国内免费 IP 代理池

免费代理不稳定，定位是**降低被封风险**而不是隐藏身份。关键目标用自有出口；需要隧道时见技能 `tunnel-selection`。

## 与 Hunter 客户端的关系（别建第二套）
技能 `hunter-recon` 的内置客户端**已内嵌本技能同款的抓取 + 两段验活**：多源合并抓取 → ①经该代理访问免 key 地理接口要求出口 `countryCode==CN` → ②该代理能拿到 Hunter 边缘响应（零配额探测，走 `https://hunter.qianxin.com/`，**不用 `/openApi/search`**）→ 粘性选一条，缓存 `runs/cn-proxies-live.txt`（TTL 30 分钟）。
- **源列表以那个客户端为准**（本节下面的 shell 清单与它保持同步）；要加源先改客户端。
- 用于境内 API（Hunter 这类只允国内 IP 的接口）时，代理**只解决出境地理**，**不移除配额纪律**——换出口 IP 不会多给配额，也不会绕过速率限制。

## ⛔ 铁规则：不许动本机的网络与代理配置

使用代理**只允许在单条命令上临时指定**，任何情况下都不要修改本机配置。以下操作一律禁止：

| 禁止 | 说明 |
|---|---|
| 设系统代理 | GNOME/KDE 网络设置、`gsettings set org.gnome.system.proxy …`、`networksetup -setwebproxy`、Windows `netsh winhttp set proxy` |
| 写全局环境变量 | 修改 `/etc/environment`、`/etc/profile`、`/etc/profile.d/*`、`~/.bashrc`、`~/.bash_profile`、`~/.profile`、`~/.zshrc` 里的 `http_proxy` / `https_proxy` / `all_proxy` / `no_proxy` |
| 改工具全局配置 | `~/.curlrc`、`~/.wgetrc`、`~/.npmrc`、`/etc/apt/apt.conf.d/*proxy*`、`/etc/pip.conf`、`~/.docker/config.json`、`~/.gitconfig` 的 proxy 项 |
| 改 proxychains 全局配置 | 不修改 `/etc/proxychains4.conf`、`~/.proxychains/proxychains.conf`；确需用时用 `-f` 指向 `runs/` 下的临时配置，用完删除 |
| 动系统网络 | iptables/nftables 规则、路由表、DNS（`/etc/resolv.conf`）、NetworkManager、起停 VPN/tun 设备 |
| 持久化 export | 不在 shell 里 `export http_proxy=…` 让它留在会话里；要传就**内联**在该条命令前 |

**正确姿势**（全部是命令级、一次性的）：

```bash
P=$(shuf -n1 runs/live-proxies.txt)

# 方式一：工具自带的代理参数（首选）
curl -s --proxy "http://$P" --max-time 15 -I "https://target.example.com/"
nuclei -u https://target.example.com/ -proxy "http://$P" -rate-limit 20
sqlmap -u "https://target.example.com/item?id=1" --proxy="http://$P" --batch --random-agent
ffuf -u https://target.example.com/api/FUZZ -w wordlist.txt -x "http://$P" -rate 20

# 方式二：只对这条命令内联环境变量（不 export，进程结束即失效）
http_proxy="http://$P" https_proxy="http://$P" curl -s --max-time 15 "https://target.example.com/"

# 方式三：只支持原始 TCP 的工具 → 用 suo5 SOCKS5 隧道（技能 `suo5-tunnel`），
#        不要为它去改系统代理；proxychains 用临时配置文件：
proxychains4 -f runs/proxychains.tmp.conf -q nmap -sT -Pn -p 80,443 10.0.0.5
```

## 一、抓取（多源合并）
源清单与 `hunter-recon` 客户端保持一致（2026-10-10 逐源实测，括号内为实测条数）：

```bash
mkdir -p runs && cd runs
# 89ip：正文直接给 ip:port（8 条）
curl -s --max-time 20 "https://www.89ip.cn/tqdl.html?api=1&num=50&port=&address=%E4%B8%AD%E5%9B%BD&isp=" \
  | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{2,5}' >> raw-proxies.txt
# ip3366：gb2312 页面 + <td> 表格；行间有换行，必须先 tr -d '\n' 拍平（15 条）
curl -s --max-time 20 "http://www.ip3366.net/free/?stype=1" \
  | tr -d '\n' \
  | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}</td>[[:space:]]*<td>[0-9]{2,5}' \
  | sed -E 's#</td>[[:space:]]*<td>#:#' >> raw-proxies.txt
# proxifly（GitHub CN 列表）：只取 http/https 行，socks 行跳过（125 条）
curl -s --max-time 20 "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/CN/data.txt" \
  | grep -oE 'https?://[0-9]{1,3}(\.[0-9]{1,3}){3}:[0-9]{2,5}' \
  | sed -E 's#^https?://##' >> raw-proxies.txt
# proxyscrape：一行一个 ip:port（20–24 条）
curl -s --max-time 20 "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&country=CN" \
  | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{2,5}' >> raw-proxies.txt
# geonode：JSON，取 protocols 含 http/https 的条目（49–51 条）
curl -s --max-time 20 "https://proxylist.geonode.com/api/proxy-list?limit=100&country=CN" \
  | python3 -c "import json,sys;[print(x['ip']+':'+x['port']) for x in json.load(sys.stdin)['data'] if any(p in ('http','https') for p in (x.get('protocols') or []))]" >> raw-proxies.txt
# kuaidaili：表格式页面，行内空白要先拍平（12 条）
curl -s --max-time 20 -A "Mozilla/5.0" "https://www.kuaidaili.com/free/inha/" \
  | tr -s '[:space:]' ' ' \
  | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}</td> <td[^>]*>[0-9]{2,5}' \
  | sed -E 's#</td> <td[^>]*>#:#' >> raw-proxies.txt
sort -u raw-proxies.txt -o raw-proxies.txt && wc -l raw-proxies.txt
```

> 实测**不可用故不收录**：`free-proxy.cz`（超时无响应）、`zdaye.com/free/`（IP 由 JS 渲染，正文 0 条）、`proxy.scdn.io`（不可达）。
>
> 若你要的是**境内出口**（访问只允国内 IP 的接口），抓完还得过一遍地理校验：经该代理取 `http://ip-api.com/json/?fields=countryCode,query`，`countryCode` 必须为 `CN`。

## 二、验证（并发测活，留下能用的）
```bash
cat > runs/check_proxy.py <<'PY'
import concurrent.futures, sys, urllib.request
TARGET = "http://www.baidu.com"   # 仅测连通性，不携带任何敏感数据
def ok(proxy):
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({"http": "http://" + proxy, "https": "http://" + proxy}))
        with op.open(TARGET, timeout=6) as r:
            return proxy if r.status == 200 else None
    except Exception:
        return None
with open(sys.argv[1]) as f:
    cands = [l.strip() for l in f if l.strip()]
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    for res in ex.map(ok, cands):
        if res: print(res, flush=True)
PY
python3 runs/check_proxy.py runs/raw-proxies.txt > runs/live-proxies.txt
wc -l runs/live-proxies.txt
```

## 三、轮换与限速
- 每个请求随机取一个代理；失败自动剔除并换下一个。
- 目标侧仍要限速（点名所属工具的真实旗标：`nuclei -rl` / `ffuf -rate` / `sqlmap --delay`），代理只是换出口 IP，不是加速器。
- 记录每个出口 IP 的成败；同一目标**累计被封 >3 次立刻放弃**（`redteam_asset_test` 标 `abandoned` + `blocked=true`），转下一个目标。

## 四、注意事项
- **不要通过免费代理传输凭据、Cookie、上传的 shell**——免费代理可能记录流量。
- 测活只测连通性，不要用真实业务请求去测。
- 高频爆破前确认目标没有账号锁定策略；触发锁定前主动停手。
- 用完清掉 `runs/` 下的临时配置（如 `proxychains.tmp.conf`），不要在系统里留下任何代理痕迹。
- 仅在授权演练范围内使用。
