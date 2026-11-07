## 1) 控制器文件存在性预言机（比 ?g=&m= 的 404/302 二分精确得多）
```
GET /App/Lib/Action/<Group>/<Name>Action.class.php/<任意尾段>
```
- 文件存在 → 被 PHP-FPM 直接执行（PATH_INFO 绕过），display_errors=On 时回显
  `Fatal error: Class 'CommonAction' not found in /www/wwwroot/<项目>/App/Lib/Action/Admin/<Name>Action.class.php on line N`（200）
- **父类名直接暴露鉴权继承关系**：报 `Class 'CommonAction' not found` = 走后台闸门；
  报 `Class 'Action' not found` = extends Action，**脱队控制器**（这正是要找的目标）。
- 文件不存在 → nginx 404 146B。
- 校准：Admin/UserAction→EXISTS(CommonAction)，Admin/WechatAction→404，Home/OrderAction→EXISTS(Action)。

## 2) 本靶标实测结果（176 = 192.0.2.1，域名 target475.example.com / *.target476.example.com）
- Admin 组控制器全集：Index / User / Main / System / Admin / Block / Article / Payorder（8 个，**全部 extends CommonAction**）。
- Wechat / Autoart / Api / Order / Notice / Message / News / Upload / Member / Config / Coupon / Pay / Payment / Ad / Link / Sms / Tool / Db / Backup / Cron / Task / File / Log / Kj / Open / Service / Set / Setup / Menu / Group / Role / Report / Finance / Withdraw / Deposit / Charge / Bonus / Activity / Share / Agent = **全部 404（文件不存在）**。
- 模板面交叉验证：/App/Tpl/Admin/Wechat_index.html、Wechat_index_1.html、Autoart_index.html、Autoart_kjer.html、Api_index.html、Order_index.html、Notice_index.html 全 404；User/Main/System/Payorder/Index_login 模板 200。
  ⇒ **KB 372 的 Wechat::index_1 签名绕过 / Autoart::kjer 打法在这类"精简版"主机上没有落点，攻击前必须先跑预言机。**
- Home 组：Index / Order / Article / List 存在，其中 **Home/Order 报 'Action' not found（脱队）**，但只有 get_html1、downapp 两个 action 存活，且 url/ename/id/path/tpl 参数全惰性（get_html1 恒回 58B JSON `{"ok":1,"msg":"成功请刷新"}`、downapp 恒回 `0`）；Home/Article 22 个 action 全回 13B `502`。⇒ 无可控写/读原语。

## 3) 「302 与 Host 无关」对照实验（判定后台闸门类型）
对 /Admin/Index/login 依次用：真实域名、白名单式 abrdns 候选（品牌 55/66 等）、**随机不存在域名**、**空 Host**。
- 若"真实域名/白名单候选 = 200 登录页（1086B），其它 = 302" → HTTP_HOST 白名单，继续枚举。
- 若**连随机域名/空 Host 也一律 302**，仅 Host=IP 时 nginx 403，而同一批 / 与 /Home/Index 无论 Host 都 200 → 闸门比较的不是可伪造的 HTTP_HOST（多半 SERVER_NAME 或固定配置/整组禁用），**Host 头字典爆破在该机上拿不到后台登录页**，立刻换路（读 config/落 webshell 取凭据、DB 侧、基础设施侧）。
本靶标属于后者：20 个 `*.target477.example.com` 候选 + 随机 Host + 空 Host 全部 302。

## 4) 其它证否
- 192.0.2.2（target475.example.com 的另一台）：/List/ = 200 纯静态落地页（395B + js/index.js 4.9KB 开奖数据模板），/ 403，/index.php 与 /index.php?g=Admin&m=Index&a=login 稳定 500（PHP 后端异常），其它 Host 回 200「Sorry, the website has been stopped」宝塔停站页 ⇒ 不是站群实例。
- CDN 192.0.2.3/.84 上 Host=target475.example.com、target478.example.com → 530「域名未配置」，只有 csnsg36j8n 系域名回源，无独立攻击面。
