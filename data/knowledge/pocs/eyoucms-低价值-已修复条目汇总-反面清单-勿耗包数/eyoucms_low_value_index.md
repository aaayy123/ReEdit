== EyouCMS 低价值条目汇总（非 getshell 面，仅备查，不要为此消耗演练包数）==

【已修复 / 别浪费额度】
  api/Uploadify::preview 前台文件写 ......... 官方已整体废弃接口（构造函数 exit;），>=1.5.2 无效
  CVE-2025-15375 反序列化 ................... v1.7.8 已修
  CVE-2025-15373 / CVE-2025-15374 .......... v1.7.8 已修
  CVE-2024-22927 XSS ....................... 1.6.6 已修
  {eyou:php} / {php} / {:名单内函数(} ....... 官方 editFile 已内置黑名单
  "默认后台口令 admin/admin123" ............ 不存在。官方原文："没有默认密码，忘记了只有重置"
                                            → 不要空转口令字典（易优后台还有验证码）

【开放重定向 / XSS / CSRF / 信息泄露（每个一行带过）】
  CVE-2021-39501  open redirect  1.5.4    GET /example.com?m=user&c=Users&a=logout&referurl=https://evil
  CVE-2023-37645  info leak      1.6.3    GET /data/model/custom_model_path/recruit.filelist.txt
  CVE-2023-41597  XSS            1.6.2    GET /admin/twitter.php?active_t="><script>...
  CVE-2024-22927  XSS            1.6.5    POST /login.php?a=get_upload_list&c=Uploadimgnew&...&func=head_pic_callback
  CVE-2025-52335  XSS            1.7.3    example.com
  CVE-2020-21929 / 21930 XSS     1.4.1    web_copyright / web_attr_2 字段
  CVE-2020-28146  XSS            <=1.4.7  addonfieldext 参数
  CVE-2022-45539~45542 XSS       1.6.0    FileManager(activepath/filename)、文章类型编辑器(name/value)
  CVE-2022-45755  XSS            1.6.0    基本信息页 首页描述
  CVE-2023-1798 / 1799 XSS       <=1.5.4  login.php typename / tag_tag
  CVE-2023-2057 / 2058 XSS       1.5.4 / <=1.6.2  Arctype::edit 的 litpic_loca / web_ico
  CVE-2024-52680  XSS            1.6.7    /login.php?m=admin&c=System&a=web&lang=cn
  CVE-2025-15374  XSS            <=1.7.7  application/home/model/Ask.php content
  CVE-2019-17430  XSS            <=1.3.5  login.php web_recordnum
  CVE-2020-18129  CSRF           1.2.7    经 login.php 加管理员
  CVE-2020-19669  CSRF           1.3.6    /login.php?m=admin&c=Admin&a=admin_add&lang=cn
  CVE-2020-20642  CSRF           1.3.6    /login.php?m=admin&c=Filemanager&a=newfile&lang=cn（可加 htm 页执行 js）
  CVE-2020-20645  XSS            1.3.6    basic_information 区
  CVE-2021-39496  XSS            1.5.4    filename 参数
  CVE-2021-39497  盲 SSRF        1.5.4    saveRemote()   CVSS 9.8（仍非直接 RCE）
  CVE-2025-15373  SSRF           <=1.7.7  application/function.php saveRemote
  CVE-2025-65868  XXE            1.7.1    POST body XML，CVSS 7.5，DoS 级
  CVE-2026-13569  SQLi            1.7.0/1.7.1  /example.com 参数 click_like  ← 这条已单独落库（属前台注入面）
  CVE-2024-11210  路径穿越       1.5.1    FilemanagerLogic::editFile activepath  ← 已并入模板写马条目

【规模参考】
  NVD 关键词 eyoucms：79 条
  CIRCL/GCVE 索引：150 条
  WatchStack 索引：89 CVE，其中标注 RCE 类 7 条
  → 绝大多数是 XSS/CSRF/信息泄露，只有本批次落库的那几条属 getshell 面。
