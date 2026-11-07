---
name: cloud-security
description: 云安全攻防：云平台（AWS/Azure/GCP/阿里云/腾讯云/华为云）与云原生（K8s/容器/Serverless/CI-CD）的凭据验证、权限侦察、凭证循环放大、信任链横向、SSRF 打元数据
whenToUse: 拿到云凭据（AK/SK、临时凭证、kubeconfig、CI token、函数环境变量里的密钥）、SSRF 可打云元数据、或发现云资产面（存储桶/快照/函数/K8s API Server/控制台）时
role: internal,exploit
enabled: true
---

# 云安全攻防（身份 → 权限 → 资源 → 影响）

主观念：每条云上攻击路径由**身份→权限→资源→影响**四要素闭环支撑。
**发现 ≠ 真实**：真实 = API 响应原文 + 策略文档 + 权限清单三重证据。
云上地盘不是网络，是**身份与信任关系**——两个引擎驱动扩大战果：
1. **凭证循环**：几乎每个战果里都有新凭证（桶里配置含 key、secret 里存着别账号 token、
   角色可以被扮演）——拿下任何东西先问"这里面还有什么凭证"；
2. **信任链枚举**：谁能扮演谁（AssumeRole 信任 / 服务绑定 / OIDC 联邦 / 跨账号委托）——信任边即横向边。

## 纪律
- **只读 API 优先**：枚举/验证一律 List/Get/Describe 类；写类动作（创建角色/key/信任）= 环境改动，先经指挥/用户确认，并逐项登记（交还原清单）。
- **假设一切被审计**：云审计日志基本常开——同效验证优先选冷门只读事件，不碰自带告警的高敏动作（CreateKey / KMS / 组织级操作）；**禁止删改审计日志**（红线）。
- **限速与账单**：跨区枚举/快照遍历烧钱——分页限速（默认 1 QPS 级），批量枚举退避。
- **工具获取（分级，别写死；仅限本机/操作机）**：厂商 CLI 已装的直接用（`command -v` 检测）；缺了按三档走——① **无侵入获取**：自包含单文件产物（单二进制/单 jar）下载到 `$DSH_HOME/redteam/toolkit/` 自用，不写 PATH、不装依赖，**不用问直接下**；② **需批准安装**：要包管理器/系统依赖的（brew/apt/pip 全局装 CLI），先报指挥或用户批准再动；③ **等价兜底**：REST API + python3/curl 直调（凭证不变，能力不降）。禁止的只有**擅自系统级改动**（写 PATH、装系统依赖、改全局配置）；**目标主机上不装任何工具**（红线见技能 `host-enum`）。
- 凭证只进 `redteam_credential_add` 与 runs/ 证据，不写进无关输出；发现即提示用户轮换。

## 0. 凭据指纹（命中即取）
| 指纹 | 厂商 | 说明 |
|---|---|---|
| `AKIA[0-9A-Z]{16}` | AWS 长期 AK | `ASIA` 前缀 = STS 临时凭证（带 session token） |
| `LTAI[0-9A-Za-z]{12,20}` | 阿里云 AK | |
| `AKID[0-9A-Za-z]{20,40}` | 腾讯云 SecretId | |
| `"type": "service_account"` JSON | GCP 服务账号密钥 | client_email / private_key 全文 |
| GUID 形态 client_id + client_secret | Azure 服务主体 | 常配 tenant id 一起出现 |
| kubeconfig / sa token（`eyJhbGciOi…` JWT + ca.crt） | K8s | 见卡 4 |

**入口六源**：① 代码仓库与 git 历史（gitleaks，检测制）；② CI/CD 环境变量与 secrets；
③ SSRF→元数据（卡 1）；④ 前端 JS/小程序/安装包（`apk-recon` 提取物里过一遍上表正则）；
⑤ 主机上的客户端配置（`~/.aws/credentials` 类、kubeconfig、云 CLI 配置——已控主机上优先翻）；
⑥ 对象桶内的备份与配置文件。
**页面/前端硬编码云密钥优先直接连云验证**（下面 §1 起全流程），验证有效 > 继续猜其他入口。

