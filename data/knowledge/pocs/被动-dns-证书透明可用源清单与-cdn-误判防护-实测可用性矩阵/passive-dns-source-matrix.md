目标：为"找 CF 背后的历史源站"和"补全子域"挑选当前真正可用的免费被动源。
2026-09 实测结论（出口：数据中心 VPS，IPv6/IPv4 均可出网）：

【可用】
1) crt.sh —— 证书透明，拿全量子域最可靠，匿名无鉴权：
   curl -s 'https://crt.sh/?q=%25.<domain>&output=json' | jq -r '.[].name_value' | sort -u
   局限：只给域名，不给 IP。
2) api.certspotter.com —— 证书透明，含 wildcard 与带通配的子域，匿名可用（有限速）：
   curl -s 'https://api.certspotter.com/v1/issuances?domain=<d>&include_subdomains=true&expand=dns_names'
3) api.hackertarget.com/hostsearch —— 一次拿"子域→当前 IP"全映射，匿名可用，是本轮最高性价比入口：
   curl -s 'https://api.hackertarget.com/hostsearch/?q=<domain>'
4) getent ahostsv4 / dig —— 实时解析（用于和上面的历史值对比，识别漂移）。
5) rapiddns.io/sameip/<ip>?full=1 —— 同 IP 反查其它站点，用于判断某 IP 是"独服"还是"CDN/共享托管"。

【不可用 / 需付费 / 需登录（都试过）】
- otx.alienvault.com/api/v1/indicators/domain/<d>/passive_dns —— 连接失败，pDNS 历史拿不到。
- api.mnemonic.no/pdns/v3/<d> —— 返回 0 记录（但返回 200，会误导成"没有历史"）。
- rapiddns.io/subdomain/<d>?full=1 —— 返回 200 但解析不出行，不可依赖。
- target43.example.com/iphistory —— 抓取失败（需要人机/JS）。
- grep.app/api/search、searchcode API —— 见"公开代码托管"条目，均不可脚本化。
- whois 反查 IP 归属（hackertarget whois）—— 需要 API key。

【误判防护（重要）】
把"IP 是共享托管/CDN"当成"运营方源站"是本方向最容易犯的错。判据：
- 同 IP 反查出的 hostname 里出现 `.w.kunlunXX.com` / `.target44.example.com` / `.w.cdngslb.com` 后缀
  ⇒ 该 IP 是阿里云 CDN 边缘节点，不是源站。
- 同一 IP 反查出**上百个彼此无关的站点**（不同行业、不同语种）⇒ 共享托管，不能据此认定是目标的机器。
- PTR 为 ec2-*.compute.amazonaws.com / 云厂商默认 PTR ⇒ 只说明是公有云实例。
- 域名解析出的一批 IP 与 PTR 不匹配，且该域是静态资源域 ⇒ 大概率前置 CDN。
