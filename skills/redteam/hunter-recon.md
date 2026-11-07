---
name: hunter-recon
description: 用奇安信 Hunter API 批量测绘目标资产（域名/IP/端口/标题/组件）；内置限速客户端，境外机器不配 CN_PROXY 时自动走免费国内代理池（用户指定代理优先）
whenToUse: 信息收集阶段铺开互联网资产面，且已配置 HUNTER_KEY 时；Hunter 在备案/ICP 维度比 FOFA 强
role: recon
enabled: true
---

# Hunter 资产测绘（限速安全版）

## 凭据与网络
- API Key：从环境变量 `HUNTER_KEY` 读取（**任何 key 都不要写进仓库**；脚本只读环境变量；脚本同时自动加载 `$DSH_HOME/.env`）
- **Hunter 接口只允中国大陆 IP 访问**，客户端按下面**四级严格优先**选出口：

  | 优先级 | 出口 | 说明 |
  |---|---|---|
  | 1 | `--proxy <url>` | 本次显式指定，最高优先；失败**不自动**换池（尊重用户指定） |
  | 2 | `CN_PROXY` | 用户指定（环境变量或 `$DSH_HOME/.env`）；失败同样不自动换池 |
  | 3 | **自动免费国内代理池** | 未指定上面两项时自动启用：多源抓取 → 两段验活 → **粘性**选定一条全程使用 |
  | 4 | 直连兜底 | 池为空时；境外机器大概率被拒，会打印警告并提示配 `CN_PROXY` |

  > `--no-proxy` 是**覆盖开关**：完全直连，压过 `CN_PROXY` 与自动池（与 `--proxy` 互斥，同时给会直接报错退出）；`--selftest` 也认它。

  代理支持 `http://` / `https://` / `socks5://` / `socks5h://`（socks5h = DNS 也走代理，优先用它）；**用户给的 scheme 原样交给 curl，绝不降级**。
- **池的定位与边界**（务必守住）：
  - 池**只解决出境地理**（拿到境内出口 IP），**不是配额绕过**——`rest_quota==0` 照样收手（见下节）；
  - **粘性**：每次运行选定一条上游代理后全程复用，**不逐请求轮换**——Hunter 按账号风控，频繁换出口反而更像异常；
  - **失败轮换**：单条代理出现网络错误 / 403 / 429 才剔除并换下一条，最多换 **3** 条；仍不行 → 直连兜底并打印警告。**换完代理重试同一页**（不跳页、不丢结果），重试也算一次请求（`[rotate]`/`[retry]` 与 `[done] …（共 N 次请求）` 可对账）；
  - 池缓存：`runs/cn-proxies-live.txt`（一行一个 `ip:port`），TTL **30 分钟**；过期或为空才重抓。`--refresh-pool` 强制重抓；
  - 铁规则继承技能 `cn-proxy-pool`：代理**只出现在单条命令的 `--proxy` 参数上**，**绝不**写系统/全局代理配置、不 export 长驻环境变量；Hunter 请求**只走 `https://`**，**绝不 `-k/--insecure`**；不通过免费代理传任何其它凭据（仅 Hunter 的 `api-key` 走这条链路）。
- 接口：`GET https://hunter.qianxin.com/openApi/search`
- 参数：`api-key`、`search`（查询语句的 base64）、`page`、`page_size`、`is_web`（1=Web 资产）、`start_time`/`end_time`（可选，YYYY-MM-DD）
- 返回：`data.arr[]`，每条含 `ip` / `port` / `domain` / `title` / `protocol` / `component` / `os` / `isp` / `city` 等；`data.consume_quota` / `data.rest_quota` 是本日配额消耗与剩余

## 限速纪律
- Hunter 免费/低档位每日配额很小，**单线程、请求间隔 ≥2 秒、默认只取前 1–2 页**（page_size 100）。
- **池 ≠ 配额绕过**：换出口 IP 只变网络路径，不会多给你一条配额；配额纪律与出口无关。
- 遇到非 200 或 `code` 非 200 的响应不要死循环重试；配额耗尽（`rest_quota` 为 0）就收手换数据源。
- 结果落盘缓存：`runs/hunter-*.jsonl`，同一查询先看缓存再决定要不要重拉。
- 长任务放后台跑（`run_in_background`），别阻塞对话。
- 注意：本技能未经实机打表配额口径，限额/行为以你账号控制台的当日口径为准，上面的间隔是保守起步值（代理链路本身已实测，见下节自检表）。

