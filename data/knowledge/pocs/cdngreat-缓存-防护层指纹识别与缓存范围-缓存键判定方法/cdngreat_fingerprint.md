# CDNGreat 缓存/DDoS 防护层指纹与判定方法（example.com 实测）

## 一、指纹特征
1. 响应头 `cl-cache-status: HIT|MISS`（非标准头，区别于 Cloudflare 的 cf-cache-status / CloudFront 的 x-cache）
2. 被缓存资源附带 `cache-control: max-age=2592000`（30 天，注意：这是缓存层注入的，不是源站配置）
3. 响应头 `Vary: Accept-Encoding, Accept-Encoding`（重复声明，且 gzip 桶的响应只回一个 Vary —— 实现不规范）
4. 校验失败时返回**非标准状态码 `800`**，页内自带：
   `<p>访问代码: 800</p><p>访问编号: <uuid></p><p>访问方法: GET </p><p>访问网址: https://{Host}{path} </p><p>游客地址: {出口IP} </p><p>访问时间: ... </p><p>域名不存在</p>`
5. 报文级校验失败返回 400，页内 `<title>target302.example.com</title>` 与 `<p>DDoS protection by  CDNGreat</p>`
6. Host 不在白名单时**直接由缓存层响应、不回源**（这也是枚举虚拟主机的快捷手段）

## 二、判定命令
```bash
# 找缓存层生效范围（哪个路径带 cl-cache-status）
curl -s -i -k "https://TARGET/url.js" | grep -iE 'cl-cache-status|age|cache-control|vary'
curl -s -i -k "https://TARGET/home"   | grep -iE 'cl-cache-status|age'   # 动态路由通常无该头

# 确认 query 是否进缓存 key（两次不同随机值都应 MISS，第三次同值 HIT）
curl -s -i -k "https://TARGET/url.js?cb=rand1" | grep -i cl-cache-status
curl -s -i -k "https://TARGET/url.js?cb=rand2" | grep -i cl-cache-status
curl -s -i -k "https://TARGET/url.js?cb=rand1" | grep -i cl-cache-status

# 参数名归一化验证（若下述都 HIT 同一条目，则参数名被丢弃）
for q in "v=VAL" "V=VAL" "=VAL" "v=VAL&&" "v=VAL;x=1"; do
  curl -s -i -k "https://TARGET/url.js?$q" | grep -i cl-cache-status
done

# 枚举虚拟主机（800 = Host 不在白名单；200 = 命中）
curl -s -i -k "https://TARGET/" -H "Host: m.TARGET" | head -1
```

## 三、攻防要点
- 该层**只缓存静态扩展名资源**，`/home`、`/xxa/*.json` 之类动态路由不入缓存 → 传统缓存投毒/缓存欺骗在该架构上通常打不动，务必先用上面命令确认缓存范围再投入时间。
- Host 校验失败页会把 Host 原样写进"访问网址"，属反射型信息泄露（可做钓鱼域名探测/内部域名探测的侧信道），但因状态码 800 不入缓存，无法升级为缓存投毒。
- 参数名归一化（参数名被丢弃、只有参数值进 key）会造成缓存键碰撞；若目标存在任何"按参数名区分业务含义"的可缓存端点，即可尝试跨租户/跨渠道缓存混淆。
- 报文级畸形（CL+TE 冲突、dual-CL、负 CL）都返回 400 而非透传，说明该层做了报文校验，走私风险较低。
