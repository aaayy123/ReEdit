# curl --resolve 端口陷阱：URL 不带端口 ⇒ 静默逃逸到真实 DNS
#
# ============ 症状 ============
# 对 <IP>:8443 做 vhost 探测时写出：
#     curl -k --resolve "host.example.com:8443:203.0.113.3" https://host.example.com/
# 期待：连到 203.0.113.3:8443。
# 实际：URL 未带端口 ⇒ curl 默认拨 **443**；
#       --resolve 的映射被绑定在 **8443** 上 ⇒ 443 这个端口号没有任何映射被命中
#       ⇒ curl 回落到**真实 DNS 解析** ⇒ 请求发到了 Cloudflare / AWS / 公网真站。
#
# ============ 为什么危险（静默 + 高可信假象） ============
# 1. curl 不报错，HTTP 状态码是 200/301/404，看起来完全正常；
# 2. 返回的是**真实网站的真实内容**，比"目标机空白页"更像"有业务"；
# 3. 于是极容易写出"发现隐藏站点！"这种完全错误的结论——而证据其实来自 CDN。
# 实测踩坑样本（2026-09-29，靶标 tgt9942-com）：
#     target67.example.com        -> 200 len=46913   ← 实为 Cloudflare 后的 WordPress
#     target65.example.com       -> 200 len=15102   ← 实为 CF 回源到另一台 .71:80 的结果
#     target71.example.com  -> 200 len=114     ← 实为 AWS 上 GoDaddy 域名停放页
#     target62.example.com           -> 000             ← 该域真实 DNS 为 NXDOMAIN，暴露了"根本没走 --resolve"
#     （对照：端口为 443 的 .68:443 因端口号恰好匹配，结果才是有效的）
#
# ============ 强制自证的三件套（缺一不可） ============
# 1) URL 必须显式带端口，与 --resolve 的端口**逐字一致**；
# 2) -w 里打印 %{remote_ip}，逐请求核对对端是否 == 目标 IP，不等就标记 ESCAPED；
# 3) 保留一个"真实 DNS 为 NXDOMAIN 的对照域"（如 target62.example.com）作探针——
#    它若返回 000 而其它域返回 200，说明 --resolve 生效（因为该域只能靠 --resolve 解析成功）；
#    它若也能返回内容，说明发生了逃逸。
#
# ============ 正确写法 ============
#   curl.exe -k -s --resolve "host.example.com:8443:203.0.113.3" \
#        -o out.bin -w "%{remote_ip}|%{http_code}" "https://host.example.com:8443/"
# 判读：输出里的 remote_ip 必须等于 203.0.113.3，否则整批数据作废。
#
# 附：等价的安全做法（不依赖 --resolve）
#   curl.exe -k -s -o out.bin -w "%{remote_ip}|%{http_code}" \
#        --connect-to "host.example.com:8443:203.0.113.3:8443" "https://host.example.com:8443/"
#   --connect-to 语义更不易错（src_port:dst_port 成对出现），推荐优先使用。
