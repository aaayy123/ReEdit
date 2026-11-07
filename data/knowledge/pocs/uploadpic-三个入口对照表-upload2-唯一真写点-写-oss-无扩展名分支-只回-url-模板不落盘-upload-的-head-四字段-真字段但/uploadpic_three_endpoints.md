## 一句话
**UpLoadPic 有三个入口，只有一个能写（写 OSS），另外两个是假成功/空响应。别再逐台重测，直接按本表对照。**

## 端点 × 字段 × 真实行为（4 台实测一致：203.0.113.39:8080 / 203.0.113.57:80 / .59:80 / 203.0.113.11:80）

### ① `POST /UpLoadPic/upload2` —— ★ 唯一真写点（未认证）
- **唯一有效字段：multipart 里的 `file`（小写）**；`content` / `Token`（大写）/ `upload` / `image` **全部返回 `{"linkurl":""}`**
- 成功响应：`200` + `{"linkurl":"https://target343.example.com/pic/<时间戳>.<客户端扩展名>/midPic"}`
- **扩展名完全由客户端 filename 决定（无白名单）**：`.png/.jpg/.jsp/.html/.svg` 全保留；`zz.jsp;.png` 取第一个后缀；`zz.jsp.png` 取最后后缀；`../../`、`C:\`、`%2e%2e%2f` 被规范化
- **对象公网可读**：去掉 `/midPic` 直接 GET 原始对象 → 200，字节与上传一致；`.html` → `Content-Type: text/html`（可渲染），`.jsp` → `image/jpeg`
- **落点参数不可控**：`path/dir/folder/prefix/bucket/endpoint/filename/ext/type` 全加也无效
- **`Token` 不是必需**：`Token=1` / 空 / **缺** / 长乱 四种都同样成功

### ② 「无扩展名」分支 = 假落本机（**不落任何 web 可达文件，别再试**）
- filename **不含 ASCII `.`** 时，返回形态变为 `http://<配置里的本机地址>:8080/UpLoadPic/upload/head/<时间戳>_<md5>`
- **文件名 100% 服务端生成、无扩展名** ⇒ 拿不到 `.jsp`
- **回读全 404**：18 种路径形态（含 `/midPic`、后缀、尾斜杠、`/head/`、`/upload/head/`）+ **`..;/` 穿越变体** + 3 台入口 + 6 种 OSS 读法（3 桶 × `/head/`、`/pic/`）+ **7 种 Host 头** → **零命中**
- **Unicode 点可翻转分支但没用**：`。`(U+3002)/`．`(U+FF0E)/`｡`(U+FF61)/`․`(U+2024) 会被判成"无点"→ 进本地分支（证明判断只看 ASCII `.`），但**本地分支照样丢扩展名**
- ⇒ **结论：该分支只回一个按配置拼出的 URL 模板，不落 web 可达文件。**

### ③ `POST /UpLoadPic/upload` —— 两种模式，都不可利用
| 请求体 | 响应 | 判读 |
|---|---|---|
| `head=<base64图片>&userid=<int>&flag=1&type=1`（APK `MyUploadHeadTask` 的真字段） | `200` + **空体(0 字节)** | ★ **字段名确认（走另一条代码路径），但服务端不回 headurl** ⇒ 拿不到落点；疑似头像存储配置未启用 |
| `head=<base64>`（单独） | `500 NumberFormatException` | 说明它确实去 `Integer.parseInt` 读 userid/flag/type |
| `userid=<int>&token=<非空>` | `200` + `-更改成功`（13B） | **无条件假成功**：换 `userid=999999999`（不存在）也"成功"、`token` 不校验；用 `userinfo` 读回**零变化** |
| multipart（`file`/`upload`/`pic`/`upfile`） | `500 NumberFormatException: null` | **该 servlet 不做 multipart 解析**（`getParameter()` 为 null）⇒ 不是上传 servlet |

## 复用要点（省时间的判据）
- **区分"存在"与"不存在"**：Tomcat 404 = 不存在；**500 带 `<pre>` 栈 = 存在**（老 servlet 缺参就 `NumberFormatException`）；`405` = 存在但方法不允许（`upload2` 只认 POST）
- **验证"是否真落盘"**：上传一段**带唯一随机标记**的内容 → 拿到返回 URL → **同一秒立即回读**；回读 200 且内容一致才算落盘
- **验证"是否有 SSRF/写面"时别用单次耗时当判据**（境外链路抖动大）：见知识库里那条"盲 SSRF 差分三值 + A/B/A 复测"
- **红队纪律**：探针一律用无害新文件名（`probe_<rand>`），**不要覆盖目标已有对象**

## 本条的边界（如实）
`/UpLoadPic/upload2` 是**真实有效的未认证写原语**（写目标自有 OSS 桶、扩展名可控、公网可读），但**OSS 不执行 JSP ⇒ 不是 RCE**；**未找到任何"落到能被 Tomcat 执行的位置"的路径**（27 路径形态 / 7 Host / 6 OSS 读法 / Token 变量 / invoker 全否定）。