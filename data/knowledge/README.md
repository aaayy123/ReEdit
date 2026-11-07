# ARTEX 0.4.2 → dsh-purge v1.1.90-beta.1 知识库迁移包

本目录是**阶段 3 暂存产物**。数据库写入（阶段 4）由人工在 DSH 完全退出后执行。

- 源包：`ARTEX-0.4.2-Windows64位.zip`
- 源包 SHA256：`6B9882A1B80E9D6A316B8888ADB87689B74004C4E36104AED8C8516361BD573F`
- 源 `redteam/knowledge.db` SHA256：见 `manifest.json` 的 `source_db_sha256`
- 目标：`dev` 分支 `fb180cad77f868719f9ccaa1e16a51e6fa54c97`（v1.1.90-beta.1）

## 内容

| 路径 | 说明 |
|---|---|
| `skills/redteam/*.md` | 46 个主技能 + 59 个 refs 扁平化文件（共 105） |
| `data/knowledge/artex-poc-insert.sql` | 489 条 `poc` + 489 条 `poc_fts` 插入语句 |
| `data/knowledge/pocs/<code>/<file>` | 145 个纯文本 POC（`.md/.txt/.http/.yaml`） |
| `data/knowledge/manifest.json` | 逐条 id → code → 目标路径 → 处置动作 |

## 阶段 4：写入本机知识库（人工执行）

前置：**完全退出 DSH**，确认 `%USERPROFILE%\.dsh\redteam\knowledge.db-shm` 不再被占用。

```powershell
$rt = "$env:USERPROFILE\.dsh\redteam"

# 1) 备份三件套
Copy-Item "$rt\knowledge.db"     "$rt\knowledge.db.bak-$(Get-Date -f yyyyMMdd-HHmmss)"
if (Test-Path "$rt\knowledge.db-shm") { Copy-Item "$rt\knowledge.db-shm" "$rt\knowledge.db-shm.bak" }
if (Test-Path "$rt\knowledge.db-wal") { Copy-Item "$rt\knowledge.db-wal" "$rt\knowledge.db-wal.bak" }

# 2) 落盘 POC 文本
Copy-Item "D:\Chromedownload\ReEdit\data\knowledge\pocs" "$rt\pocs" -Recurse -Force

# 3) 写入 poc 表与 FTS
python -c "import sqlite3,sys; c=sqlite3.connect(r'$rt\knowledge.db'); c.executescript(open(r'D:\Chromedownload\ReEdit\data\knowledge\artex-poc-insert.sql',encoding='utf-8').read()); c.commit(); print('rows=',c.execute('select count(*) from poc').fetchone()[0])"

# 4) 同步技能（包内 skills/redteam 会在插件启动时自动同步到 $rt\skills；
#    如需立即生效不必手工复制）
```

## 验证（逐项给出实际输出，不通过即回滚）

```powershell
python - <<'PY'
import sqlite3, os
p = os.path.join(os.environ["USERPROFILE"], ".dsh", "redteam", "knowledge.db")
c = sqlite3.connect("file:" + p.replace("\\","/") + "?mode=ro", uri=True)
q = lambda s: c.execute(s).fetchone()[0]
print("V1 poc rows      :", q("select count(*) from poc"))            # 期望 489
print("V2 integrity     :", q("pragma integrity_check"))               # 期望 ok
print("V3 fts rows      :", q("select count(*) from poc_fts"))         # 期望 489
print("V4 match ssrf    :", q("select count(*) from poc_fts where poc_fts match 'ssrf'"))   # 期望 26
print("V5 match 未授权  :", q("select count(*) from poc_fts where poc_fts match '未授权'")) # 期望 65
print("V9 dup codes     :", q("select count(*) from (select code from poc group by code having count(*)>1)"))  # 期望 0
PY
```

## 已知边界（源数据固有，非迁移缺陷）

- **80 条 `poc` 记录正文为空**：源 `knowledge.db` 中 `content` 即为空，且源包 `redteam/pocs/` 下无对应文件，仅存 `title/description/tags` 元数据。
- **262 条脚本类 POC 未落盘**：`.py/.sh/.php/.js/.ps1/.go/.java` 按安全要求不落地，其 `content` 字段仍保留正文文本，`path` 置 `NULL`。
- **82 条源记录无 `path`**：迁移后 `path` 保持 `NULL`。
- **`cve.db`（243 MB）、`toolkit/`（含 PE）、`nuclei-templates/`（12,263 yaml）未迁移**：目标版本无对应消费方或属可执行文件。

## 回滚

```powershell
$rt = "$env:USERPROFILE\.dsh\redteam"
# 停 DSH 后：
Remove-Item "$rt\knowledge.db","$rt\knowledge.db-shm","$rt\knowledge.db-wal" -Force -ErrorAction SilentlyContinue
Move-Item "$rt\knowledge.db.bak-<时间戳>" "$rt\knowledge.db"
Remove-Item "$rt\pocs\*" -Recurse -Force
# 技能：包内 skills/redteam 删除即可；本机 23 个原文件未被修改
```
