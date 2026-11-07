■ 触发链（POST 到 post.php / example.com 全被拒）
请求特征：用 IP 直连 + `Host: <域名>`，Referer 写成 IP（`https://<IP>/post.php?fid=2&action=new`）
结果：响应 200 / 2320B，正文 `非法操作,请返回`（前台）或 `非法操作，请返回重试!`（后台）

■ 源码根因（PHPWind 7.3.2，本机源码 C:\Users\user\Desktop\tgt9943\runs\pw-admin-sinks\utf8\）
global.php L775-789：
```php
function PostCheck($verify = 1,$gdcheck = 0,$qcheck = 0,$refer = 1) {
	global $pwServer;
	$verify && checkVerify();
	if ($refer && $pwServer['REQUEST_METHOD'] == 'POST') {
		$referer_a = @parse_url($pwServer['HTTP_REFERER']);
		if ($referer_a['host']) {
			list($http_host) = explode(':',$pwServer['HTTP_HOST']);
			if ($referer_a['host'] != $http_host) {
				Showmsg('undefined_action');      // ← 就是这里
			}
		}
	}
	$gdcheck && GdConfirm($_POST['gdcode']);
	$qcheck && Qcheck($_POST['qanswer'],$_POST['qkey']);
}
function checkVerify($hash = 'verifyhash') {
	GetGP('verify') <> $GLOBALS[$hash] && Showmsg('illegal_request');
}
```
`undefined_action` 在 lang_msg.php 里就是 `非法操作,请返回`；后台 cp_lang_cpmsg.php 里是 `非法操作，请返回重试!`。
⇒ **Referer 的 host 必须严格等于 HTTP_HOST**。用 IP 做 Referer 而 Host 头是域名，POST 一律被判非法。

■ 排查时被排除的其它假设（全部实测/源码证否，别重复走）
1) verify 值错 —— 否。发帖页 `name="verify"` 与页面 `verifyhash` 同值（实测同为 83adae12），`checkVerify()` 比较的就是这两个。
2) `_hexie` 字段缺失 —— 否。post.php L212 的 `_hexie` 校验在 7.3.2 里已被 `/* */` 整段注释掉。
3) `fid` 没传到 —— 否。假 fid（99999）会得到 `读取数据错误,原因：您要访问的链接无效`，证明 fid 链路正常；`global.php` L92 `InitGP(array('fid','tid'),'GP',2)` 先 GET 后 POST 都能读。
4) `action` 参数问题 —— 否。action 为空时 post.php L24 会 `$action = "new"` 兜底，不会报 undefined_action。
5) CC 防护 / 请求间隔 —— 否。10 秒间隔与零间隔表现一致。
6) 时段限制 —— 否。那是另一个消息：`lib/post.class.php` L58-59 报的是 `forum_allowtime`（该版块在该时间段不允许发表帖子）。

■ 正确请求写法（curl 原文）
```bash
B=https://TARGET_HOST            # 用域名，不要用 IP
H="Host: TARGET_HOST"
# 1) 登录页取 verifyhash
curl -sk --noproxy '*' -H "$H" -c jar.txt "$B/login.php" -o login.html
VH=$(grep -oE "verifyhash *= *'[a-f0-9]+'" login.html | grep -oE '[a-f0-9]{8}')
# 2) 登录
curl -sk --noproxy '*' -H "$H" -b jar.txt -c jar.txt -e "$B/login.php" \
  --data "forward=&jumpurl=&step=2&lgt=0&pwuser=USER&pwpwd=PASS&hideid=0&cktime=31536000&verify=$VH&submit=%B5%C7%C2%BC" \
  "$B/login.php?" -o lo.html
# 3) 取发帖页（同时拿到页面 verify）
curl -sk --noproxy '*' -H "$H" -b jar.txt -c jar.txt -e "$B/thread.php?fid=2" "$B/post.php?fid=2&action=new" -o post.html
V=$(grep -oE 'name="verify" *value="[a-f0-9]+"' post.html | grep -oE '[a-f0-9]{8}')
# 4) 提交：URL 与 Referer 都用【同域名】，Referer 用发帖页自身
curl -sk --noproxy '*' -H "$H" -b jar.txt -c jar.txt -e "$B/post.php?fid=2&action=new" \
  -F "verify=$V" -F step=2 -F fid=2 -F action=new -F tid= \
  -F "atc_title=t" -F "atc_content=tt" -F attachment_=@probe.txt \
  "$B/post.php?fid=2&action=new" -o resp.html
```
注意：**Windows 上必须加 `--noproxy '*'`**，否则 curl 会静默走环境变量 `ALL_PROXY/http_proxy`（本机实测 `127.0.0.1:17992` 是活的但出口在台湾，会把请求改道）。
