/**
 * 随包知识库种子导入。
 *
 * 背景：knowledge.db 是**运行时数据**（`$DSH_HOME/redteam/knowledge.db`），不进仓库；
 * 仓库只带可重建库的源（`data/knowledge/artex-poc-insert.sql` + `pocs/`）。
 * 结果就是「卸载重装后技能自动到位，但 POC 库还是空的」——本模块补上这一步。
 *
 * 幂等策略（三重，任一条成立就不再导入）：
 *   1. `$DSH_HOME/redteam/.knowledge-seeded` 标记文件存在；
 *   2. `poc` 表已有数据（用户自己的库，绝不能覆盖）；
 *   3. 包内找不到 SQL（精简包 / 裁剪分发）。
 *
 * 失败一律静默降级：种子导入失败不能挡住插件启动。
 */
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SQL_PATH = join(PKG_ROOT, 'data', 'knowledge', 'artex-poc-insert.sql')
const STAMP_NAME = '.knowledge-seeded'

/**
 * 按**引号感知**的方式切分 SQL 语句。
 *
 * 不能用 `sql.split('\n')`：`content` 列是自由文本，字面量里含真实换行，
 * 一条 INSERT 会跨多行，按行切会把语句拦腰截断（`near "xxx": syntax error`）。
 * 这里只认「单引号字符串之外的分号」为语句边界，并处理 `''` 转义。
 */
function splitStatements(sql) {
  const statements = []
  let cur = ''
  let inString = false
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    if (inString) {
      cur += ch
      if (ch === "'") {
        if (sql[i + 1] === "'") { cur += sql[i + 1]; i += 1 }  // '' 转义
        else inString = false
      }
      continue
    }
    if (ch === "'") { inString = true; cur += ch; continue }
    if (ch === ';') { if (cur.trim() !== '') statements.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim() !== '') statements.push(cur.trim())

  const pocLines = []
  const ftsLines = []
  for (const s of statements) {
    if (s.startsWith('INSERT INTO poc (')) pocLines.push(s)
    else if (s.startsWith('INSERT INTO poc_fts')) ftsLines.push(s)
  }
  return { pocLines, ftsLines }
}

function writeStamp(stampPath, payload) {
  try {
    writeFileSync(stampPath, JSON.stringify(payload, null, 2), 'utf8')
  } catch { /* 标记写不进去就靠 poc 表非空兜底 */ }
}

/**
 * @param store RedteamStore 实例（需已 publish；内部用 store.kb() 建表）
 * @param log   可选日志函数
 * @returns { action: 'seeded'|'skipped'|'failed', ... }
 */
export function seedKnowledge(store, log = () => {}) {
  const root = store && store.root
  if (!root) return { action: 'skipped', reason: 'no-store' }

  const stampPath = join(root, STAMP_NAME)
  if (existsSync(stampPath)) return { action: 'skipped', reason: 'stamp' }
  if (!existsSync(SQL_PATH)) {
    log('seed: 包内没有 data/knowledge/artex-poc-insert.sql，跳过')
    return { action: 'skipped', reason: 'no-sql' }
  }

  let db
  try {
    db = store.kb()
  } catch (error) {
    return { action: 'failed', stage: 'open', error: String((error && error.message) || error) }
  }

  /* 已有数据 —— 这是用户实战沉淀的库，绝不能被种子覆盖 */
  let existing = 0
  try {
    existing = Number(db.prepare('SELECT count(*) AS n FROM poc').get().n) || 0
  } catch { existing = 0 }
  if (existing > 0) {
    writeStamp(stampPath, { at: new Date().toISOString(), skipped: 'not-empty', existing })
    return { action: 'skipped', reason: 'not-empty', existing }
  }

  let sql
  try {
    sql = readFileSync(SQL_PATH, 'utf8')
  } catch (error) {
    return { action: 'failed', stage: 'read', error: String((error && error.message) || error) }
  }

  const { pocLines, ftsLines } = splitStatements(sql)
  if (pocLines.length === 0) return { action: 'skipped', reason: 'empty-sql' }

  let hasFts = false
  try {
    hasFts = Boolean(db.prepare("SELECT 1 AS x FROM sqlite_master WHERE name = 'poc_fts'").get())
  } catch { hasFts = false }

  const started = Date.now()
  try {
    db.exec('BEGIN')
    try {
      /* 切分时已剥掉语句末尾分号，重新拼接要补回 */
      db.exec(pocLines.join(';\n') + ';')
      if (hasFts && ftsLines.length > 0) db.exec(ftsLines.join(';\n') + ';')
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
      throw error
    }
    try { db.exec('ANALYZE') } catch { /* 统计信息可有可无 */ }
  } catch (error) {
    return { action: 'failed', stage: 'exec', error: String((error && error.message) || error) }
  }

  const verified = (() => {
    try {
      return Number(db.prepare('SELECT count(*) AS n FROM poc WHERE verified = 1').get().n) || 0
    } catch { return 0 }
  })()

  const payload = {
    at: new Date().toISOString(),
    seeded: pocLines.length,
    fts_indexed: hasFts ? ftsLines.length : 0,
    verified,
    source_zip_sha256: '6B9882A1B80E9D6A316B8888ADB87689B74004C4E36104AED8C8516361BD573F',
    sql_bytes: statSync(SQL_PATH).size,
    elapsed_ms: Date.now() - started,
  }
  writeStamp(stampPath, payload)
  log(`seed: 已导入 ${pocLines.length} 条 POC（FTS ${hasFts ? ftsLines.length : '不可用'}），${payload.elapsed_ms}ms`)
  return { action: 'seeded', ...payload }
}
