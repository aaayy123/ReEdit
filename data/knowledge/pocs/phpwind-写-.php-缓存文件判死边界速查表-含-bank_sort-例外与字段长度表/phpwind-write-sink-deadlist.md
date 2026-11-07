# PHPWind 7.3.2「写 .php 缓存文件」判死边界速查表（实测确认）

## 完整转义（凡用它的写点直接跳过）
- `pw_var_export`   require/target105.example.com:456
  = `"'".str_replace(array("\\","'"),array("\\\\","\'"),$input)."'"`
  → 单引号串完整转义。30/97 处写点靠它封死。
- `db_cv`           admin/target117.example.com:1114
  = `str_replace(array("\\","'"),array("\\\\","\'"),$value)`
  → 注意：它【只转义 \ 和 '】，不转义 $ { }。若外层是【双引号串】则仍危险（bank_sort 正是此型）。
- `key_cv`          admin/target117.example.com:1124 = `preg_replace('/[^\d\w\_]/is','',$key)` → 键名只留 \d\w_
- `Char_cv`         require/target105.example.com:646 → ' → &#39;  " → &quot;  < → &lt;
  → 但后台（P_W=='admincp'）的 CheckVar 不做任何替换

## 变量赋值链上常见的手工转义（要逐个回溯，别只看写点那一行）
- `admin/target117.example.com:60`  $fname = str_replace(array("\\","'",'<','>'),array("\\\\","\\'",'&lt;','&gt;'), strip_tags($forums['name']))
  → 保护 forumcache.php 的 $forumcache（行 152）与 $cmscache
- `admin/target117.example.com:340` 写入前对 $forumcache 再做一次 str_replace 转义
- `admin/target150.example.com:420` / `api/class_Other.php:172`  $class['name'] 的 ' " → &#39; &quot;

## 落点确定但内容不可执行
- `<?php die;?>` 前缀：admin_cache.php、dblog.php、ip_cache.php、set_cache.php、online.php/guest.php、
  medals_list.php —— include 时立即 die，其后内容永不解析（10 处）
- 数据源为整数：pw_forums.fid(smallint unsigned)、pw_medaluser.uid(mediumint unsigned)、
  在线计数、COUNT/SUM 统计（20 处）
- 整段在注释块内：admin/target117.example.com:840-851（updatecache_cy）、admin/target188.example.com:136-155（editcss 链）

## 缓存目录 include 落点密度（实测统计）
data/bbscache 310 处 · data/groupdb 16 处 · data/style 9 处 · data/forums 0 处
最热：forum_cache.php 74 · forumcache.php 24 · level.php 19 · ol_config.php 15 · o_config.php 12 · area_config.php 9

## 唯一真例外
hack/bank/example.com:362-373 savearray()
  `$arraydb .= '"'.addslashes($value2).'",';`
  → 双引号串 + 只 addslashes（不转义 $ { }）⇒ `${expr}` 求值 ⇒ RCE
  数据源 pw_members.username —— 【varchar(15)】，payload 只有 15 字节，这是本链真实瓶颈
  同请求 include：hack/bank/example.com:76

## 关键字段长度（lang/install_wind.sql，7.5SP3）
pw_members.username varchar(15) ← bank_sort 瓶颈
pw_forums.name 255 · pw_smiles.name 255 / descipt 100 / path 255
pw_styles.name 50 / tplpath 50 · pw_usergroups.grouptitle 60
pw_medalinfo.name 40 · pw_setform.name 30 · pw_customfield.title 50
pw_announce.subject 100 · pw_credits.name/unit 30 · pw_tools.name/filename 20
pw_forumdata.lastpost 135
pw_config.db_value / pw_hack.hk_value = text(65535) ← 长度最宽松
