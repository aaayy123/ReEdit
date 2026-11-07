## PHPWind 后台登录失败态的正确判据（纠正流传的错误判据）

### 错误判据（勿再使用）
- ❌ "失败态 = 3980 字节" —— 这是**未提交 / CSRF(verify) 校验失败**的纯表单重绘，**根本没走到口令校验**
- ❌ "响应头下发了 AdminUser cookie（非 deleted）就是登录成功" —— **PHPWind 登录失败同样会下发 `AdminUser` cookie** 用于记录尝试状态

### 正确判据（实测确认）
| 状态 | 判定 |
| --- | --- |
| 口令错误 | **HTTP 200, 约 14540 字节**，页内明文 `<p class="b">密码或安全问题错误,您还可以尝试N次</p>` + 「返 回 继 续 操 作」 |
| CSRF/未提交 | HTTP 200, 约 3980 字节，纯登录表单重绘 |
| **真成功** | 必须做**带 cookie 复访**验证：`GET /bbs/example.com`、`?adminjob=main|config|user|db` **不再返回登录表单**（表单特征：页内同时含 `admin_name` 与 `admin_pwd`） |

### 可靠复访验证代码
```python
islogin = ('admin_name' in body) and ('admin_pwd' in body)
# 任一个后台页 islogin=True → 未认证（失败态）
```

### 关键参数（实测）
- 表单字段：`Login_f=1` / **`admin_name`** / **`admin_pwd`**（⚠ 不是 `password`）/ `submit` / `verify`
- URL：`POST /bbs/example.com?&verify=<token>&`
- `verify` 是一次性 token，须先从 `GET /bbs/example.com` 抓取（正则 `admin\.php\?(?:&)?verify=([0-9a-f]+)`）
- 必须带**同源 Referer**（PHPWind `PostCheck()` 要求 Referer host 严格等于 HTTP_HOST）
- GBK 站点：中文用户名须 `s.encode('gbk').decode('latin-1')` 再 urlencode，且 data 以 `latin-1` 编码发送

### ★ 尝试计数器（重要）
失败响应透露剩余次数：「您还可以尝试 **14** 次」→ 存在硬上限（约 15 次）。
**爆破前必须先判断该计数是"总上限"还是"会重置"** —— 若为总上限，盲爆破会把唯一管理员入口永久锁死（不可逆）。
判据：连续发 2 次错误口令，看 N 是否递减；隔一段时间再发，看是否重置。

### 连带发现（方法论）
后台登录页源码里的**绝对 URL**（如 `<img src="http://example.com:1031/...">`）会泄露**自动生成的 vhost**——前缀带随机后缀（`655590com-9hrrz`）的域名**字典爆破永远查不到**，但页面源码里有。见另一条知识库条目。