## 1. 身份确认（拿到任何凭证的第一步）
不知道"我是谁"之前不深入。各家 whoami 类只读调用（CLI 检测制，无 CLI 用 REST+curl/python 等价）：
```bash
aws sts get-caller-identity                 # AWS
aliyun sts GetCallerIdentity                # 阿里云
tccli sts GetCallerIdentity                 # 腾讯云
hcloud sts GetCallerIdentity                # 华为云（或 IAM keystone token 查验）
az account show                             # Azure（az login 用 service principal）
gcloud auth list --format=json              # GCP（或 oauth2 tokeninfo）
```
身份与账号（AccountId / 租户 / 主体 ARN）落 `redteam_credential_add`（`source` 写泄露来源）。

## 2. 权限侦察（这个身份能干什么）
只读枚举策略/角色/组；重点标两类面：
- **可造身份**：CreateAccessKey / CreateRole / 新增信任策略类权限——能造身份 = 战果无限再生；
- **高价值面**：KMS（加密权=解密一切用它的桶/库/参数）、Secrets Manager、组织管理账号、
  IdP/OIDC 联邦信任（接管身份源=接管一切 SSO）、CI/CD 平台（流水线凭据直通批量负载）。

## 3. 提级序（先拿什么）
**身份面（能造 key/角色）> 控制面（控制台接管）> 密钥面（Secrets/KMS）> 数据面（桶/库/快照）**。
每拿下一个战果立刻搜"里面还有什么凭证"（配置/env/备份/secret 内容）→ 回 §1 重新验证。

## 4. 凭证循环放大
新凭证 → §1 身份确认 → §2 权限侦察 → 新面……循环到**无新凭证可拿、无新权限可提**。
每轮新凭证落库、关键动作 `redteam_chain_add`（循环轮次可见 = 扩大过程可审计）。

## 5. 横向：信任链枚举
- 枚举可扮演角色：跨账号 AssumeRole 链 / 服务角色绑定 / OIDC 联邦信任 / 资源目录成员；
- 路径：跨账号 → 跨服务（计算→K8s→CI）→ **跨云**——同一套 IaC 多云部署时，一朵云里发现的
  配置缺陷（桶公开/角色过宽/开放端点）在其他云**大概率同款**，优先按同构面逐云复测；
  管理身份层（SSO/邮箱/密码策略）跨云复用。
- 每条信任边登记 chain；**超出授权范围的横向只规划不执行**，记"未执行+原因"。

## 6. 持久化（登记制）
后门角色 / 新增 AccessKey / OIDC 信任新增 / 函数后门 / 镜像投毒——全部是环境改动：
先经指挥/用户确认，逐项登记还原方式，**不自动清理**（还原清单随成果交付）。

## 7. 穷尽终止
无新凭证、无新信任、无新权限 → 收敛：汇总权限链与攻击路径（§8），交还主线。

## 场景卡（命中即按卡打）

### 卡 1 SSRF → 元数据（凭证获取主力）
SSRF 可控时按厂商端点打（这是 SSRF 确认后的**第一优先级利用方向**）：

| 厂商 | 端点 | 认证要求 |
|---|---|---|
| AWS | `http://169.254.169.254/latest/meta-data/iam/security-credentials/` | v2 需先 `PUT /latest/api/token`（头 `X-aws-ec2-metadata-token-ttl-seconds: 21600`）再带 token GET——纯 GET 型 SSRF 打不动 v2，如实记录 |
| 阿里云 | `http://100.100.100.200/latest/meta-data/ram/security-credentials/` | 无（**注意不是 169.254**） |
| 腾讯云 | `http://169.254.0.23/latest/meta-data/cam/security-credentials/` | 无 |
| 华为云 | `http://169.254.169.254/openstack/latest/securitykey` | 无 |
| Azure | `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/` | 必须带 `Metadata: true` 头 |
| GCP | `http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token` | 必须带 `Metadata-Flavor: Google` 头 |

