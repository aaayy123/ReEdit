# 「用户可控字段 → 无鉴权公开接口渲染 → 面向全站访客的投毒链」通用验证法

## 适用
任何 SPA 站点：存在①一个"用户可写且服务端不做内容校验"的字段（头像/昵称/签名/简介/封面），
且②一个"未鉴权即可读、且会把该字段渲染给其他访客"的公开接口（排行榜/榜单/公告/公屏）。

## 四步验证（只写无害 canary，必回滚）
1) 【找可写字段】在已登录会话里遍历资料类写接口，逐个塞入一个可辨识的外部 URL canary：
   `POST /api/updateHeadPicture  {"headPicture":"https://<CANARY_DOMAIN>/hp-canary.png"}`
   判定：返回 success 且**回读接口能读到该值**（例：`POST /api/refreshUserInSession` 读回
   `headPictureUrl` 已变为该外链，且服务端未做域名白名单 / 未回写自家 CDN 前缀）→ 可写成立。
2) 【找公开渲染面】无 Cookie 请求公开榜单类接口，逐条看是否带该字段：
   `POST /api/queryHomePageInitialization {}` → 200 {"totalAmount":101,"data":[{"loginname":"s****30",
   "headPictureUrl":"https://example.com/headpicture/head5.png?v=237"},...]}
   判定：返回该字段且前端以 <img :src> 直接渲染 → 渲染面成立。
3) 【升级判定】读前端清洗器，确认能否升级为可执行 XSS：
   - 渲染面是否只有属性绑定（Vue `<img :src>` / van-image）→ 无 HTML 注入点；
   - 清洗器协议白名单里有没有 `data:`（例：`_r={href:new Set(["http:","https:","mailto:","tel:"]),
     src:new Set(["http:","https:"])}` → 没有）；data: 是否只放行图片 MIME
     （例：`/^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z\d+\/=\s]+$/i` → svg 被拒）。
   → 属性绑定 + 无 data: + svg 被拒 = **内容注入成立、可执行 XSS 不成立**。
4) 【必回滚】立刻把字段写回原值并回读确认：
   `POST /api/updateHeadPicture {"headPicture":"head3.png"}` → 读回 headPictureUrl 已恢复 CDN 原值。

## 如实边界（务必照抄进报告，勿夸大）
- 本次**未实现越权写他人**（前端所有资金/资料接口都不传 userId，服务端按会话取人）；
- 投毒生效需**受害者本人出现在该公开榜单**（榜单多只收录有业务记录的用户），本次 canary 未出现在榜单；
- 因此定级依据是「任意外链原样落库 + 公开接口无鉴权渲染该字段」，**不是**"已污染他人可见页面"。

## 加固建议
写入侧加内容校验（域名白名单 / 仅允许平台内置头像名）；渲染侧对图片 URL 走 `safe-url`
（协议白名单且不禁用域名白名单）；公开榜单字段改为服务端拼固定 CDN 前缀 + 白名单文件名。
