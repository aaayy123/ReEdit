/**
 * 工具调用前置门禁（2.0 新增）
 *
 * 设计来源：ARTEX 的 `intercept_rules`（match_target + regex + priority + decision）
 * 与 `llm_judge` 的产品语义。**代码全部重写，且没有复制它的规则文本。**
 *
 * ⚠️ 与 ARTEX 的差异（必须说清）：
 *   ARTEX 的 judge 会用模型二次判断"这次调用该不该放行"。
 *   本插件的宿主没有向插件暴露模型调用通道（lib/ 内 grep 不到 ctx.llm / generateText），
 *   因此这里实现的是**规则判定**，不是模型审核。对外命名用 `precheck` 而不是 `judge`，
 *   避免让人以为背后有模型在审。
 *
 * 语义对齐的部分：
 *   · decision：allow / deny / ask
 *   · priority：数字小的先判，命中即返回
 *   · match_target：只匹配指定字段（tool / command / input）
 *   · 每条规则可独立开关，配置落在 config.json 的 precheck 段
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 内置规则：只描述"值得停一下"的形态，不做价值判断。 */
export const BUILTIN_RULES = Object.freeze([
  {
    id: 'mass-delete',
    name: '[内置] 递归强删',
    enabled: true,
    priority: 60,
    match_target: 'command',
    pattern: '(?i)\\b(rm\\s+-rf\\s+/[^t]|rd\\s+/s\\s+/q\\s+[a-z]:\\\\)',
    decision: 'ask',
    reason: '递归强删且目标在系统盘根目录，确认路径无误再执行',
  },
  {
    id: 'credential-in-cmdline',
    name: '[内置] 口令写在命令行',
    enabled: true,
    priority: 70,
    match_target: 'command',
    pattern: '(?i)(pass(word)?|pwd|token|api[_-]?key)\\s*[=:]\\s*[^\\s]{6,}'
      + '|\\b(mysql|mysqldump|redis-cli|sqlcmd|psql)\\b[^\\n]{0,60}\\s-p[^\\s]{6,}'
      /* 连接串里的口令：scheme://user:password@host —— 也很常见于命令行与日志 */
      + '|[a-z][a-z0-9+.-]*://[^\\s/:@]+:[^\\s@]{3,}@',
    decision: 'ask',
    reason: '口令/令牌出现在命令行，会被 ps 与 shell history 记录；改用环境变量或配置文件',
  },
  {
    id: 'bind-all-interfaces',
    name: '[内置] 监听 0.0.0.0',
    enabled: true,
    priority: 75,
    match_target: 'command',
    pattern: '(?i)(--host\\s+0\\.0\\.0\\.0|0\\.0\\.0\\.0:\\d{2,5}|bind\\s+0\\.0\\.0\\.0)',
    decision: 'ask',
    reason: '监听全部网卡、对公网可达；测试服务默认应绑 127.0.0.1',
  },
  {
    id: 'disable-security',
    name: '[内置] 关闭安全组件',
    enabled: true,
    priority: 50,
    match_target: 'command',
    pattern: '(?i)(set-mppreference[^\\n]*-disablerealtimemonitoring|netsh\\s+advfirewall\\s+set[^\\n]*state\\s+off|ufw\\s+disable|systemctl\\s+stop\\s+(firewalld|apparmor))',
    decision: 'deny',
    reason: '关停主机安全组件属于高影响操作，需人工确认后单独执行',
  },
  {
    id: 'wipe-evidence',
    name: '[内置] 清除痕迹',
    enabled: true,
    priority: 45,
    match_target: 'command',
    pattern: '(?i)(vssadmin\\s+delete\\s+shadows|wevtutil\\s+cl\\s+|cipher\\s+/w|history\\s+-c|clear-eventlog)',
    decision: 'deny',
    reason: '清除日志/卷影属于不可逆操作，且会破坏取证链',
  },
])

const EMPTY_CFG = () => ({
  version: 1,
  enabled: true,
  /** 未命中任何规则时的默认动作 */
  defaultDecision: 'allow',
  /** 命中 ask 时的动作：ask 原样返回给宿主 / deny 直接拦 / allow 放行 */
  askPolicy: 'ask',
  /** 记决策流水（内存环形，不落盘） */
  record: true,
  rules: [],
})

function cfgPathOf(root) {
  return join(root, 'config.json')
}

