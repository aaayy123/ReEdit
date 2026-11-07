可直接复用的源码获取链：
1. CDN 查询（不需要知道精确 URL）：
   https://example.com/cdx/search/cdx?url=example.com&matchType=domain&limit=3000&collapse=urlkey&fl=original,timestamp,statuscode
   过滤 `a=do` 即得全部 did 下载项快照清单。
2. 官方下载页快照（版本↔did 映射，2009-08-29 抓的）：
   https://example.com/web/20090829174349/http://example.com/?m=download
   其中「PHPWind v7.3.2」：安装包 did=372(GBK)/373(BIG5)/374(UTF8)；升级包 did=375(GBK)/376(BIG5)/377(UTF8)；补丁包 did=385/386/387。
3. 直接下二进制（注意用 if_ 前缀，否则 302 到带工具栏 HTML 包装页）：
   curl -o pw732_upto_gbk.zip "https://example.com/web/20091031175948if_/http://example.com/example.com?m=download&a=do&did=375"
   → 2,570,704B，PK 头，内层 Upto_GBK_7.3.2/upload/ 即全量程序树（wind_version='7.3.2'，双处确认）。
   注意：有些快照会 302 重定向到 HTML 包装页（Content-Type: text/html、长度 ~9KB），此时换 2009 年的其它 timestamp 或直接找 did=439~466 这类多快照项参考重定向行为；schannel 证书报错用 -k。
4. Windows 本机注意：PowerShell 里 || 与 $ 需引号保护，批量文本分析用 python 读 gbk。
已知未存档：did=372 安装包（含 install/ 与完整 data/ 结构）无任何快照。