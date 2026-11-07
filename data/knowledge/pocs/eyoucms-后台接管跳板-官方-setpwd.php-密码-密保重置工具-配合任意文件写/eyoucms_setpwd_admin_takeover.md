官方「后台登录异常小工具」功能清单（官方页面原文）：
  1、重置管理员密码   2、密保问题重置   3、解除登录锁定
  4、关闭登录双因子   5、解除后台防火墙 6、修复登录异常
  7、重置安全锁配置

官方下载（直链，update.eyoucms.com）：
  https://update.eyoucms.com/other/易优后台登录异常小工具_v2.0.8.zip
官方说明页：
  https://www.eyoucms.com/help/faq/10882.html

官方用法原文：
  「下载附件后解压，将 setpwd.php 文件上传到网站根目录，
    浏览器访问 http://你的网址/setpwd.php，按照操作执行就可以。
    修改完之后，请立即删除该文件，免得被其他人修改。」

组合利用链（把"任意文件写"变成"后台管理员"）：
  ① 前台任意文件写（api/Uploadify::preview，<=1.5.1）落 setpwd.php
     或 其他任意文件写 / 后台 Logo 上传
  ② 访问 /preview/<md5>.php  或  /setpwd.php
     → 重置 admin 密码 + 重置密保 + 关闭双因子 + 解除后台防火墙
  ③ 用新口令登录 /login.php?m=admin
  ④ 走后台模板写马（CVE-2026-7388 {:} 绕过）拿 RCE
     或走 edit_adminlogo 任意文件复制（CVE-2026-6561）读 application/database.php 拿库口令

注意：setpwd.php 体积大、base64 很长；若上传通道有敏感词过滤，
      先把源码里的敏感词变形（双写/改名）再投递。

另一条相关事实：EyouCMS 后台登录有验证码（ey_fleshVerify），
盲喷洒必须先处理验证码（OCR / 同 session 复用 / 找无需验证码的 ajax 登录点）。
