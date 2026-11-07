# 同类目标「坑位卡」—— 打这类多租户 SaaS 后台时，这些方向实测已证否，别再投预算

来源：example.com（6T体育，dysaas 代理 SaaS）代理后台线，2026-10-08 实测。全部有原始回显。

## 1. 上传：能写，但不解析 —— 别指望 getshell
- 现象：`POST /agent/agent/api/v1/file/upload`（multipart，字段 `file`，已认证）返回
  `{"code":0,"data":{"bucketName":"<bucket>","fileName":"<uuid>","keyName":"mujun-certificate/<uuid>","url":"/mujun-certificate/<uuid>"}}`
  —— **落地 url 里没有扩展名**，服务端把原始后缀整个丢掉。
- 白名单只取「最后一个 `.` 之后」的部分：`rt.png` / `rt.php.jpg` / `rt.jsp;.jpg` 全部通过；
  `rt.jsp` / `rt.jspx` / `rt.PHP` / `rt.png.gif.php` / `rt.svg` / `rt.html` / `rt.txt` → `{"code":1,"msg":"不允许的文件格式：<ext>"}`
- 结论：**后缀绕过没有意义**（落地名由服务端生成且无扩展名），后端是对象存储（S3 兼容），不解析脚本 → **此路无 shell**。
- 同类「主站网关那个上传点不需要认证」（`/xxa/longm/api/v1/file/upload`）值得单独测，但同样只落对象存储。

## 2. `detail/<id>` 类接口通常**有归属校验** —— 别先当成 IDOR
- 现象：`GET .../agentPlate/detail/<其它 user_id>` 一律
  `{"code":13006,"msg":"获取用户信息失败,请确认是否登录"}`，只有**自己**的 id 返回档案。
- 对照：`GET .../agent/api/banks/findListByAgentId?agentId=<任意>` → `{"code":0,"data":[]}`
  **没有归属校验但也没数据**（空值）→ 判 IDOR 必须拿到"非空且属于别人"的数据，空数组不算。

## 3. 认证头与「单会话」——最容易误判的两件事
- **必须带 `Bearer ` 前缀**：裸 token → `{"code":16003,"msg":"账号已在其它设备登录，请重新登录"}`；
  带前缀 → `code 0`；完全不带 → `401 Full authentication is required`。
  ⚠️ `16003` **不等于 token 失效**，先检查是不是漏了前缀。
- **单账号单会话**：任何一次新登录**立刻顶掉旧 token**（旧 token 从 code 0 变 16003）。
  多人协作/长跑脚本必须用**自动重登**，且不要并发共用同一账号。

## 4. 登录：先确认「验证码是否真的被校验」再决定能不能喷洒
- 本目标：**请求体不带 `validateType` → 完全不校验验证码**，直接返回凭据结果（`13091`）；
  显式带 `validateType:0` → `7202 验证码错误`；带 `validateType:3`（站点配置=极验4.0）→ `1012`。
- 也就是说：站点的图形码/极验只在**显式声明**时才生效 → **漏校验是常态，值得先试一次**。
- 口令必须按**前端算法**构造密文（本目标 AES-CBC/Pkcs7, key=iv=`pigxpigxpigxpigx`, base64）；
  送短明文/非 base64 → 服务端解密抛异常，返回 **HTTP 500 + `{"code":1012,"msg":"网络异常"}`**
  → 这个 500 其实是"格式对了"的探针：**能拿到 13091 说明密文算法是对的**。

## 5. 错误码语义（先把它们摸清，比字典更值钱）
- `13091 用户名或密码错误` —— **不区分**账号不存在与口令错误
- `11211 当前账号已被禁用` —— 账号**存在且禁用**（禁用检查先于口令校验）→ 这是"存在性 oracle"
- `7001 用户名格式有误,请输入4-15位数字和小写字母组合` —— **顺带泄露命名规则**
- `7001 名称不能为空` / `7202 邮箱不能为空` / `7202 qq不能为空` / `7202 姓名不能为空` —— **必填字段逐个暴露**（可用于反推注册表单；`7202` 在不同租户下含义不同）
- `1012 网络异常` —— 通用兜底（多为参数/解密/内部异常）
- 多租户系统：**请求头 `clientCode` 可切租户**，同一路径在不同租户下必填字段/返回码不同（实测 `amjs` 租户要求 email+qq+realName，而 `ffty` 只要 name/password/phone）。

## 6. 其它已证否方向（本目标）
- 会员侧图形验证码 OCR：ddddocr 识别 5 位、8 种绕过形态（空/0000/只 key/key 复用/随机）全 `7202`
  → 验证码疑似与 session/指纹绑定，**没 cookie 永远校验失败**，别投入 OCR。
- `firstRegister` 不是注册接口，是**极验初始化**（`{"success":1,"gt":...,"challenge":...,"newCaptcha":true}`），同族 `getDefaultStatus`。
- 申请类接口（`appSave`）恒落"待审核"，**注入 status/auditStatus/enable/isAgent/agentLevel/roleId/parentId… 共 23 个字段全部无效**，注册出来的账号登录永远 `13091`。
- 同族 vhost 探活前先测：多租户的兄弟域可能**上游挂了**（实测 `tbhagent/target295.example.com` API 路径一律 `502 Bad Gateway`）——别在 502 域名上花预算。
