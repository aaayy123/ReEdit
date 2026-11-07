# 忘记密码三步流程逆向 —— 未鉴权改密接口的字段契约

## 前端还原（模块 5785，/forgetPassword/step3）

```js
var e = {
  agentName: t,                 // 代理账号名
  password: md5(newPwd),        // 新密码，前端 md5
  confirmPassword: md5(confirm) // 确认密码，前端 md5
  // twoStepCode: n              // 可选
};
if (!twoStepCode) delete e.twoStepCode;     // 空值直接删掉
verifyType !== "4" ? postGetBackLoginPassword(e)
                    : postManualCheck({twoStepCode, safetyType:1, value:md5(pwd), name, verifyInfo});
```

verifyType 默认值 **"3"**（模块 1666 的 initializer），对应 `googleAuth` 分支，
走 `getBackLoginPassword` 且**不需要 twoStepCode**。

## 状态码语义（本命名空间）

| code | 含义 |
|------|------|
| 6000 | 成功 |
| 6001 | 需会话（「30分钟无操作，自动退出登录」） |
| 6008 | 参数/格式错误 |
| 6012 | 新密码与确认密码不一致 |
| 6011 | 提交过于频繁 |
| 6040/6041 | LOGIN_RISK_NO_AGENT_PWD / _DARK_PWD（无代理密码） |
| 6005 / 500 | 服务器错误（已进入业务逻辑但后端异常） |

## 参数名差分探测（关键：不要猜，去掉一个字段看响应是否变）

候选：confirmPassword / confirmPwd / password2 / rePassword / repassword /
      confirmPasswordMd5 / passwordConfirm / newPassword / newPwd / pwd2 /
      checkPassword / passwordAgain / againPassword / twicePassword

结果：**只有 `confirmPassword` 生效** —— 响应从 6012 变为 6005。

## 响应演进证据链

```
{}                                              → 6008 "密码必须是32位MD5加密串"
{"password":"<md5>"}                            → 6012 "新密码和确认密码输入不一致!"
{"password":"<md5>","confirmPassword":"<md5>"}  → 6005 "服务器错误"   ← 进入改密逻辑
{"password":"<md5>","confirmPassword":"<md5>","agentName":"admin"} → 6005 "服务器错误"
```

任意 32 位十六进制均通过格式校验（`"0"*32`、`"a"*32` 同样返回 6012），
服务端不校验原密码。

## 未完成的部分

带齐 password + confirmPassword + agentName 后仍返回 6005，
推断缺少 step2「安全校验」阶段写入的服务端状态（twoStepCode 由 Google Auth TOTP 生成）。
即：**接口确实未鉴权，但要真正改密还需绕过 TOTP 或 step2 的状态机**。