另有 `/latest/user-data/`（AWS 类）常含 bootstrap 脚本与明文密钥，必看。
取到临时凭证 → 立刻 §1（**记 TTL**，刷新机制一并拿）。

### 卡 2 泄露 AK/SK
指纹定厂商 → §1 身份确认 → §2 权限侦察。泄露源本身也是 finding（泄露渠道要修），随成果提示轮换。

### 卡 3 容器立足
容器内 shell → 逃逸面核对：`privileged` / hostPath / 危险 capability（`SYS_ADMIN`/`SYS_PTRACE`）/
docker socket 挂载 / 可写 `/proc/sysrq-trigger` 与 cgroup release_agent → 节点 →
**节点角色即云身份**（节点上打卡 1 端点）→ 集群 → 云 IAM 绑定。

### 卡 4 K8s 立足
pod shell / serviceaccount token / 暴露的 API Server·dashboard：
- `kubectl` 检测制（无则 HTTPS+curl 直调 API，`Authorization: Bearer <token>`）；
- 枚举：SA 权限（`kubectl auth can-i --list`）、secret 遍历（`get secrets -A`，**云凭证常在里面**→入池）、
  准入与 NetworkPolicy 缺陷、可创建 pod/挂载宿主机目录的高权 SA；
- 集群→云：节点角色 / IRSA·OIDC 绑定回云 IAM（回 §1）。

### 卡 5 CI/CD 流水线
流水线访问权（账密/OAuth/token，常来自卡 2 泄露源）→ 环境变量与 secrets 收割 →
批量工作负载凭据入池；**IaC 状态文件（terraform state）含明文凭据，高价值必拿**；
制品投毒属写操作——登记制（§6）。

### 卡 6 快照数据线（云特有"不碰系统拿数据"）
任意 RDS/EBS/盘快照读权限 → 快照复制/共享到授权账号 → 自建恢复 → 数据落袋
（绕过实例层访问控制）；恢复实例里的新凭证回 §1。

### 卡 7 Serverless 立足
公开函数 URL / 匿名触发器 / 拿到函数执行权：
- 函数绑定角色的权限面（常过宽）→ 回 §2；
- **函数环境变量常存 AK/SK、token** → 入池（Serverless 版"节点角色即云身份"）；
- 依赖包可写时投毒 = 持久化+横向（登记制 §6）；后门函数/触发器同样登记。

## 工具检测表（开工先跑）
```bash
for t in aws az gcloud aliyun tccli hcloud kubectl docker ossutil coscli gsutil gitleaks; do command -v $t >/dev/null 2>&1 && echo "[y] $t" || echo "[-] $t"; done
```
CLI 全缺：REST API + curl/python3 等价实现（各家 OpenAPI 都是 HTTPS+签名，AWS 用 SigV4 手写脚本
或 `curl --aws-sigv4`；阿里/腾讯有公共签名脚本模板）——凭证不变，能力不降，只是费事。

## 产出与落库（每条攻击路径）
- 路径五要素齐全才落：**入口凭证 → 身份 → 权限 → 资源 → 影响证明（API 响应原文/拿到了什么）**；缺影响证明的标"疑似"，不进成果。
- 凭证 `redteam_credential_add`（`source`=泄露/元数据/凭据复用）；云控制面拿下的系统即拿到云管理平台权限，照常落库（`redteam_access_add`）；拿下的主机/集群资产 `redteam_asset_add`。
- 每个关键动作 `redteam_chain_add`（`tool`=实际 CLI 命令，`result`=响应摘要）；证据（API 响应 JSON）落 `runs/` 并 `redteam_attack_file_add` 归档关键脚本。
- 收尾交**还原清单**：本次新增的角色/key/信任/触发器逐项列出 + 还原方式，交用户执行。
