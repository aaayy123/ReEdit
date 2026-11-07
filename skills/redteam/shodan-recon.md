---
name: shodan-recon
description: 用 Shodan API 批量测绘目标资产（IP/端口/主机名/组织/指纹）；内置限速客户端，单线程 + 最小间隔 + 退避重试
whenToUse: 信息收集阶段铺开互联网资产面，且已配置 SHODAN_KEY 时；Shodan 在境外资产、证书与指纹维度上与 FOFA/Hunter/Quake 互补
role: recon
enabled: true
---

# Shodan 资产测绘（限速安全版）

## 凭据
- API Key：从环境变量 `SHODAN_KEY` 读取（**任何 key 都不要写进仓库**；脚本读环境变量，并自动兜底加载 `$DSH_HOME/.env`——宿主子进程会清洗 KEY 类变量，所以 key 落 .env 最稳）
- 接口：`GET https://api.shodan.io/shodan/host/search`
- 参数：`key`、`query`（URL 编码的查询语句，**不要 base64**）、`page`

## 限额与纪律（以你账号控制台当日口径为准）
- 搜索按页消耗 query credit（**1 credit = 100 条**）；`/shodan/host/search` 需要会员/付费计划的 query credit——**免费账号不发 query credit，search 接口会报无权限**（只有 host 查询等非搜索接口；来源：help.shodan.io「How to Download Data with the API」）。会员每月 100 credits，可依次翻页。
- **按 1 请求/秒 保守执行，绝不并发**；429/402 出现即退避或收手换数据源。
- 默认只取前 1–2 页（每页 100 条）拿测绘入口；宽语句（单独 `http.html:` / `http.title:`）务必叠加域名/IP/组织限定。
- 结果落盘缓存：`runs/shodan-*.jsonl`，同一查询先看缓存；长任务放后台（`run_in_background`）。

