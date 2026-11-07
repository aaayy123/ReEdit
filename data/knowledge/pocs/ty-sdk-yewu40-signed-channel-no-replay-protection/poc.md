## TY SDK 白标体育平台 /yewu40 签名通道防护缺失（实测）

**适用面**：熊猫体育/TY SDK 白标体育平台（前端 localStorage 键前缀 TY_SDK_*、merchantCode 528312）。试玩入口：主站 POST /api/getTryToken → 返回的 loginUrl（target415.example.com?token&gr&tm&lg&mk&api&sessionId）在浏览器打开即得试玩会话。

**实测行为**（example.com，鉴权头 requestId=<40hex token>）：
1. POST /yewu40/req/request body={sessionId,os,sid,uid,code(AES密文b64),device,sign,t}
   - 仅改 uid 保 sign → 0400500 参数校验不通过（验签真实有效）
   - 整包字节级原样重放（161 秒前的旧 sign+t）→ 0000000 success（**无防重放，t 不参与判定**）
2. checkId 头（pc-<uuid>-<uid>-<t>）客户端任意伪造（随机 uuid+他人 uid）→ 服务端不校验仍 0000000
3. 对照：token 改 1 字符 → 0401013 拒绝

**要点**：
- 身份全绑 token，body uid 受 sign 保护，未发现 IDOR 面；queryBetAmountPB 的赔率由服务端权威下发（客户端篡改 oddsValue/oddsFinally 无效）
- 响应 data 字段是 base64(gzip(JSON))，页内 DecompressionStream('gzip') 直接解出可读 JSON
- 投注下单 /yewu13/v1/betOrder/betPB 服务端逐字段中文回显缺啥（设备类型/注单串关类型），但顶层串关字段名未破解；betMoney 单位为分
- 危害上限：本次重放的命令为遥测类；code 字段 AES 加密未破解，若其可承载下注/转账命令则可升级为资金重放