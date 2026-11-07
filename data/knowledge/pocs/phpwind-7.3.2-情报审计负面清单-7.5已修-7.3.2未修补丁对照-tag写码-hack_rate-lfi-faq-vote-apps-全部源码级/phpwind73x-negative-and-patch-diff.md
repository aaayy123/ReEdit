【本轮新排除的 5 个方向（源码级证否，均有行号）】

1) pw_example.com?action=tag → data/bbscache/tagdb.php 写码 —— 不可利用
   pw_example.com L135-152：
     $query = $db->query("SELECT * FROM pw_tags WHERE ifhot='0' ORDER BY num DESC".pwLimit($tagnum));
     while ($rs = $db->fetch_array($query)) { $tagdb[$rs['tagname']] = $rs['num']; }
     writeover(D_P."data/bbscache/tagdb.php","<?php\r\n\$tagdb=".pw_var_export($tagdb).";\r\n?>");
   写码+include 模式确实存在（read.php L793 / lib/post.class.php L640 / require/postfunc.php L400 都 include 它），
   但 require/common.php L417-439 pw_var_export 的 string 分支为：
     return "'".str_replace(array("\\","'"),array("\\\\","\'"),$input)."'";
   **先转义反斜杠再转义引号，顺序正确** => 数组 key 无法逃逸。
   GBK 宽字节也无效：str_replace 是字节级，%df%27 变成 \xdf\x5c\x27，PHP 单引号串里 \x5c\x27 仍是转义引号。

2) hack/rate/example.com 与 hack/rate/template/layout.php 的 require_once $filepath —— 不可利用
   hack/rate/example.com L5-14：
     $action = strtolower ( ($job) ? $job : "admin" );
     $filepath = H_R . "action/" . $action . "Action.php";
     (! file_exists ( $filepath )) && exit ();
     if ($job != "ajax") { require H_R . '/template/layout.php'; } else { require_once $filepath; }
     （layout.php L6 同样 require_once $filepath）
   受限：file_exists 校验 + 强制 "Action.php" 后缀 => 只能指向 hack/rate/action/ 下的
   adminAction.php / ajaxAction.php 两个固定文件，无法指向任意文件；PHP 5.5 无 %00 截断。

3) faq.php 的 $sqlwhere / $orderby / $method 拼接 —— 安全
   faq.php L70   $orderby = 'ORDER BY hid DESC';            // 硬编码
   faq.php L77   $method != 'AND' && $method = 'OR';         // 白名单
   faq.php L90-101 $keyword 先 addslashes，$like = pwEscape("%$value%");   // 已转义
   faq.php L110  $limit = pwLimit($db_maxresult);
   faq.php L138  $sqlwhere .= " IN ('".str_replace(',',"','",$schedid)."')"; // $schedid 来自库内 hid 拼接，不可控

4) example.com?action=vote 的 $sqlw —— 安全
   example.com L760-766：
     $sql_1 = ''; if ($groupid=='guest'){ ... $sql_1 = ' AND username=' . pwEscape($windid); }
     $sqlw = 'tid=' . pwEscape($tid) . ' AND uid=' . pwEscape($winduid) . $sql_1;
   全部 pwEscape；unserialize($voteopts) 的 $voteopts 来自数据库 extract，不可控。

5) apps.php 的 q 路由与 apps.php 的 id/pw_query —— 白名单锁死 / 仅低价值 XSS
   apps.php L5   if (in_array($q, array('ajax','article','diary','galbum','group','groups','hot','photos','sharelink','share','stopic','write')))
                   { require_once R_P.'require/app_route.php'; }
   非白名单值根本不进 app_route.php；且 app_route.php 的 app_router() L78-85 另有
   is_dir(A_P.$app) + file_exists($baseFile) 双校验，$baseFile 恒为 $basePath.'/example.com'。
   apps.php L15/L20 的 $_GET['pw_query']（base64_decode+urldecode）与 $_GET['id'] 未 InitGP，
   但只进 $param 数组交给模板渲染，且需 $db_appifopen 开启 + 登录态 => 仅反射型 XSS 候选，价值低。

【pw_example.com 全部 62 个 action 的危险模式扫描结果（供后续复扫）】
  命中 SQL 未过滤拼接的仅 4 处，其中 3 处经复核为安全或不可达：
    L508  newrp      -> $replyinfo 来自 pw_memberinfo.replyinfo 经 pwImplode(pwEscape)，不可控
    L743  readlog    -> foreach 里有 is_numeric($value) 硬校验，只有数字进 $tids
    L1819 pcsendmsg  -> InitGP + pwEscape($tid)，已转义
    L1927 pcdelimg   -> **唯一真洞**（见另一条 POC）
  writeover 命中的 tag(L135) / showsmile(L680) 见上文第 1 条与全站缓存写入面。

【7.5 / 8.x 已修、7.3.2 未修专项清单（最有价值的一类）】
  项                                  | 7.5 SP3      | 7.5 早期(maddogfyg) | 8.7 系        | 7.3.2
  pw_example.com pcdelimg 的 pw_pcfield 白名单 | 已修(多一行) | **未修(=wooyun 原文)** | 实现已移走/删除 | 大概率未修，待实测
  api/class_Other.php threadscateGory 的 intval/(int) | 已修 intval | 无此文件 | 已修 (int) | 未知，且需文件存在
  修复点均位于 7.5 正式版 → 7.5 SP3 之间，而 7.3.2 早于两者。