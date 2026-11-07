## 一、前台登录（未授权可达，无验证码，可精确控额度）

接口：POST /login.php
```
step=2&ajax=1&ajaxstep=0&pwuser=<用户>&pwpwd=<口令>&lgt=0&hideid=0&cktime=0&jumpurl=
```
**必须带 step=2**（漏掉会直接返回登录页 HTML，29815B，看起来像"被拦"其实是没进处理分支）。
响应（Content-Type: text/xml，CDATA）四种，构成完备判据：

| 响应 | 含义 |
|---|---|
| `<![CDATA[success	example.com]]>` | **登录成功** |
| `<![CDATA[error 用户"X"不存在]]>` | 用户名不存在 → **用户名 oracle** |
| `<![CDATA[error 用户名或密码错误,您还可以尝试 N 次]]>` | 口令错，**N 就是该账号剩余额度** |
| `login_forbid` | 该账号已被锁 |

**★ 额度机制（实测）**：失败计数写在用户表 `pw_memberdata.onlineip` 字段，格式 `"$onlineip *|$timestamp|$L_T"`，初值 6，每次失败 -1，<1 则锁 600 秒（源码 require/target104.example.com:100-116）。
**⇒ 每账号 6 次 / 600 秒，且服务端直接回显剩余次数 ⇒ 可以零风险地把每个账号的额度打满，而不必担心盲目触发锁定。**
**⇒ 横向放大：N 个已知用户名 = N × 6 次尝试额度**（额度按账号计，不按来源 IP）。
实测：49 个真实用户名 × 4 次 = 260 次未命中（口令空间为「用户名本身/用户名+123/123456/888888」）。

## 二、后台登录（/example.com，无图形验证码，但额度极窄）

- 表单仅 4 字段：`Login_f=1`、`verify`(formhash)、`admin_name`、`admin_pwd`；**页面不引用任何验证码**；登录分支（admin/example.com:122-166）**不校验 verify**，可裸 POST。
- **★ 锁定额度 = 15 次 / 1200 秒**，源码 admin/example.com:100-112：
  `$F_count = F_L_count(D_P.'data/bbscache/admin_record.php', 2000); if ($F_count>15 && 1200-(time-mtime)>0) adminmsg('login_fail');`
  ⇒ 数的是**全局记录文件**最后 2000 字节内的行数，**与来源 IP 无关**。
- **★ XFF 不能绕过**（实测强证据）：轮换 `X-Forwarded-For: 198.51.100.21~37` 连打 17 次，第 16 次响应长度由 5897 突变为 5941 → 正好卡在 `$F_count>15`。原因是 `pwGetIp()`（require/target105.example.com:59-73）仅在 `$db_xforwardip` 开关为 1 时才采纳 XFF，本站该开关为 0。
  ⇒ **WOOYUN-2014-080327 的「改 XFF 无限爆破后台」手法在本站不成立，不要照搬。**
  ⇒ 后台口令攻击上限 = 45 次/小时，只适合极小的高概率字典。

## 三、未授权接口清单（实测可达）

- `POST /register.php  action=regcheck&type=<类型>&...` —— 注册关闭后**接口仍开放**，可未认证调用。
  `checkUsername()` 返回值语义（lib/user/target106.example.com:15-45）：
  **0=可用 / 1=长度不合规 / 2=含敏感字符或命中后台禁用词 rg_banname / 3=不符合注册规则 / 4=uc_user_get() 有返回⇒用户名已存在**
  ⇒ **返回 4 才是"已存在"**，别把 2 误读成存在（`admin` 常返回 2 是因为它在禁用词表里）。
- `pw_example.com?action=getverify&type=register` → 回显 `verifyhash \t verify`。
- 各实例的 `register.php` 页内 JS 含 `_hexie`（formhash，如 `bf2c955b`）与 `verifyhash`；`if(parseInt("0")&1)` 为真即**注册需图形验证码**，为假则不需要。
- `/pw_api.php` 未授权可达，签名 = `md5(ksort后"k=v&"串 . apikey)`，apikey 取 `db_siteownerid` 或 `uc_key`；apikey 为空时 fail-safe 返回 `Error Sign`（可作"该站是否配了 API 密钥"的探针，但不能绕过）。

## 四、头像上传写文件（历史 PoC）的现实状态判据

`POST /example.com?action=uploadicon&step=2&filename=x.<ext>`（body 为原始文件内容）：
- `filename=x.php` → 「非法操作,请返回」 ⇒ **扩展名白名单补丁已打**（源码里那行白名单已生效）
- `filename=x.png` → 「附件内容非法,系统系统已经将其自动删除！」 ⇒ 白名单过了但**新增了文件内容校验**
⇒ 两个判据可一次性区分"补丁已打/未打"，别再盲试大小写、双写、php3-7（黑名单正则带 /i 且为替换式，见知识库另一条审计结论）。
⇒ 附件真实基目录由 `$attachdir` 决定（`PwUpload::savePath` in lib/target52.example.com:273），**未必是 `upload/`**；探测 `/upload/` 404 不代表上传不了，要按 `/attachment/`（phpwind 默认）去找。

## 五、目录级防护（nginx deny）实测

返回 **9 字节 `Forbidden`**（200 状态）即为目录被 deny，出现位置：`/actions/*`、`/admin/`、`/api/*.php`、`/mode/*/`、`/apps/*/`、`/hack/*/`、`/simple/mod_read.php`。
⇒ 因此直接访问 `actions/ajax/xxx.php` 型 PoC（如知识库那条 leaveword SQLi）在本站**结构上不可达**，必须改走 `pw_example.com?action=` 路由。
而 `pw_example.com` 未登录时只放行固定 21 个 action（源码 pw_example.com:9-34 白名单），`leaveword`/`favor` 等**不在**其中 → 未登录调用返回 `not_login`（101B）。