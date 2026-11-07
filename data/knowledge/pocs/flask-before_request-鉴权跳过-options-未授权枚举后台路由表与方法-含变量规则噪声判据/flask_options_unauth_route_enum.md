## 缺陷
很多 Flask/Quart 应用把鉴权写成 `@app.before_request` 钩子（`if request.path.startswith('/api/') and not logged_in: abort(401)`）。
**Werkzeug 的自动 OPTIONS 处理发生在 before_request 之后、且不会触发业务视图**，于是：
- `GET/POST/PUT/DELETE/PATCH /api/x` → **401**（钩子拦截）
- **`OPTIONS /api/x` → 200 且带 `Allow: HEAD, OPTIONS, GET`** ⇒ 钩子形同虚设，**方法清单直接白送**

## 用它能做什么：未授权路由表枚举
`Allow` 头由 Werkzeug 的 URL map 生成，因此：
- **200 + `Allow`** = 该路由**存在**，且 Allow 里就是真实允许的方法
- **404 + `text/html`（Flask 的 404 页）** = 该路由**不存在**
- 路由存在但只有 POST → `Allow: POST, OPTIONS`（能直接捞出 POST-only 的隐藏接口，如登录/同步/上传）

据此可以在**没有任何凭证**的情况下枚举出完整后台 API 面（含只开放 POST 的接口），比 ffuf 硬扫更准（不会把 401 误判成"存在"、也不会漏掉没有 GET 的接口）。

## 案例（实测，2026-09-30，codex-tgt4796-com / 203.0.113.53:5050）
`GET/POST/PUT/DELETE/PATCH /api/config` → 全部 `401 {"error":"unauthorized","message":"需要登录管理后台"}`；
`OPTIONS /api/config` → `200`，`Allow: HEAD, OPTIONS, GET`。
枚举结果（未授权）：`/api/accounts`、`/api/characters`、`/api/codes`、`/api/config`、`/api/dashboard`、`/api/db`、`/api/health`、`/api/logs`、`/api/r2`、`/api/tasks`、`/api/version`（GET/HEAD）、**`/api/admin/login`（POST-only）**、**`/api/r2/sync`（POST-only）**、`/api/characters/search`（POST）、`/api/redeem/lookup`（GET）。
——其中 `/api/characters/search`（POST）与 `/api/redeem/lookup`（GET）是白名单，未授权可读数据。

## ⚠️ 必须剔除的噪声：变量规则（catch-all）
若存在 `/api/config/<x>` 这类**变量规则**，则 **`/api/config/任意后缀` 都会命中**（OPTIONS 全 200），会被误读成"发现了 30 个接口"。
判据：同一父路径下**所有**后缀都返回 200 且 `Allow` 完全相同 ⇒ 是变量规则，只记 1 条。
反向交叉验证：把同一份后缀列表套到**另一个已知不存在的父路径**上，若也全命中，则更可疑（可能是全局 catch-all 或 404 处理器被改写）。
**更稳的做法**：对命中的路由再用 GET/POST 打一次看是否 401/405/200 —— 只有"OPTIONS 200 + 真实方法"才是路由存在的硬证据。

## 附带收益
- 命中的路径直接给出**前端页面结构与后端模块的对应关系**（本次由控制台页面 `/admin/{accounts,logs,news,proxies,redeem,register,settings,workflow}` 反推出后端 `/api/<module>`）。
- 拿到 `Allow` 后，针对 POST-only 接口单独测参数/认证绕过，比盲目扫路径高效得多。

## 复现脚本
`bd2_route_enum.py`（父路径 × 词表，输出 200+Allow 清单）
`bd2_route_enum2.py`（多级路径 + 对命中路由自动试 GET/POST 找白名单）
`bd2_whitelist_hunt.py`（模块 × 子路径全量交叉，筛出真正 200 的白名单接口）