# 群晖 DSM 错误码判读经验 —— code 120 会伪装成"未授权可访问"，必须补全参数再判定

## 事故场景（差点误报）
```
GET /webapi/entry.cgi?api=SYNO.FotoTeam.Browse.Item&version=1&method=list
→ {"error":{"code":120,"errors":{"name":"offset","reason":"required"}},"success":false}
```
看到 `120`（缺参数）而**不是** `103`（需认证），容易误判为"该 API 未授权可访问"。

## 实际是三层校验，顺序为：参数 → 认证 → 权限
```
第一次请求（无参）        → code 120  {"name":"offset","reason":"required"}
补 offset=0              → code 120  {"name":"limit","reason":"required"}
补 offset=0&limit=100    → code 801  ← 权限不足（真实结论）
```
→ **群晖的【参数格式校验先于权限校验】**。因此只要参数不全，任何 API 都会返回 120，
   看起来像"未授权"，补齐参数后才暴露真实的 801/103。

## 判读规则（务必遵守）
| 错误码 | 含义 | 是否代表"未授权可访问" |
|---|---|---|
| **120** | 缺少必填参数（`target447.example.com` 指明缺哪个） | **否** — 必须补全参数再测 |
| **119** | API 不存在 或 method/version 不匹配 | 否 |
| **102** | 参数错误 / 方法不支持 | 否 |
| **103** | 需要认证 | 否（需凭据） |
| **400** | 登录时：账号不存在 | — |
| **801** | 权限不足（参数齐了但没权限） | 否 |
| **200 + 真实 data** | 真未授权 | **是** |

## 正确姿势
```bash
# 1) 第一次返回 120 时，看 target447.example.com 指的缺哪个参数，循环补齐
curl -s "$B/webapi/entry.cgi?api=$API&version=1&method=$M"            # 缺 offset
curl -s "$B/webapi/entry.cgi?api=$API&version=1&method=$M&offset=0"   # 缺 limit
curl -s "$B/webapi/entry.cgi?api=$API&version=1&method=$M&offset=0&limit=100"  # 801 = 结论
# 2) 只有返回 200 且 data 非空，才算真未授权
```

## 本次实测对照
- `SYNO.FotoTeam.Browse.Item` → 120 → 120 → **801**（需认证，非未授权）
- `SYNO.Foto.Setting.Guest`    → **200 + 真实 data**（真未授权，但仅泄露访客配置，低价值）
- `SYNO.FileStation.*` v1/v2 全系列 → **119**（API 路径/版本不匹配）
- `SYNO.Foto.Browse.*` 系列    → **119**
- `SYNO.Foto.Search.Search` / `Sharing.Passphrase` / `Download` → **103**（需认证）

## 同源经验（通用）
这个"参数校验先于权限"的模式在很多系统中都存在（Spring Security 过滤器链、
Django REST Framework 的 serializer 校验等）。**看到"缺参数"类错误时，
不能判定为未授权 —— 必须补全参数，否则会把大量需要认证的接口误报成未授权漏洞。**
