GET https://target483.example.com/v1/models -H "Authorization: Bearer sk-257c09a4d84250ed98ef354a9d6bb902f3229b696c191155c083ac0c7e4aa897" -A "<Chrome UA>" → HTTP 200, 3755B, {"data":[{"id":"gpt-6"...},{"id":"gpt-image-2"...}]}
对照：无 Authorization → 401 {"code":"API_KEY_REQUIRED"}（143B）；Bearer sk-000…0 → 401 {"code":"INVALID_API_KEY"}（54B）；Bearer sk-452481c3…（key id230，所属 group 4 已被删）→ 403 {"code":"GROUP_DELETED"}（66B，证明该 key 在库中仍被识别）。
来源：D:\ARTEX\data\tasks\607\i6403\db.sql（api_keys 259 行，167 行真实键；groups 表仅 grp5 'ce' 与 grp18 '自部署DEEPSEEK' 未删除）。
产物：D:\ARTEX\data\tasks\607\i6502\dumptables.json、an5.py、t1.txt。
证伪条件：若该 key 返回 401/403 或模型清单为空则不成立——本次均未出现。