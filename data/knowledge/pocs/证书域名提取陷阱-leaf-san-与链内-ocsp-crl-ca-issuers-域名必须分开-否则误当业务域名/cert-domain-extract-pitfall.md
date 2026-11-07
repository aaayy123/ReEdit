# 从 TLS 证书里提取域名时，必须区分「leaf SAN」与「证书链/AIA/CRLDP 里的基础设施域名」
#
# ============ 症状 ============
# 常见写法（从 DER 里正则捞所有像域名的字符串）：
#     txt = der.decode("latin-1")
#     names = re.findall(r"[A-Za-z0-9*][A-Za-z0-9*._\-]{3,90}", txt)
#     names = [n for n in names if any(n.lower().endswith(t) for t in TLD)]
# 结果里会混进 **Let's Encrypt 的 OCSP / CRL / CA Issuers 服务域名**，例如：
#     yr1.i.lencr.org      <- AIA 扩展里的 "CA Issuers" URL（i = issuer）
#     yr1.c.lencr.org      <- CRL Distribution Point URL（c = CRL），形如 http://yr1.c.lencr.org/74.crl
#     r10.o.lencr.org      <- AIA 扩展里的 OCSP URL（o = ocsp）
# 这些是 **leaf 证书自身携带的扩展字段值**，不是业务域名。
#
# ============ 为什么危险 ============
# 它们看起来完全像一个正常域名（还有 TLD .org），会被直接写进资产表，
# 于是报告里出现"该机部署了 lencr.org 相关业务""同证书反查出 lencr.org 体系"这类错误结论，
# 甚至把 ocsp/crl 端点当成新资产去测绘、去攻击（第三方基础设施，越界风险）。
#
# ============ 正确做法（.NET / 只看 leaf 的 SAN 扩展） ============
#   $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
#   $cn   = $cert.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
#   $e    = $cert.Extensions | ? { $_.Oid.Value -eq "203.0.113.61" }      # subjectAltName —— 真正的业务域名
#   if ($e) { $san = $e.Format($false) -replace 'DNS Name=','' }
#   # 想单独看"哪些是链内 URL"，就另外取这两个扩展，别和 SAN 混在一个字段里：
#   #   AIA   : 203.0.113.4.203.0.113.95.1
#   #   CRLDP : 203.0.113.62
#
# 关键点：`$ssl.RemoteCertificate` 取到的是 **leaf**；
# 用 X509Certificate2 的扩展 API 读 SAN，天然不会把 AIA/CRLDP 里的 URL 当成域名。
#
# ============ 判读基准（本次实测） ============
# 203.0.113.72:8443 / .178:8443 / .188:8443，任意 SNI 下：
#   leaf CN  = example.com   <- 真实业务域名（SAN 也只有这一个）
#   AIA      = http://yr1.i.lencr.org/
#   CRLDP    = http://yr1.c.lencr.org/74.crl
#   ⇒ 三台共用同一张 Let's Encrypt 证书，与"8443 是同一份 10B 占位页代码"自洽。
