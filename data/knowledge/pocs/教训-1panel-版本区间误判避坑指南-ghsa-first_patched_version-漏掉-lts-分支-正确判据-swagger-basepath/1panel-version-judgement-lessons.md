# 教训：1Panel 版本区间不能靠「某个 CVE 存在于哪个版本」反推，也不能靠 release notes 的功能时间线反推

## 被证伪的错误推理链（真实踩过的坑）
1. 观察到目标有 `/api/v1/auth/intl`、`/settings/ssl/info`、`/settings/basedir`、`/websites/proxy/file` 等路由；
2. 查官方 release notes，看到 v2.0.1「新增 AI 建站功能」、v2.0.16「支持 GPU 实时和历史监控」、v2.0.17「GPU 历史记录刷新修复」，就认为「有 AI 路由 + 无 GPU 历史路由 ⇒ 版本在 2.0.1~2.0.15 之间」；
3. 又已知 CVE-2025-66507 在 v2.0.14 修复（GHSA 的 `first_patched_version: 2.0.14`），于是把结论收成「**2.0.1–2.0.13**」；
4. 这个结论是**错的**。目标实际是 **v1.10.28-LTS**。

## 误导来源（关键）
- **GHSA / NVD 的 `first_patched_version` 只覆盖它自己声明的那个分支**。CVE-2025-66507 的 advisory 里写 `ecosystem: go, name: github.com/1Panel-dev/1Panel, first_patched_version: 2.0.14`，看上去像「<2.0.14 就是受影响版本区间」，其实**同时还有 V1 LTS 分支**（官方公告 [1P-2025.12.08](https://1panel.cn/blog/security-advisory-1p-2025-12-08.html) 才写全：「1Panel V2 版本 <=v2.0.13；**1Panel V1 版本 <=v1.10.32 LTS**」）。**只读 GHSA 会漏掉整条 LTS 分支。**
- 官方 release notes 的「新增功能」是按 tag 列出的，**v1.10.x-LTS 与 v2.0.x 是并行维护的两条线**，同一个 tag 序列不代表同一条产品线；用 tag 时间线推版本会直接把产品线搞错。
- 未认证可得的那些路由（`/api/v1/*`）**两条线都有**，不能用来区分产品线。

## 正确判据（两条，任一即可定分支，合用可定到具体版本）
1. **`swagger` 的 `basePath` 直接暴露产品线**：
   - V1 线：`GET /1panel/swagger/doc.json` → `basePath = "/api/v1"`（路由也挂 `/api/v1`）；
   - V2 线：官方源码 `core/init/router/router.go` 里写死 `docs.SwaggerInfo.BasePath = "/api/v2"`，且核心接口是 `/api/v2/core/*`。
   - 实战取值：`curl -s http://TARGET:PORT/1panel/swagger/doc.json | python -c "import json,sys;print(json.load(sys.stdin)['basePath'])"`
   - 注意 V2 的 `/1panel/swagger/*any` 被 `middleware.SessionAuth()` 保护，V1 则挂在安全入口之后，**抓不到时不要下结论，改用判据 2**。
2. **官方各 tag 的 router 源码集合差集（离线、零目标负载、最可靠）**：
   - 把目标可得的路由集合（swagger 的 `paths`，或枚举结果）归一化（`{x}` → `:x`，去掉 `basePath`）；
   - 抓各 tag 的 `*/router/*.go` 全集（v1 在 `backend/router/`，v2 在 `agent/router/` + `core/router/`），按 `target32.example.com("前缀")` 递归拼出完整路径集合；
   - 对每个 tag 计算「目标有 / 该 tag 无」的数量：**该数量最小且只剩个位数（通常是协议/方法标注差异）的那一档，就是目标版本区间下界；再上一档陡增的那批路由，就是目标之后新增的功能。**
   - 本案例判定数据（目标 415 条路由）：
     - `v1.10.24-lts`：目标有/tag无 = 21（目标已有 `/ai/ollama/model` 系列 ⇒ 版本 ≥ 1.10.25）
     - `example.com`：目标有/tag无 = **11**，且 11 条全是协议差异（`/ai/ollama/model/close` vs 源码 `/ai/ollama/close`、`/ai/domain/get` 在源码里是 query 参数、`GET/POST /websites/proxy/file` 与 `/hosts/conffile/update` 方法标注不同等）
     - `v1.10.29/30/31/32-lts`：陡增到 **35**，多出的 24 条恰是 `/ai/mcp/*`、`/mcp/*`、`/1panel/swagger/*any`、`/files/keys`、`/files/ws`、`/process/ws`、`/terminals`、`/health` —— 目标 swagger 里**一条都没有** ⇒ 目标 < 1.10.29
     - `v2.0.0/1/4/…`：目标有/tag无 ≥ 46，且全部需要 `/api/v2` 前缀 ⇒ 排除 V2
   - ⇒ 结论 **example.com（区间 v1.10.25–v1.10.28 LTS）**，与官方公告「受影响 V1 <=v1.10.32 LTS」自洽。

## 顺带两个易错点
- **别用「某个未授权路由存在」当版本证据**：两条线的路由表高度重叠。
- **别把安全入口拦截页当 404**：本产品安全入口开启时，未携带入口口令的请求返回固定长度的 `200 + 拦截 HTML`（本案例 1410 字节，`<title>暂时无法访问</title>`）。路由「不存在」与「被安全入口拦住」表现不同（前者走 `NoRoute`／可能 502），做未授权枚举时必须先确立拦截页基线长度再做响应长度比对，否则会把整站误判为「全部未授权可达」。

## 复用
`redteam_poc_search --component 1Panel` 可命中脚本：
`cve-2025-66507-1panel-版本指纹-路由集合差集法-离线-把面板压到具体-lts-版本`