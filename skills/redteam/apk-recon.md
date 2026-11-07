---
name: apk-recon
description: 安装包静态提取：从 APK/IPA 里抠出后端域名/IP/URL/疑似密钥，转成可继续扩线与漏洞检测的资产种子
whenToUse: 用户发来安装包文件（.apk/.ipa/.aab/.xapk），需要找到它的后端基础设施时
role: recon
enabled: true
---

# 安装包静态提取（APK/IPA → 后端资产种子）

安装包本质是 zip。本技能**只提取不利用**：提取出的域名/IP 落库后按标准流程继续
（扩线见 `infra-pivot`，漏洞检测是后面角色的活）。

## 纪律
- 零硬依赖：zipfile + 正则就够；深度反编译按需用 ASC（见下节），有才用、没有拉倒。
- **安装包不上传任何在线反编译/查毒/沙箱服务**（等于把目标源码交给第三方）；提取与反编译只在本机做。
- **不自动装工具**：系统自带 python3 够用；ASC 缺了就跳过（要装由用户手动 `pip install droidasc`，AI 不代装）。
- **提取为空就如实回报**（加固/混淆的包 strings 可能全是垃圾），不要编造后端资产。
- 疑似密钥只记录不验证：写进 redteam_asset_test 的 test 字段交给漏洞发现角色。

## 提取脚本（零依赖）
```bash
cat > runs/apk_extract.py <<'PY'
#!/usr/bin/env python3
"""安装包静态提取：后端 URL / IP / 疑似密钥。
用法: python3 runs/apk_extract.py <包文件> [--out runs/apk-<name>.txt]
"""
import argparse, os, re, zipfile
from urllib.parse import urlparse

URL_RE = re.compile(rb'https?://[A-Za-z0-9._~:/?#\[\]@!$&\'()*+,;=%-]{6,}')
IP_RE = re.compile(rb'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?![\d.])')
KEY_RE = re.compile(rb'(?i)(?:api[_-]?key|app[_-]?(?:id|key|secret)|secret[_-]?key|access[_-]?key|token)["\'\s:=]{1,4}[A-Za-z0-9_+\-/=.]{8,64}')

SKIP_IP_PREFIX = ('0.', '127.', '255.', '224.')

def extract(path):
    blobs = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.endswith(('.dex', '.so', '.xml', '.json', '.properties', '.js', '.html', '.txt')):
                try:
                    blobs.append(z.read(name))
                except Exception:
                    pass
    text = b'\n'.join(blobs)
    urls = sorted({u.decode('utf-8', 'ignore').rstrip('.,;)\'"') for u in URL_RE.findall(text)})
    ips = sorted({i.decode() for i in IP_RE.findall(text)
                  if not i.decode().startswith(SKIP_IP_PREFIX)})
    keys = sorted({k.decode('utf-8', 'ignore') for k in KEY_RE.findall(text)})
    hosts = sorted({(urlparse(u).hostname or '') for u in urls} - {''})
    return urls, hosts, ips, keys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('package')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    urls, hosts, ips, keys = extract(args.package)
    out = args.out or 'runs/apk-' + re.sub(r'[^A-Za-z0-9_.-]+', '_', os.path.basename(args.package)) + '.txt'
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write('# hosts (域名/主机)\n' + '\n'.join(hosts)
                + '\n\n# ips\n' + '\n'.join(ips)
                + '\n\n# urls\n' + '\n'.join(urls)
                + '\n\n# suspicious keys\n' + '\n'.join(keys) + '\n')
    print(f'hosts={len(hosts)} ips={len(ips)} urls={len(urls)} keys={len(keys)} → {out}')
    if not hosts and not ips:
        print('[warn] 没有提取到后端地址：包可能加固/混淆，如实回报，不要编造', flush=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
PY
mkdir -p runs
python3 runs/apk_extract.py /path/to/app.apk
```

## 深度反编译（零依赖 strings 不够用时）
只留 **ASC** 一条路：有才用、没有就跳到下一节、仍不行就如实回报：
1. **ASC**（`command -v droidasc` 存在时；安装 `pip install droidasc`，不要自动装，没有就跳过）：
   查询式反编译，不用全量落盘——
   ```bash
   droidasc getmanifest <包> -o runs/AndroidManifest.xml   # 直接解码 Manifest
   droidasc findrefs <包> string "http" -o runs/asc-http-refs.txt   # 哪些代码引用了 URL 字符串
   droidasc findrefs <包> string api_key -o runs/asc-key-refs.txt   # 密钥字符串的使用位置
   droidasc getclass <包> <命中类名> -o runs/asc-<类名>.java        # 只反编译命中类拿上下文
   ```
   strings 提出的候选 URL/密钥 → `findrefs` 定位引用代码 → `getclass` 拉上下文——
   这层给出的是 strings 给不了的**语义确认**（这个串是不是真的后端地址/密钥）。
   Manifest 里的 package、权限、exported 组件、meta-data 里的 appid 一并提取落库；
2. 加固/混淆包（strings 为空、findrefs 无命中）：**如实回报"静态提取受限"**，
   把判断依据（提取数量、样本摘录）写清，由指挥者决定是否转抓包分析——不要硬编结果。

所有产出合并去重后落库（tool 仍写 `apk-static`）。

## 落库
- `# hosts` 与 `# ips` 逐条 `redteam_asset_add`：`provenance="passive"`、`tool="apk-static"`；
  域名同时写进 names；URL 里带端口的按端口落；
- `# suspicious keys` 写进对应资产 `redteam_asset_test` 的 `test` 字段，标注"来自安装包静态提取，未验证"；
- 提取完成后向指挥者回报数量与清单摘要，后续扩线/漏洞流程由指挥者派活。
