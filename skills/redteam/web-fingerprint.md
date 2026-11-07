---
name: web-fingerprint
description: Web 服务指纹识别：框架、中间件、CMS、组件版本
whenToUse: 已发现 HTTP/HTTPS 服务（80/443/8080/8443 等端口存活、有 Server/Title/banner 回显），需要识别框架/中间件/CMS/组件与版本时
role: recon,assess
enabled: true
---

## 方法
1. 响应头：`Server`、`X-Powered-By`、`Set-Cookie` 特征。
2. 页面特征：favicon 哈希、静态资源路径、报错页、robots.txt、JS 里的框架痕迹。
3. 主动探测：技术识别模板按技能 `nuclei-scan` 跑（`-tags tech`）；HTTP 存活/标题/状态码/技术栈的批量汇总按技能 `recon-pipeline`（httpx）——注意 `/usr/bin/httpx` 是 **Python httpx 库的 CLI**，ProjectDiscovery 版用包装器 `pd-httpx` 或绝对路径 `$DSH_HOME/redteam/toolkit/httpx/httpx`（同一二进制）。
4. 大网段批量指纹：走技能 `recon-pipeline` 的 httpx 批量（`-tech-detect`）；已提取的 JS 与证书特征一并纳入判断。
5. 版本比对：从指纹推断产品与版本，为漏洞检测做准备；命中组件版本写进该资产的 `fingerprints` 供漏洞发现选模板。

```bash
# 单站：技术识别模板（限速口径见技能 `nuclei-scan`）
nuclei -u https://target.example.com -tags tech

# 批量：PD httpx 出标题/状态码/技术栈
pd-httpx -l runs/alive-urls.txt -tech-detect -title -status-code -web-server -silent -json -o runs/fingerprint.jsonl
```

## 评估排序口径（资产梳理角色用）
逐条评估易打性后按此排序：**能推进主线阶段的优先**（能拿服务器权限 / 建隧道进内网 / 通向集权与靶标系统的资产），同阶段内再按易打性：**命中已知 Nday RCE 的中间件/框架 ＞ 未授权接口或管理后台 ＞ 暴露的数据库/缓存 ＞ 弱口令管理端 ＞ 官网静态站**。分值高但只是同阶段重复成果的（又一台同类 web 登录）排后面——不要按分值排序把队伍带成"刷分"。**边缘资产优先**：旁站、测试/预发环境、老旧系统、非标准端口、VPN/堡垒机/运维平台/文件服务器/备份系统，往往比官方门户好打得多。

## 落库要求
写入 fingerprint 表：category（框架/中间件/CMS/组件）、vendor、product、version、evidence。