## 限速客户端（用这个，不要手写循环）
```bash
cat > runs/hunter_client.py <<'PY'
#!/usr/bin/env python3
"""Hunter 采集（限速安全）：单线程 + 最小间隔 + 退避 + 缓存 + 代理优先级。

代理优先级：--no-proxy（完全直连，覆盖下面全部） > --proxy 显式 > CN_PROXY（含 $DSH_HOME/.env） > 自动国内免费代理池 > 直连兜底。
自动池：多源抓取 → 两段验活（出口地理=CN + 可达 Hunter）→ 粘性选定一条全程使用；
       缓存 runs/cn-proxies-live.txt，TTL 30 分钟。池内代理失败只在池内换下一条，并重试同一页。

用法:
  python3 runs/hunter_client.py 'domain="example.com"' --pages 2
  python3 runs/hunter_client.py 'domain="example.com"' --proxy socks5h://127.0.0.1:7890
  CN_PROXY=socks5h://127.0.0.1:7890 python3 runs/hunter_client.py 'icp.name="示例科技有限公司"'
  python3 runs/hunter_client.py --selftest              # 只验代理链路，不调用 Hunter、不需 HUNTER_KEY
  python3 runs/hunter_client.py 'domain="example.com"' --no-proxy   # 完全直连（覆盖 CN_PROXY 与自动池）
  python3 runs/hunter_client.py 'domain="example.com"' --refresh-pool
输出:
  runs/hunter-<slug>.jsonl        每行一个资产 {ip,port,domain,title,protocol,component,isp,city}
  runs/cn-proxies-live.txt        验活后的国内代理（一行一个 ip:port，TTL 内复用）
"""
import argparse, base64, concurrent.futures, hashlib, json, os, re, subprocess, sys, time, urllib.parse


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
                os.environ.setdefault(k.strip(), v.strip().strip("'").strip('"'))
    except OSError:
        pass


_load_dsh_env()

API = "https://hunter.qianxin.com/openApi/search"
HUNTER_PROBE = "https://hunter.qianxin.com/"
GEO_PROBE = "http://ip-api.com/json/?fields=countryCode,query"   # 免 key；返回体字段 countryCode / query
UA = "redteam-recon/1.0"           # 直连实测 200；Hunter 边缘 WAF 只挡 `curl/*` 这种自称 UA，不挡本 UA
UA_SRC = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
POOL_CACHE = "runs/cn-proxies-live.txt"
POOL_TTL = 1800                     # 秒；缓存不过期就不重抓
POOL_WORKERS = 10                   # 验活并发
POOL_TIMEOUT = 6                    # 单条验活超时（秒），两段各一次
MAX_ROTATION = 3                    # 池内最多换几条；仍不行 → 直连兜底 + 警告
ACCEPT_PROBE = {200, 301, 302}      # 本机直连基线=200（UA=UA），故只认 2xx/3xx
INTERVAL = 2.0                      # Hunter 请求最小间隔（秒）
HARD_BUDGET = 20                    # 单次运行最多请求次数

# 源列表：每项 (名字, URL, 解析方式)。解析方式见 parse_source；全部逐源实测可抓取+可解析。
POOL_SOURCES = [
    ("89ip", "https://www.89ip.cn/tqdl.html?api=1&num=50&port=&address=%E4%B8%AD%E5%9B%BD&isp=", "ip:port"),
    ("ip3366", "http://www.ip3366.net/free/?stype=1", "td:gb2312"),
    ("proxifly", "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/CN/data.txt", "lines"),
    ("proxyscrape", "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&country=CN", "lines"),
    ("geonode", "https://proxylist.geonode.com/api/proxy-list?limit=100&country=CN", "geonode"),
    ("kuaidaili", "https://www.kuaidaili.com/free/inha/", "td:utf-8"),
]

_IPPORT = re.compile(r"(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})")


def curl(url, proxy=None, timeout=30, ua=UA):
    """单条命令级代理（绝不写系统/全局配置）。返回 (status|None, body: bytes)。"""
    cmd = ["curl", "-sS", "--max-time", str(timeout), "-A", ua, "-o", "-", "-w", "\n@@%{http_code}"]
    if proxy:
        cmd += ["--proxy", proxy]
    cmd.append(url)
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout + 4)
    except (subprocess.TimeoutExpired, OSError) as e:
        return None, str(e)[:120].encode()
    body, _sep, code = r.stdout.rpartition(b"\n@@")
    try:
        code_i = int(code)
    except ValueError:
        return None, (r.stderr.decode("utf-8", "ignore").strip()[:120] or "no-code").encode()
    return (None if code_i == 0 else code_i), body


def parse_source(kind, body):
    """把一个源的响应体（bytes）解析成 {'ip:port'}。"""
    out = set()
    if kind == "ip:port":
        for m in _IPPORT.finditer(body.decode("utf-8", "ignore")):
            out.add("%s:%s" % m.groups())
    elif kind.startswith("td:"):
        html = body.decode(kind.split(":", 1)[1], "ignore")
        for m in re.finditer(r"<td[^>]*>(\d{1,3}(?:\.\d{1,3}){3})</td>\s*<td[^>]*>(\d{2,5})</td>", html):
            out.add("%s:%s" % m.groups())
    elif kind == "lines":
        # 一行一个，可带 http(s):// 前缀；含 socks 的行跳过（池统一按 http 代理用）
        for line in body.decode("utf-8", "ignore").splitlines():
            line = line.strip()
            if not line or "socks" in line.lower():
                continue
            m = re.match(r"^(?:https?://)?(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})$", line)
            if m:
                out.add(m.group(1))
    elif kind == "geonode":
        for x in (json.loads(body) or {}).get("data") or []:
            if any(p in ("http", "https") for p in (x.get("protocols") or [])):
                out.add("%s:%s" % (x.get("ip"), x.get("port")))
    return {p for p in out if p and "None" not in p}


def fetch_candidates():
    """逐源抓取解析；返回 (候选集合, 逐源计数列表)。"""
    cands, stats = set(), []
    for name, url, kind in POOL_SOURCES:
        try:
            st, body = curl(url, timeout=25, ua=UA_SRC)
            got = parse_source(kind, body) if st == 200 and body else set()
        except Exception:
            got = set()
        stats.append((name, url, kind, len(got)))
        cands |= got
    return cands, stats


def validate(target):
    """两段验活：① 出口地理必须是 CN（经该代理访问免 key 地理接口）；② 该代理能拿到 Hunter 边缘响应。

    target 允许三种形态：`ip:port`（池条目，按 http 代理用）、完整 proxy URL（含 scheme，原样用，
    不降级 http——`socks5h://` / `https://` 必须原样交给 curl）、`None`（直连，供 --no-proxy 自检）。
    """
    px = None if target is None else (target if "://" in target else "http://" + target)
    st, body = curl(GEO_PROBE, proxy=px, timeout=POOL_TIMEOUT)
    if st != 200:
        return target, None, None
    try:
        cc = json.loads(body).get("countryCode")
    except Exception:
        return target, None, None
    if cc != "CN":
        return target, cc, None
    hst, _ = curl(HUNTER_PROBE, proxy=px, timeout=POOL_TIMEOUT)
    return target, cc, hst


def _cache_fresh():
    try:
        return time.time() - os.path.getmtime(POOL_CACHE) < POOL_TTL
    except OSError:
        return False


def read_cache():
    try:
        with open(POOL_CACHE, encoding="utf-8") as f:
            return [l.strip() for l in f if l.strip() and not l.startswith("#")]
    except OSError:
        return []


def write_cache(proxies):
    """原子落盘：写临时文件 + fsync + os.replace，避免中断留下半截缓存/丢条目。"""
    os.makedirs(os.path.dirname(POOL_CACHE) or ".", exist_ok=True)
    tmp = POOL_CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(proxies) + ("\n" if proxies else ""))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, POOL_CACHE)


def build_pool(refresh=False):
    """返回验活通过的 ip:port 列表（缓存新鲜则直接用缓存）。"""
    if not refresh and _cache_fresh():
        cached = read_cache()
        if cached:
            print(f"[pool] 复用缓存 {POOL_CACHE}（{len(cached)} 条，TTL {POOL_TTL // 60} 分钟）", file=sys.stderr)
            return cached
    t0 = time.time()
    cands, stats = fetch_candidates()
    for name, url, kind, n in stats:
        print(f"[pool] 源 {name}: 抓到 {n} 条  ({url})", file=sys.stderr)
    print(f"[pool] 合并去重 {len(cands)} 条候选，开始两段验活（{POOL_WORKERS} 并发，单条 {POOL_TIMEOUT}s）", file=sys.stderr)
    live = []
    if cands:
        with concurrent.futures.ThreadPoolExecutor(max_workers=POOL_WORKERS) as ex:
            for ip_port, cc, hst in ex.map(validate, sorted(cands)):
                if cc == "CN" and hst in ACCEPT_PROBE:
                    live.append(ip_port)
                    print(f"[pool]   ✔ {ip_port} 出口地理=CN Hunter={hst}", file=sys.stderr)
    print(f"[pool] 验活通过 {len(live)}/{len(cands)} 条，用时 {time.time() - t0:.1f}s", file=sys.stderr)
    write_cache(live)
    return live


def resolve_proxy(args):
    """返回 (proxy_url|None, 来源标签, 来源类型)。--no-proxy > --proxy > CN_PROXY > 自动池 > 直连。"""
    if args.no_proxy:
        return None, "直连（--no-proxy 强制，覆盖 CN_PROXY 与自动池）", "direct"
    if args.proxy:
        return args.proxy, "--proxy（本次显式）", "explicit"
    env_proxy = os.environ.get("CN_PROXY", "").strip()
    if env_proxy:
        return env_proxy, "CN_PROXY（用户指定）", "env"
    pool = build_pool(refresh=args.refresh_pool)
    if pool:
        return "http://" + pool[0], f"自动国内代理池（{pool[0]}，共 {len(pool)} 条可用）", "pool"
    print("[warn] 免费国内代理池当前 0 条可用：将直连 Hunter，境外机器大概率被拒。"
          "请设 CN_PROXY 指定你自己的国内代理。", file=sys.stderr)
    return None, "直连（池空兜底）", "direct"


def drop_from_cache(ip_port):
    rest = [p for p in read_cache() if p != ip_port]
    write_cache(rest)
    return rest


def selftest(args):
    """只验代理链路：缓存复验 + 解析代理 + 两段验活 + 打印；不调用 Hunter、不需要 HUNTER_KEY。"""
    t0 = time.time()
    if args.no_proxy:
        # 直连自检：两段独立探测（不因出口非 CN 就短路，否则测不出"直连到底通不通"）
        print("[selftest] 代理优先级：--no-proxy → 完全直连（忽略 CN_PROXY 与自动池），不抓池", file=sys.stderr)
        gst, gbody = curl(GEO_PROBE, proxy=None, timeout=POOL_TIMEOUT)
        try:
            cc = json.loads(gbody).get("countryCode") if gst == 200 else None
        except Exception:
            cc = None
        hst, _ = curl(HUNTER_PROBE, proxy=None, timeout=POOL_TIMEOUT)
        ok = hst in ACCEPT_PROBE
        print(f"[selftest] 直连两段探测 出口地理={cc}（geo http={gst}） Hunter={hst}（阈值 ∈{sorted(ACCEPT_PROBE)}）", file=sys.stderr)
        note = "" if cc == "CN" else f"；出口非境内（{cc}），/openApi/search 大概率被拒，请配 CN_PROXY"
        print(f"[selftest] 结论：{'直连可达' if ok else '直连不可达'}{note}，用时 {time.time() - t0:.1f}s", file=sys.stderr)
        return 0 if ok else 2
    if args.proxy or os.environ.get("CN_PROXY", "").strip():
        src = "--proxy" if args.proxy else "CN_PROXY"
        proxy = args.proxy or os.environ.get("CN_PROXY", "").strip()
        print(f"[selftest] 代理优先级：用户指定（{src}）→ 不抓池，不替换：{proxy}", file=sys.stderr)
        _, cc, hst = validate(proxy)     # 原样（含 scheme）交给 curl，不降级为 http
        print(f"[selftest] 两段验活 出口地理={cc} Hunter={hst}（阈值 countryCode==CN 且 Hunter∈{sorted(ACCEPT_PROBE)}）", file=sys.stderr)
        ok = cc == "CN" and hst in ACCEPT_PROBE
        print(f"[selftest] 结论：{'通过' if ok else '未通过（用户指定代理不自动替换为池）'}，用时 {time.time() - t0:.1f}s", file=sys.stderr)
        return 0 if ok else 2

    cached = read_cache()
    if cached:
        fresh = _cache_fresh()
        print(f"[selftest] 缓存 {POOL_CACHE}：{len(cached)} 条，TTL 内={fresh}；逐条复验（顺序即粘性优先级）", file=sys.stderr)
        alive = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=POOL_WORKERS) as ex:
            for ip_port, cc, hst in ex.map(validate, cached):
                if cc == "CN" and hst in ACCEPT_PROBE:
                    alive.append(ip_port)
                    print(f"[selftest]   ✔ 缓存命中 {ip_port}", file=sys.stderr)
                else:
                    print(f"[selftest]   ✘ 剔除缓存 {ip_port}（地理={cc} Hunter={hst}）→ 换下一条", file=sys.stderr)
        if alive != cached:
            write_cache(alive)
        if alive:
            print(f"[selftest] 缓存可用首条（粘性选定）：http://{alive[0]}", file=sys.stderr)
        else:
            print("[selftest] 缓存条目全部失效，已清空 → 走全量重抓", file=sys.stderr)
    else:
        print(f"[selftest] 缓存 {POOL_CACHE} 不存在 → 全量重抓", file=sys.stderr)

    cands, stats = fetch_candidates()
    for name, url, kind, n in stats:
        print(f"[selftest] 源 {name}: {n} 条  ({url})", file=sys.stderr)
    print(f"[selftest] 合并去重 {len(cands)} 条", file=sys.stderr)
    live = []
    if cands:
        with concurrent.futures.ThreadPoolExecutor(max_workers=POOL_WORKERS) as ex:
            for ip_port, cc, hst in ex.map(validate, sorted(cands)):
                if cc == "CN":
                    mark = "✔" if hst in ACCEPT_PROBE else "✘"
                    print(f"[selftest]   {mark} {ip_port} 地理=CN Hunter={hst}", file=sys.stderr)
                    if hst in ACCEPT_PROBE:
                        live.append(ip_port)
    print(f"[selftest] 验活通过 {len(live)}/{len(cands)}，用时 {time.time() - t0:.1f}s", file=sys.stderr)
    if live:
        print(f"[selftest] 选定（粘性）：http://{live[0]} —— 本次运行全程用它", file=sys.stderr)
        write_cache(live)
    else:
        print("[selftest] 0 条可用：实际查询会直连兜底（境外机器大概率被拒），请设 CN_PROXY。", file=sys.stderr)
    return 0 if live else 2


def fetch(query, page, size, proxy, timeout=30):
    qs = urllib.parse.urlencode({
        "api-key": KEY,
        "search": base64.b64encode(query.encode()).decode(),
        "page": page, "page_size": size, "is_web": 1,
    })
    st, body = curl(API + "?" + qs, proxy=proxy, timeout=timeout)
    if st is None:
        return None, {"code": -1, "message": body.decode("utf-8", "ignore")}
    try:
        data = json.loads(body)
    except Exception:
        return st, {"code": st, "message": body.decode("utf-8", "ignore")[:120]}
    if not isinstance(data, dict):
        # 免费代理/中间设备可能回 200 + `[]`/`"x"`/`null`：按不可用处理，不让 data.get 崩栈
        return st, {"code": -1, "message": "非对象 JSON: " + str(data)[:100]}
    return st, data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="?")
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--size", type=int, default=100)
    ap.add_argument("--out", default=None)
    who = ap.add_mutually_exclusive_group()
    who.add_argument("--proxy", default=None, help="本次显式代理（优先于 CN_PROXY 与自动池）")
    who.add_argument("--no-proxy", action="store_true", help="完全直连：覆盖 CN_PROXY 与自动池")
    ap.add_argument("--refresh-pool", action="store_true", help="忽略缓存，强制重抓代理池")
    ap.add_argument("--selftest", action="store_true", help="只验代理链路，不调用 Hunter、不需 HUNTER_KEY")
    args = ap.parse_args()

    if args.selftest:
        return selftest(args)
    if not args.query:
        print("缺少查询语句（或用 --selftest）", file=sys.stderr)
        return 2

    global KEY
    KEY = os.environ.get("HUNTER_KEY", "")
    if not KEY:
        print("[stop] 未找到 HUNTER_KEY（环境变量或 $DSH_HOME/.env）", file=sys.stderr)
        return 2

    slug = hashlib.md5(args.query.encode()).hexdigest()[:8]
    out = args.out or f"runs/hunter-{slug}.jsonl"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    if os.path.exists(out) and os.path.getsize(out) > 0:
        print(f"[cache] {out} 已存在，如需重拉请先删除", file=sys.stderr)
        return 0

    proxy, source, kind = resolve_proxy(args)
    print(f"[proxy] 使用 {proxy or '直连'}（来源：{source}）", file=sys.stderr)

    seen, rows, made, last_ts, rotations = set(), [], 0, 0.0, 0
    page = 1
    while page <= args.pages:
        wait = INTERVAL - (time.time() - last_ts)
        if wait > 0:
            time.sleep(wait)
        last_ts = time.time()
        made += 1
        if made > HARD_BUDGET:
            print(f"[stop] 达到请求预算 {HARD_BUDGET}", file=sys.stderr)
            break
        status, data = fetch(args.query, page, args.size, proxy)
        # 网络错误 / 403 / 429：池内换下一个；显式或 CN_PROXY 指定的一律不替换（尊重用户指定）
        if status is None or status in (403, 429):
            if kind == "pool" and rotations < MAX_ROTATION:
                rotations += 1
                bad = re.sub(r"^\w+://", "", proxy)
                rest = drop_from_cache(bad)
                print(f"[rotate] {bad} 失败（status={status}），剔除并换下一条（第 {rotations}/{MAX_ROTATION} 次）", file=sys.stderr)
                if not rest:
                    proxy, source, kind = None, "直连（池已耗尽）", "direct"
                    print("[warn] 池内已无可用代理：直连兜底，境外机器大概率被拒；请设 CN_PROXY。", file=sys.stderr)
                else:
                    proxy = "http://" + rest[0]
                    print(f"[rotate] 改用 {proxy}", file=sys.stderr)
                last_ts = 0.0      # 换代理后立即重试，不再等间隔
                # made 不归还：它就是"实际发出的请求数"，重试也算一发，日志可对账
                print(f"[retry] 重试第 {page} 页（当前出口：{proxy or '直连'}）", file=sys.stderr)
                continue           # page 不变 → 重试当前页，不丢结果
            if kind in ("explicit", "env"):
                print(f"[stop] 用户指定的代理失败（{source}，status={status}）：按设计不自动替换为免费池，"
                      "请自行检查该代理", file=sys.stderr)
                break
        if status != 200 or data.get("code") != 200:
            print(f"[stop] http={status} code={data.get('code')} {str(data.get('message', ''))[:120]}", file=sys.stderr)
            break
        arr = (data.get("data") or {}).get("arr") or []
        rest_q = (data.get("data") or {}).get("rest_quota")
        print(f"[page {page}] {len(arr)} 条，当日剩余配额 {rest_q}", file=sys.stderr)
        for item in arr:
            key = (item.get("ip"), item.get("port"))
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "ip": item.get("ip", ""), "port": item.get("port", ""),
                "domain": item.get("domain", ""), "title": item.get("title", ""),
                "protocol": item.get("protocol", ""),
                "component": item.get("component", ""),
                "isp": item.get("isp", ""), "city": item.get("city", ""),
            })
        if rest_q == 0:
            print("[stop] 当日配额已用完", file=sys.stderr)
            break
        if len(arr) < args.size:
            break
        page += 1               # 只有真正落库成功才推进页号

    with open(out, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"[done] {len(rows)} 条资产 → {out}（共 {made} 次请求）", file=sys.stderr)
    return 0


KEY = ""
if __name__ == "__main__":
    sys.exit(main())
PY
```

### 用法
```bash
mkdir -p runs

# ① 不指定任何代理：自动用免费国内代理池（境外机器的默认姿势）
python3 runs/hunter_client.py 'domain="example.com"' --pages 2

# ② 用户指定代理：它优先于池（本次显式 --proxy，或环境变量 CN_PROXY）
python3 runs/hunter_client.py 'icp.name="示例科技有限公司"' --proxy socks5h://127.0.0.1:7890
CN_PROXY=socks5h://127.0.0.1:7890 python3 runs/hunter_client.py 'ip="203.0.113.0/24"'

# ③ 自检链路：只抓池 + 两段验活 + 打印，不调用 Hunter、不需要 HUNTER_KEY
python3 runs/hunter_client.py --selftest

# ④ 完全直连：覆盖 CN_PROXY 与自动池（排查代理问题时用；境外机器大概率被 Hunter 拒）
python3 runs/hunter_client.py 'domain="example.com"' --no-proxy
python3 runs/hunter_client.py --selftest --no-proxy     # 自检也认它：只测直连到底通不通

# ⑤ 强制重抓代理池（缓存看着不对时）
python3 runs/hunter_client.py 'domain="example.com"' --refresh-pool
```

### 代理链路自检表（2026-10-10 实机实测）

池的**源**（抓取 → 解析，均为实测可抓可解析；多源合并去重后本地实测 ~200 条候选）：

| 源 | URL | 实测抓取条数 | 解析方式 |
|---|---|---|---|
| 89ip | `https://www.89ip.cn/tqdl.html?api=1&num=50&port=&address=%E4%B8%AD%E5%9B%BD&isp=` | 8 | 正文里 `ip:port` 直接正则 |
| ip3366 | `http://www.ip3366.net/free/?stype=1` | 15 | HTML 表格 `<td>ip</td><td>port</td>`，**须按 gb2312 解码** |
| proxifly（GitHub CN 列表） | `https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/CN/data.txt` | 125（http/https 行；socks 行不用） | 一行一个，剥 `http(s)://` 前缀 |
| proxyscrape | `https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&country=CN` | 20–24 | 一行一个 `ip:port` |
| geonode | `https://proxylist.geonode.com/api/proxy-list?limit=100&country=CN` | 49–51（http/https 条目） | JSON `data[].ip` + `.port`（`protocols` 含 http/https） |
| kuaidaili | `https://www.kuaidaili.com/free/inha/` | 12 | HTML 表格 `<td class="kdl-table-cell">` |

实测**不可用、故不收录**的源：`free-proxy.cz`（20s 超时无响应）、`zdaye.com/free/`（返回 200 但 IP 由 JS 渲染，正文 0 条）、`proxy.scdn.io`（不可达）。

**两段验活**（并发 10、单条 6s）：

| 阶段 | 接口 / 目标 | 字段 / 判定 | 本机直连基线 | 经代理实测 |
|---|---|---|---|---|
| ① 出口地理 | `http://ip-api.com/json/?fields=countryCode,query`（免 key） | `countryCode` 必须 == `CN` | 本机出口在日本，直连返回 `countryCode=JP`（`query` 是出口 IP）——判据是**真判据**不是恒真 | 命中代理返回 `countryCode=CN` |
| ② 可达 Hunter | `https://hunter.qianxin.com/`（零配额，**不用 `/openApi/search`**） | 状态码 ∈ `{200, 301, 302}` | 直连 **200**（UA = `redteam-recon/1.0`） | 可用代理 200；死代理连接失败（000） |

> 坑（已实测）：Hunter 边缘是 nginx + `WZWS-RAY` WAF，**只按 UA 挡**——`curl/*` 这种自称 UA 一律 **403**，而 `redteam-recon/1.0`（客户端自身 UA）与浏览器 UA 都是 200。所以别用 curl 默认 UA 去判断"境外打不通"。**地理限制在 `/openApi/search` 接口上**（境外出口拿不到数据），池解决的正是它。

**依赖**：`python3`（仅标准库：`concurrent.futures` / `subprocess` / `urllib.parse` / `json` / `base64`）+ `curl`（http/socks 代理与 https 请求统一走它；mac/Linux/Win10+ 自带）。

### 落库
读 `runs/hunter-*.jsonl`，逐条 `redteam_asset_add`：`provenance="passive"`、`tool="hunter"`，端口带 `url=ip:port`、`title`、`product=component`；域名写进 `names`。

## 常用查询语句
| 目的 | 语句 |
|---|---|
| 某域名全部资产 | `domain="example.com"` |
| 单位名称（ICP 备案） | `icp.name="示例科技有限公司"` |
| 某 C 段 | `ip="203.0.113.0/24"` |
| 按标题找后台 | `title="admin" AND domain="example.com"` |
| 按组件 | `component.name="nginx" AND domain="example.com"` |
| 指定端口 | `ip="203.0.113.0/24" AND port="3306"` |
| 按 favicon 哈希扩线 | 图标哈希字段（语法以平台文档为准；哈希算法同 FOFA icon_hash，用技能 infra-pivot 的 `runs/favicon_hash.py` 计算） |

> 宽泛语句（单独 `title=` / `body=`）结果量大、烧配额，务必叠加域名或 IP 限定。
>
> **检索词用英文技术串**（`host` / `title` / `body` / `component` / `cert` 落库都是英文形态，中文词检索不到）；只有主体标识（单位全称/简称/品牌词，`icp.name=`）才用中文。
>
> 同源扩线完整流程（指纹提取 → 反查 → CDN 穿透 → 旁站）见技能 infra-pivot。
