## 目的
回答一个问题：**这个应用里有没有"请求形参 → 外发 HTTP 请求 / 文件路径"的 SSRF / 路径注入原语？**
不要在"形参名像 url"上浪费时间 —— 必须做数据流溯源。

## 四步筛查法（每步都可独立得出结论）

### 第 1 步：枚举全仓【外发 sink】（不要只搜 curl）
```bash
grep -rnE "curl_init|curl_setopt[^;]*CURLOPT_URL|fsockopen|stream_socket_client|\bfile_get_contents\s*\(|" app/ plugin/ process/
# 别漏了 HTTP 客户端风格（Guzzle/HttpClient/自研封装）：
grep -rnE "new Client\s*\(|->(get|post|request)\s*\(\s*\\$|httpGet|httpPost|httpPostWithHeaders" app/
```
> ⚠ 只搜 `curl_*`/`file_get_contents` 会漏掉所有用 Guzzle 的地方（本项目 `AnimalController` 就是用 `new Client()` + `->post()` 发的）。

### 第 2 步：逐个 sink 做【URL 实参溯源】（这步决定成败）
对每个 sink 取出 URL 实参表达式，然后回答"它从哪来"：

| URL 实参形态 | 判定 |
|---|---|
| 字符串字面量 / 类常量（`private $apiBase = 'https://…'`） | **不可控** |
| `$this->xxxApis[$name]` 这种**白名单 map 查表** | **不可控**（只取已有 key） |
| `$config->api_url ?? env('X')`（DB/环境变量） | **不可控直连** → 但记为**二阶 SSRF 候选**：去找"谁能写这张表/这个配置" |
| `"…{$var}…"`，而 `$var` 来自 `$request->post/get/header/形参` | **★可控 = 命中** |
| `$var = $request->getRealIp()` | 看框架语义：workerman 的 `getRealIp(safeMode=true)` 在**远程 IP 非内网时忽略 X-Forwarded-For** → 不可控；一旦哪处传了 `false` 或直接取 header → 可控 |

### 第 3 步：二阶 SSRF —— 追"配置表写入者"（最容易被漏掉的高价值路径）
```bash
grep -rn "api_url\|notify_url\|callback_url" app/ plugin/ | grep -E "->(insert|update|save)"
```
- 若写入者只在**后台插件**（本项目：`plugin/admin/.../target358.example.com:514,605`）→ 该路径要"先拿后台"才成立 → 在本靶标**判死**；
- 若写入者落在**未授权可达**的方法上 → **未授权改配置 + 触发一次外发 = 完整 SSRF**。
  本项目核对结论：`app/` 下**没有任何**写 `caipiao_game_platform` 的方法（全部是读），所以这条链不成立。

### 第 4 步：前端 JS 反查"部署版独有接口"的真实参数（零风险、不必发包）
线上源码是旧快照时，打包 JS 才是部署版的真相：
```bash
grep -oE "\.(get|post|put)\(\`/[a-z0-9/_-]+\`,\{[^}]*\}" chunks/*.js
```
本项目从 `chunks/electronic-CUH5hoh8.js` 直接读到：
```js
target359.example.com(`/electronic/launch`, {platform:…, gameId:…, device:…}, {timeout:6e4})
```
→ 确认该接口**没有 url/host 参数**，无需发包即可判定"不是 SSRF 入口"。

## 关键教训（写下来免得再踩）
1. **同类私有调用 `$this->method(` 必须跟**：本项目 `CollectorController::trigger` 的写库动作在私有 `collectAll()/collectOne()` 里，
   只扫方法体会误判成"无副作用"（我在这个靶标上真的用它误触发过一次采集）。
2. **属性名 ≠ 类名**：`$this->imService->send()` 要先把构造器里的 `$this->imService = new IMService()` 解析成类名，才能进被调方法体内继续看 sink。
   只按属性名查索引会漏掉整个 service 层。
3. **硬编码 base + 白名单 map 不算可控**（`$base . $map[$name]`），要作为"不可控"结案，不要报成 SSRF。

## 本项目实测结案（example.com，webman v2.1.2）
全仓外发 sink 共 5 处，URL 来源全部溯源完毕，**无一处由请求形参决定**：
| 位置 | URL 来源 | 判定 |
|---|---|---|
| `AnimalController` ×3 | `$apiBase` 类属性常量 `https://example.com/gameChart` | 不可控 |
| `CollectorController::httpGet` / `process/*Collector` | `$apiBaseUrl` 常量 + `$lotteryApis[$name]` 白名单 map | 不可控 |
| `GameController` ×3 | `$ngConfig->api_url ?? env('NG_API_URL')` | 二阶候选；写者仅在 nginx 屏蔽的 admin 插件 → 判死 |
| `GamePlatformService::httpPostWithHeaders` | `$platformConfig->api_url`；调用方均传 `$apiUrl . '/字面量'` | 同上 |
| `UserController::getIpRegion` | `"http://ip-api.com/json/{$ip}"`，`$ip = getRealIp()` 公网远程 → 头不被信任 | 不可控 |
结论：**该应用不存在"形参 → 外发 URL"的 SSRF 原语**；文件路径/包含类 sink 同样为空。