## 一句话
Tomcat 未关 `showServerInfo` 时，错误页会带 `类名.java:行号`。**把这个行号当 oracle**，就能把"缺哪些参数 / 走到哪一步 / POST 与 GET 是不是同一条代码路径"全部测出来 —— 比一次性灌"全量参数钥匙"精确得多（灌全量会把中间层分支掩盖掉）。

## 判读方法（四步）
1. **拿基线**：空请求 → 记录行号（通常是第一个 `Integer.parseInt` 处，`NumberFormatException: null`）。
2. **逐级加参数**：每加一个 int 参数，看行号是否 +1（行号推进 = 该参数被消费了）。
3. **二分收敛最小集**：以"行号推进到目标行"为判据，二分 + 逐项剔除，得到"刚好能走到下一步"的最小参数集。
4. **固定行号 = 卡在非参数的东西上**：行号不再随参数变化 ⇒ 该行读的是 **session 属性 / 上下文对象 / DB 结果**，不是请求参数 ⇒ **再试参数名就是浪费时间**，直接转"是否需要登录"判断。

## 关键判据：POST 与 GET 是不是同一条路径？
看**异常栈的调用链**，不要看行号：
```
java.lang.NullPointerException
    example.com.Service2_8.PutTp.doGet(target347.example.com:46)
    example.com.Service2_8.PutTp.doPost(target347.example.com:82)     ← doPost:82 只是 doGet 的包装
```
⇒ **POST 无独立分支**（"POST=上传"的假设被否）。反过来，若 POST 直接出现在栈顶（`doPost(xxx.java:NN)`）而 doGet 不出现，才是独立分支。

## multipart / base64 / 落点参数该怎么判
- **行号不推进** = 该 servlet **完全不解析** multipart（请求体参数名根本读不到）⇒ 别再换字段名。
- 行号推进但响应不变 = 参数被读了但分支没变 ⇒ 继续做"值扫描"（0/1/2/3…）。

## 本靶标实测（PutTp，`/LHService/tp`）
```
(空)                    → target347.example.com:40 NumberFormatException（第1个int）
type=1                  → line 41（第2个int，且它要的不是 type）
二分收敛                → **最小集 = {id, type}**
{id,type} / 329参数钥匙 → line 46 NullPointerException（响应 1125B）
multipart(8字段名×2文件名) → 全部 line 40（不解析 multipart）
base64(10个字段名)      → 全部 line 41
落点参数(filename/path/dir/savePath/ext/suffix) → line 46
id/type 值 0..3         → 全部 line 46、响应长度恒 1125（值不影响流程）
userid=1/0/2/2089765/3134841/999999999 → 全部 line 46（不是"查不到用户"）
带新 JSESSIONID         → 仍 line 46
⇒ **line 46 固定需要"登录会话属性" ⇒ 不可未认证触发，判死**
```

## 适用前提与反例
- 前提：错误页泄露 `<pre>` 栈（Tomcat 默认；若已关 `showServerInfo` 则行号 oracle 失效，只剩响应长度/耗时可用）。
- 反例提醒：**行号相同 ≠ 行为相同**（值分支可能不改变执行到异常的那一行）⇒ 值扫描要配合**响应长度/内容**一起看（本例三者一致 = 确实无分支）。