## 限速客户端（用这个，不要手写 curl 循环）
```bash
cat > runs/shodan_client.py <<'PY'
#!/usr/bin/env python3
"""Shodan 采集（限速安全）：单线程 + 最小间隔 + 指数退避 + 结果缓存。

用法:
  python3 runs/shodan_client.py 'hostname:"example.com"' --pages 2 --interval 2.0
输出:
  runs/shodan-<slug>.jsonl   每行一个资产 {ip,port,hostnames,domains,title,org,product}
环境:
  SHODAN_KEY（必需）；SHODAN_API_BASE（可选，默认 https://api.shodan.io，代理/测试用）
"""
import argparse, hashlib, json, os, sys, time, urllib.error, urllib.parse, urllib.request


def _load_dsh_env():
    """$DSH_HOME/.env 兜底加载：宿主子进程会清洗 KEY/TOKEN 类环境变量，测绘 key 只落在这个文件里。"""
    home = os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")
    try:
        with open(os.path.join(home, ".env"), encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("\x27").strip("\x22"))
    except OSError:
        pass
_load_dsh_env()

KEY = os.environ["SHODAN_KEY"]
API = os.environ.get("SHODAN_API_BASE", "https://api.shodan.io").rstrip("/")
RETRY_BACKOFF = [5, 15, 45]          # 遇 429 的退避秒数
HARD_BUDGET = 20                      # 单次运行最多请求次数（1 页 = 1 credit）
PAGE_SIZE = 100


def fetch(query, page, timeout=30):
    qs = urllib.parse.urlencode({"key": KEY, "query": query, "page": page})
    req = urllib.request.Request(API + "/shodan/host/search?" + qs,
                                 headers={"User-Agent": "redteam-recon/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"error": body[:200]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--pages", type=int, default=2, help="最多翻页数（默认 2；需有 query credit）")
    ap.add_argument("--interval", type=float, default=2.0, help="请求最小间隔秒（默认 2.0）")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    slug = hashlib.md5(args.query.encode()).hexdigest()[:8]
    out = args.out or f"runs/shodan-{slug}.jsonl"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)

    if os.path.exists(out) and os.path.getsize(out) > 0:
        print(f"[cache] {out} 已存在（{os.path.getsize(out)} bytes），如需重拉请先删除", file=sys.stderr)
        return 0

    seen, rows, requests_made, last_ts = set(), [], 0, 0.0
    for page in range(1, args.pages + 1):
        wait = args.interval - (time.time() - last_ts)
        if wait > 0:
            time.sleep(wait)

        status, data = None, None
        for attempt, backoff in enumerate([0] + RETRY_BACKOFF):
            if attempt:
                print(f"[backoff] 等待 {backoff}s 后重试 (page={page})", file=sys.stderr)
                time.sleep(backoff)
            last_ts = time.time()
            requests_made += 1
            if requests_made > HARD_BUDGET:
                print(f"[stop] 达到请求预算 {HARD_BUDGET}", file=sys.stderr)
                break
            status, data = fetch(args.query, page)
            if status == 200 and not data.get("error"):
                break
            errmsg = str(data.get("error", ""))
            if status == 429:
                continue                      # 限速 → 退避重试
            print(f"[stop] 不可重试错误 http={status} {errmsg}", file=sys.stderr)
            data = None
            break
        if data is None:
            break

        matches = data.get("matches") or []
        print(f"[page {page}] {len(matches)} 条 (total={data.get('total')})", file=sys.stderr)
        for m in matches:
            ip = m.get("ip_str") or ""
            port = m.get("port") or ""
            key = (ip, port, m.get("transport") or "tcp")
            if key in seen:
                continue
            seen.add(key)
            http = m.get("http") or {}
            rows.append({
                "ip": ip, "port": port,
                "hostnames": ";".join(m.get("hostnames") or []),
                "domains": ";".join(m.get("domains") or []),
                "title": http.get("title") or m.get("title") or "",
                "org": m.get("org") or "",
                "product": m.get("product") or "",
            })
        if len(matches) < PAGE_SIZE:
            break                              # 已到末页（没有更多结果）

    with open(out, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"[done] {len(rows)} 条资产 → {out}（共 {requests_made} 次请求）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
PY
```

### 用法
```bash
mkdir -p runs
python3 runs/shodan_client.py 'hostname:"example.com"' --pages 2 --interval 2.0
python3 runs/shodan_client.py 'ssl:"example.com"' --pages 2
python3 runs/shodan_client.py 'org:"Example LLC"' --pages 2
```

### 落库
读 `runs/shodan-*.jsonl`，逐条 `redteam_asset_add`：`provenance="passive"`、`tool="shodan"`，端口带 `url`、`title`、`product`；hostnames/domains 写进 `names`。

## 常用查询语句
| 目的 | 语句 |
|---|---|
| 某域名全部资产 | `hostname:"example.com"` |
| 证书包含该域名/组织 | `ssl:"example.com"` / `ssl:"Example LLC"` |
| 某网段 | `net:"203.0.113.0/24"` |
| 组织名 | `org:"Example LLC"` |
| 按标题 | `http.title:"login"` |
| 按 body 特征 | `http.html:"/seeyon/"` |
| 按 favicon 哈希扩线 | `http.favicon.hash:<mmh3整数>`（哈希用技能 `infra-pivot` 的 `runs/favicon_hash.py` 计算） |
| 指定端口 | `net:"203.0.113.0/24" port:3306` |
| 按漏洞编号 | `vuln:"CVE-2021-44228"`（会员功能） |

> 宽泛语句（单独 `http.html:` / `http.title:`）结果量大、烧 credit，务必叠加 hostname/net/org 限定。
> **检索词一律用 ASCII 英文技术串**（`admin` / `login` / `api` / `upload` / `seeyon` 这类）；中文文案不作检索词（命中差，见下线红）。
>
> 同源扩线完整流程（指纹提取 → 反查 → CDN 穿透 → 旁站）见技能 `infra-pivot`。
