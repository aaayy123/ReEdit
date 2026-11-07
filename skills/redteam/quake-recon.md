---
name: quake-recon
description: 用 360 Quake API 批量测绘目标资产（域名/IP/端口/服务/标题）；内置限速客户端，支持 CN_PROXY 可选代理（http/socks5）
whenToUse: 信息收集阶段铺开互联网资产面，且已配置 QUAKE_KEY 时；可作为 FOFA/Hunter 的互备数据源
role: recon
enabled: true
---

# Quake 资产测绘（限速安全版）

## 凭据与网络
- API Key：从环境变量 `QUAKE_KEY` 读取（**任何 key 都不要写进仓库**；脚本只读环境变量；脚本同时自动加载 `$DSH_HOME/.env`）
- 代理（可选）：环境变量 `CN_PROXY`，支持 `http://` / `https://` / `socks5://` / `socks5h://`；未设置时直连
- 接口：`POST https://quake.360.cn/api/v3/search/quake_service`
- 头部：`X-QuakeToken: <key>`；JSON 体：`query`、`start`、`size`、`include`
- 返回：`data[]`，每条含 `ip` / `port` / `service.name` / `service.http.title` / `service.http.host` 等；`meta.pagination.total` 是总量

## 限速纪律
- Quake 按积分计费，**单线程、请求间隔 ≥2 秒、默认只取前 1–2 页**（size 100）。
- `code` 非 0 或 HTTP 错误不要死循环重试；积分不足就收手换数据源。
- 结果落盘缓存：`runs/quake-*.jsonl`，同一查询先看缓存。
- 长任务放后台跑（`run_in_background`）。
- 注意：本技能未经实机打表，限额/行为以你账号控制台口径为准，间隔是保守起步值。

## 限速客户端（用这个，不要手写循环）
```bash
cat > runs/quake_client.py <<'PY'
#!/usr/bin/env python3
"""Quake 采集（限速安全）：单线程 + 最小间隔 + 缓存 + 可选代理。

用法:
  python3 runs/quake_client.py 'domain:"example.com"' --pages 2
  CN_PROXY=http://127.0.0.1:7890 python3 runs/quake_client.py 'org:"示例科技有限公司"'
输出:
  runs/quake-<slug>.jsonl   每行一个资产 {ip,port,host,title,service,transport}
"""
import argparse, hashlib, json, os, subprocess, sys, time, urllib.error, urllib.request


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

KEY = os.environ["QUAKE_KEY"]
PROXY = os.environ.get("CN_PROXY", "")        # 可选：http(s):// 或 socks5(h)://
API = "https://quake.360.cn/api/v3/search/quake_service"
INTERVAL = 2.0
HARD_BUDGET = 20
INCLUDE = ["ip", "port", "transport", "service.name", "service.host", "service.http.title", "service.http.server"]


def fetch(query, start, size, timeout=30):
    body = json.dumps({"query": query, "start": start, "size": size, "include": INCLUDE, "latest": True}).encode()
    if PROXY.startswith(("socks5://", "socks5h://")):
        # urllib 不支持 socks：交给 curl（mac/Linux/Win10+ 自带）
        r = subprocess.run(
            ["curl", "-sS", "--proxy", PROXY, "--max-time", str(timeout),
             "-H", f"X-QuakeToken: {KEY}", "-H", "Content-Type: application/json",
             "-d", body.decode(), API],
            capture_output=True, text=True)
        if r.returncode != 0:
            return None, {"code": -1, "message": r.stderr.strip()[:200]}
        return 200, json.loads(r.stdout)
    req = urllib.request.Request(API, data=body, method="POST", headers={
        "X-QuakeToken": KEY, "Content-Type": "application/json", "User-Agent": "redteam-recon/1.0",
    })
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}) if PROXY else urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "ignore"))
        except Exception:
            return e.code, {"code": -1, "message": "http error"}
    except Exception as e:
        return None, {"code": -1, "message": str(e)[:200]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--size", type=int, default=100)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    slug = hashlib.md5(args.query.encode()).hexdigest()[:8]
    out = args.out or f"runs/quake-{slug}.jsonl"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    if os.path.exists(out) and os.path.getsize(out) > 0:
        print(f"[cache] {out} 已存在，如需重拉请先删除", file=sys.stderr)
        return 0

    if PROXY:
        print(f"[proxy] 走 {PROXY.split('://')[0]} 代理访问 Quake", file=sys.stderr)

    seen, rows, made, last_ts = set(), [], 0, 0.0
    for page in range(args.pages):
        wait = INTERVAL - (time.time() - last_ts)
        if wait > 0:
            time.sleep(wait)
        last_ts = time.time()
        made += 1
        if made > HARD_BUDGET:
            print(f"[stop] 达到请求预算 {HARD_BUDGET}", file=sys.stderr)
            break
        status, data = fetch(args.query, page * args.size, args.size)
        if status != 200 or data.get("code") != 0:
            print(f"[stop] http={status} code={data.get('code')} {str(data.get('message', ''))[:120]}", file=sys.stderr)
            break
        arr = data.get("data") or []
        total = ((data.get("meta") or {}).get("pagination") or {}).get("total")
        print(f"[page {page + 1}] {len(arr)} 条，总命中 {total}", file=sys.stderr)
        for item in arr:
            key = (item.get("ip"), item.get("port"))
            if key in seen:
                continue
            seen.add(key)
            svc = item.get("service") or {}
            http = svc.get("http") or {}
            rows.append({
                "ip": item.get("ip", ""), "port": item.get("port", ""),
                "host": svc.get("host", ""), "title": http.get("title", ""),
                "service": svc.get("name", ""), "server": http.get("server", ""),
                "transport": item.get("transport", ""),
            })
        if len(arr) < args.size:
            break

    with open(out, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"[done] {len(rows)} 条资产 → {out}（共 {made} 次请求）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
PY
```

### 用法
```bash
mkdir -p runs
python3 runs/quake_client.py 'domain:"example.com"' --pages 2
python3 runs/quake_client.py 'org:"示例科技有限公司"' --pages 2
CN_PROXY=socks5h://127.0.0.1:7890 python3 runs/quake_client.py 'ip:"203.0.113.0/24"'
```

### 落库
读 `runs/quake-*.jsonl`，逐条 `redteam_asset_add`：`provenance="passive"`、`tool="quake"`，端口带 `url=ip:port`、`title`、`product=service`；域名写进 `names`。

## 常用查询语句
| 目的 | 语句 |
|---|---|
| 某域名全部资产 | `domain:"example.com"` |
| 单位名称 | `org:"示例科技有限公司"` |
| 某 C 段 | `ip:"203.0.113.0/24"` |
| 按标题找后台 | `title:"login" AND domain:"example.com"` |
| 按服务/组件 | `service:"nginx" AND domain:"example.com"` |
| 指定端口 | `ip:"203.0.113.0/24" AND port:"3306"` |
| 按 favicon 哈希扩线 | `favicon:"<mmh3>"`（字段名以平台文档为准；哈希算法同 FOFA icon_hash，用技能 `infra-pivot` 的 `runs/favicon_hash.py` 计算） |

> 宽泛语句（单独 `title:` / `body:`）结果量大、烧积分，务必叠加域名或 IP 限定。
>
> 同源扩线完整流程（指纹提取 → 反查 → CDN 穿透 → 旁站）见技能 `infra-pivot`。
