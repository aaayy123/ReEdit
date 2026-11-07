# boyue = webman + Pear Admin 彩票/博彩管理系统（公开仓库 axq-devops/boyue）

## 一、如何确认一个站是不是 boyue（指纹）
1. 后台路径固定为 `/app/admin/...`，登录页 `/` 或 `/admin` 返回 Pear Admin Layui 登录页，标题常为「XX后台」，资源 `/app/admin/component/pear/css/pear.css`、`/app/admin/component/layui/layui.js?v=2.8.12`。
2. 登录页 JS 里 `$.ajax({url:'/app/admin/account/login',type:"POST"})`，验证码 `/app/admin/account/captcha/login`（返回 GD 生成的 4 位 JPEG，字符集 `abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ`，明文小写存 session `captcha-login`）。
3. 任意不存在的 `/api/*` 路径返回署名 **webman** 的 404 页（`<div class="center">webman</div>`）。
4. 会员端（H5）为 Vue3+Vite，title `frontend-new-h5`，接口前缀 `/api/v1`；响应可带 `X-Encrypted: 1`（base64 密文）。
5. 客服系统为 Go 语言 **GoFly（go-fly）**：`/login`、`/main`、`/check`、`/captcha`、cookie `GOFLY`，`/configs`、`/messages` 返回 `{"code":400,"msg":"token失效"}`，访客端 `/livechat`、`/kefu/livechat` 内含 `/visitor_login`、`/uploadimg`、`/uploadfile`、`/ws_visitor`。

## 二、会员端加解密密钥（同一套 key 全站复用）
源码 `app/Utils/Crypto.php` 硬编码：
```
key = 'QD2024SecretKey1234567890ABCDEF0'   // AES-256-CBC
iv  = 'QD2024IV12345678'
```
代理后台前端 `https://<代理后台域名>/` 的内联 JS 里同样明文写着 `API_CRYPTO_KEY` / `API_CRYPTO_IV`（静态文件无需登录即可读）。
Python 解密：`AES.new(key, AES.MODE_CBC, iv).decrypt(base64.b64decode(body))` 去掉 PKCS7 填充再 json.loads。

## 三、免登录路由（源码级）
- 会员端 `app/middleware/AuthMiddleware.php::$except`（注意用的是 `str_starts_with` 前缀匹配）：/api/v1/index、/lottery-hall、/banners、/notices、/notice/、/config、/auth/login、/auth/refresh、/register、/check-username、/validate-reccode、/game/platforms、/game/list、/game/hot、/game/categories、/entertainment/platforms、/rebate/tier-rates。
- 后台 `InstallController::$noNeedLogin = ['step1','step2']`；`AccountController::$noNeedLogin = ['login','logout','refreshToken']`。
- 后台 `UploadController::$noNeedLogin` 未列出 → /app/admin/upload/{image,file,avatar} 需登录。

## 四、后台上传实现（UploadController::base / avatar）
禁止扩展名仅：`php, php3, php5, css, js, html, htm, asp, jsp`。
→ `phtml / phar / php7 / php4 / shtml / .user.ini / .htaccess / svg / xml` **都能落盘**，路径为
`/app/admin/upload/files/YYYYMMDD/<hex>.<ext>`（image 走 `/app/admin/upload/img/`，avatar 走 `/app/admin/upload/avatar/YYYYMM/`）。
注意：能否转 RCE 取决于目标 nginx 是否给这些目录挂 PHP 处理器；多数此类部署只把 `.php` 交给 FPM 或干脆禁用，**要先打一颗探针小马确认执行性**。

## 五、后台路由表（节选，400+ 路由完整版取 plugin/admin/config/route.php）
- 账号：/app/admin/account/{login,logout,info,update,password,refreshToken,captcha/{type}}
- 上传：/app/admin/upload/{image,file,avatar}、/app/admin/api/common/upload
- 管理员/权限：/app/admin/api/admin/{list,detail,add,edit,delete,status,role-*,rule-*,log-*,ip-location,batch-update-location}
- 会员：/app/admin/api/member/{list,info,child-list,balance-log-list,add,edit,delete,lock,kick,edit-balance,edit-point,edit-xima,reset-fund-password,security-info,reset-google,unbind-phone,unbind-email,reset-question}
- 财务：/app/admin/api/rebate/*、/app/admin/finance/{withdraw,recharge,sysbank,payset}-*
- 彩票：/app/admin/api/lottery/{index,detail,save,set-status,delete,play-*,pre-result-*,result-*}
- 运维：/app/admin/api/maintenance/{clear-data,preview-count,notice/*,task/*}、/app/admin/api/monitor/{server,online/*}
- 统计：/app/admin/api/statistics/*、/app/admin/api/yebao/*、/app/admin/api/chat28/*、/app/admin/api/robot/*

## 六、登录与限流（源码 AccountController）
`checkLoginLimit()`：按 `md5(username)` 落盘 runtime/login，5 分钟内计数 ≥5 抛「登录失败次数过多，请5分钟后再试」。
线上部署版本比公开源码多做了「验证码不能为空 / 验证码错误或已过期」校验（公开源码里没有），说明**目标做过二次开发，公开源码只能当路线图，不能当逐行事实**。

## 七、注意
install/step1 带 `overwrite=1` 会 `DROP TABLE` wa_admins 等表，属于破坏性操作，演练中禁止使用。