export function loadPrecheckConfig(root) {
  const base = EMPTY_CFG()
  const file = cfgPathOf(root)
  if (!existsSync(file)) return Object.assign({}, base, { path: file, rules: BUILTIN_RULES.map((r) => ({ ...r })) })
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const p = raw && typeof raw.precheck === 'object' && raw.precheck ? raw.precheck : {}
    const custom = Array.isArray(p.rules) ? p.rules : []
    return {
      version: 1,
      enabled: p.enabled !== undefined ? !!p.enabled : base.enabled,
      defaultDecision: ['allow', 'deny', 'ask'].includes(p.defaultDecision) ? p.defaultDecision : 'allow',
      askPolicy: ['ask', 'deny', 'allow'].includes(p.askPolicy) ? p.askPolicy : 'ask',
      record: p.record !== undefined ? !!p.record : true,
      /* 内置规则 + 用户规则；同 id 时用户覆盖内置 */
      rules: mergeRules(BUILTIN_RULES, custom),
      path: file,
    }
  } catch {
    return Object.assign({}, base, { path: file, rules: BUILTIN_RULES.map((r) => ({ ...r })) })
  }
}

function mergeRules(builtin, custom) {
  const map = new Map()
  for (const r of builtin) map.set(r.id, { ...r })
  for (const r of custom) {
    if (!r || typeof r.id !== 'string' || r.id === '') continue
    const prev = map.get(r.id) || {}
    map.set(r.id, {
      id: r.id,
      name: String(r.name || prev.name || r.id),
      enabled: r.enabled !== undefined ? !!r.enabled : (prev.enabled !== undefined ? prev.enabled : true),
      priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : (prev.priority ?? 100),
      match_target: ['command', 'input', 'tool'].includes(r.match_target) ? r.match_target : (prev.match_target || 'command'),
      pattern: String(r.pattern || prev.pattern || ''),
      decision: ['allow', 'deny', 'ask'].includes(r.decision) ? r.decision : (prev.decision || 'ask'),
      reason: String(r.reason || prev.reason || ''),
    })
  }
  return Array.from(map.values()).sort((a, b) => a.priority - b.priority)
}

export function savePrecheckConfig(patch = {}, root) {
  mkdirSync(root, { recursive: true })
  const file = cfgPathOf(root)
  let raw = {}
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { raw = {} }
  const prev = raw.precheck || {}
  const next = Object.assign({}, EMPTY_CFG(), prev)
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled
  if (['allow', 'deny', 'ask'].includes(patch.defaultDecision)) next.defaultDecision = patch.defaultDecision
  if (['allow', 'deny', 'ask'].includes(patch.askPolicy)) next.askPolicy = patch.askPolicy
  if (patch.record !== undefined) next.record = !!patch.record
  if (Array.isArray(patch.rules)) next.rules = patch.rules
  next.updated_at = new Date().toISOString()
  raw.precheck = next
  writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8')
  return loadPrecheckConfig(root)
}

/**
 * 取规则要匹配的文本。match_target 决定看哪个字段。
 * `tool` 只比工具名，`command` 取命令串，`input` 取整个入参的 JSON。
 */
function targetText(rule, call) {
  const t = rule.match_target
  if (t === 'tool') return String(call.tool || '')
  if (t === 'command') return String(call.command || call.input?.command || call.input?.cmd || '')
  try { return JSON.stringify(call.input || {}) } catch { return '' }
}

/** 内存流水：只留最近 200 条，不落盘。 */
const decisions = []

/**
 * 判定一次工具调用。
 *
 * @param {{tool?:string, command?:string, input?:object}} call
 * @param {object} [cfg]
 * @returns {{decision:'allow'|'deny'|'ask', ruleId:string|null, reason:string, target?:string}}
 */
export function precheck(call = {}, cfg) {
  const c = cfg || loadPrecheckConfig(process.env.DSH_HOME ? join(process.env.DSH_HOME, 'redteam') : '')
  if (!c.enabled) return { decision: 'allow', ruleId: null, reason: 'precheck disabled' }

  for (const rule of c.rules) {
    if (!rule.enabled || !rule.pattern) continue
    let rx
    try {
      /* 规则里可能带 PCRE 风格的 `(?i)` 前缀（用户从别处粘来的规则常见）。
         JS 的 RegExp 不认内联 flag，会直接抛 Invalid group —— 必须剥掉改用 flags，
         否则整条规则静默失效。 */
      const raw = String(rule.pattern).replace(/^\(\?[imsu]+\)/, '')
      rx = new RegExp(raw, 'i')
    } catch { continue }
    const text = targetText(rule, call)
    if (text === '' || !rx.test(text)) continue
    let decision = rule.decision
    if (decision === 'ask') decision = c.askPolicy
    const out = { decision, ruleId: rule.id, reason: rule.reason || rule.name, target: rule.match_target }
    if (c.record) {
      decisions.push({ at: new Date().toISOString(), tool: call.tool || '', ruleId: rule.id, decision })
      if (decisions.length > 200) decisions.shift()
    }
    return out
  }

  return { decision: c.defaultDecision, ruleId: null, reason: '' }
}

/** 最近决策流水（面板展示用）。 */
export function recentDecisions(limit = 20) {
  return decisions.slice(-Math.max(1, Number(limit) || 20)).reverse()
}

export default {
  BUILTIN_RULES,
  loadPrecheckConfig,
  savePrecheckConfig,
  precheck,
  recentDecisions,
}
