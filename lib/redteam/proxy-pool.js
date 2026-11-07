/**
 * 红队出口 / 代理池管理（2.0 新增）
 *
 * 设计来源：ARTEX 0.3.66–0.3.68 的"代理池 + 封禁判定"经验，
 * **只复用设计意图，代码全部重写**，不引入其二进制与脚本。
 *
 * 三条硬规则（来自实战踩坑）：
 *   1. 目标封禁（403/captcha/WAF 页）→ 立刻换出口
 *   2. 连接被墙（reset / SSL 中断 / timeout）→ **连续 2 次**才换，
 *      单次抖动就切会把节点池瞬间耗光
 *   3. 本地代理自身挂了（报错里带 127.0.0.1:端口）→ 不切，提示重启
 *
 * 另加两道保护：
 *   · 节点池耗尽：窗口内切换次数 ≥ 节点数 → 判"轮完一圈仍被封"，自动关闭轮换
 *   · 成功一次清零失败计数，避免"零星失败"累计误触发
 *
 * 本模块**不启动任何代理内核**（不打包 mihomo）。它只管理"用哪个出口"，
 * 内核由用户自装，通过 URL 交给本模块。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_WINDOW_MS = 5 * 60 * 1000
const BAN_PATTERNS = [
  /\b403\b/, /captcha/i, /access\s+denied/i, /人机验证/, /网站防火墙/,
  /云锁/, /安全狗/, /拦截/, /forbidden/i, /too\s+many\s+requests/i, /\b429\b/,
]
const BLOCK_PATTERNS = [
  /connection\s+reset/i, /econnreset/i, /econnrefused/i, /econnaborted/i,
  /ssl_error_syscall/i, /ssl\s+handshake/i, /operation\s+timed\s*out/i,
  /etimedout/i, /timeout/i, /network\s+is\s+unreachable/i,
]
const LOCAL_PROXY_PATTERNS = [
  /127\.0\.0\.1:(\d{2,5})/, /localhost:(\d{2,5})/, /proxy\s+connect\s+failed/i,
]

const EMPTY = () => ({
  version: 1,
  enabled: false,
  /** 手动录入的出口：{ id, name, url, note } */
  exits: [],
  /** 当前生效出口 id；空 = 直连 */
  active: '',
  /** 自动轮换开关 */
  autoRotate: false,
  /** 固定节点（pin 时 autoRotate 自动关闭） */
  pinned: '',
  /** 耗尽保护窗口 */
  windowMs: DEFAULT_WINDOW_MS,
  updated_at: null,
})

function cfgPathOf(root) {
  return join(root, 'config.json')
}

/** 与 platform-config 共用同一个 config.json，只读写 `proxy` 段。 */
export function loadProxyConfig(root) {
  const base = EMPTY()
  const file = cfgPathOf(root)
  if (!existsSync(file)) return Object.assign({}, base, { path: file })
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const p = raw && typeof raw.proxy === 'object' && raw.proxy ? raw.proxy : {}
    return {
      version: 1,
      enabled: !!p.enabled,
      exits: Array.isArray(p.exits)
        ? p.exits.map((x) => ({
            id: String(x && x.id ? x.id : '').trim(),
            name: String(x && x.name ? x.name : '').trim(),
            url: String(x && x.url ? x.url : '').trim(),
            note: String(x && x.note ? x.note : '').trim(),
          })).filter((x) => x.id !== '' && x.url !== '')
        : [],
      active: typeof p.active === 'string' ? p.active : '',
      autoRotate: !!p.autoRotate,
      pinned: typeof p.pinned === 'string' ? p.pinned : '',
      windowMs: Number(p.windowMs) > 0 ? Number(p.windowMs) : DEFAULT_WINDOW_MS,
      updated_at: p.updated_at || null,
      path: file,
    }
  } catch {
    return Object.assign({}, base, { path: file })
  }
}

export function saveProxyConfig(patch = {}, root) {
  const dir = root
  mkdirSync(dir, { recursive: true })
  const file = cfgPathOf(root)
  let raw = {}
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { raw = {} }
  const prev = (raw && typeof raw.proxy === 'object' && raw.proxy) ? raw.proxy : {}
  const next = Object.assign({}, EMPTY(), prev)
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled
  if (Array.isArray(patch.exits)) {
    next.exits = patch.exits
      .map((x) => ({
        id: String(x && x.id ? x.id : '').trim(),
        name: String(x && x.name ? x.name : '').trim(),
        url: String(x && x.url ? x.url : '').trim(),
        note: String(x && x.note ? x.note : '').trim(),
      }))
      .filter((x) => x.id !== '' && x.url !== '')
  }
  if (typeof patch.active === 'string') next.active = patch.active
  if (patch.autoRotate !== undefined) next.autoRotate = !!patch.autoRotate
  if (typeof patch.pinned === 'string') next.pinned = patch.pinned
  if (Number(patch.windowMs) > 0) next.windowMs = Number(patch.windowMs)
  next.updated_at = new Date().toISOString()
  raw.proxy = next
  writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8')
  return loadProxyConfig(root)
}

/* ---------------------------------------------------------------- 失败判定 */

/**
 * 三类分治的纯函数。**无副作用**，便于单测。
 *
 * @param {object} input
 * @param {string} [input.text]        命令输出 / 错误文本
 * @param {number} [input.httpCode]    curl -w %{http_code} 的裸码
 * @param {number} [input.elapsedMs]
 * @param {string[]} [input.localProxyPorts] 本地代理端口（默认 17890）
 * @returns {{kind:'ban'|'blocked'|'local-proxy-down'|'none', action:'switch'|'wait'|'warn'|'none', reason:string, matched?:string}}
 */
export function classifyFailure(input = {}) {
  const text = String(input.text || '')
  const code = Number(input.httpCode) || 0

  // 3) 本地代理自身故障优先判定：换了出口也一样，切了没意义
  for (const rx of LOCAL_PROXY_PATTERNS) {
    const m = text.match(rx)
    if (m) {
      const port = m[1] || ''
      const known = (input.localProxyPorts || ['17890']).map(String)
      if (port === '' || known.includes(port) || /\proxy\s+connect\s+failed/i.test(text)) {
        return {
          kind: 'local-proxy-down',
          action: 'warn',
          reason: '本地代理自身不可达（' + (port ? '127.0.0.1:' + port : 'proxy connect failed') + '），换出口无效，请先重启代理内核',
          matched: m[0],
        }
      }
    }
  }

  // 1) 目标封禁：立刻切
  if (code === 403 || code === 429) {
    return { kind: 'ban', action: 'switch', reason: `HTTP ${code}：目标侧封禁/限流`, matched: String(code) }
  }
  for (const rx of BAN_PATTERNS) {
    const m = text.match(rx)
    if (m) return { kind: 'ban', action: 'switch', reason: '命中封禁特征：' + m[0], matched: m[0] }
  }

  // 2) 连接被墙：需连续 2 次（计数在 BanTracker 里做）
  for (const rx of BLOCK_PATTERNS) {
    const m = text.match(rx)
    if (m) return { kind: 'blocked', action: 'wait', reason: '疑似被墙（' + m[0] + '），连续 2 次才切换', matched: m[0] }
  }

  return { kind: 'none', action: 'none', reason: '' }
}

/* ------------------------------------------------------------ 计数与耗尽保护 */

/**
 * 每个出口独立的失败计数 + 切换窗口。
 * 成功一次清零 —— 这是"避免零星失败累计误触发"的关键。
 */
export class BanTracker {
  constructor(options = {}) {
    this.windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : DEFAULT_WINDOW_MS
    this.consecutive = new Map()   // exitId -> 连续被墙次数
    this.switches = []             // 切换时间戳
    this.exhausted = false
    this.exhaustedReason = ''
  }

  /** 记录一次判定结果。返回是否应当切换。 */
  observe(result, exitId = '') {
    if (!result || result.kind === 'none') return false
    if (result.kind === 'local-proxy-down') return false
    if (result.kind === 'ban') {
      this.consecutive.set(exitId, 0)
      return true
    }
    if (result.kind === 'blocked') {
      const n = (this.consecutive.get(exitId) || 0) + 1
      this.consecutive.set(exitId, n)
      return n >= 2
    }
    return false
  }

  /** 成功响应：清零该出口的连续失败计数。 */
  markSuccess(exitId = '') {
    this.consecutive.set(exitId, 0)
  }

  /** 记录一次真实切换，并判断是否耗尽。 */
  recordSwitch(nodeCount, now = Date.now()) {
    this.switches.push(now)
    this.switches = this.switches.filter((t) => now - t <= this.windowMs)
    const cap = Math.max(1, Number(nodeCount) || 1)
    if (this.switches.length >= cap) {
      this.exhausted = true
      this.exhaustedReason =
        `窗口 ${Math.round(this.windowMs / 60000)} 分钟内已切换 ${this.switches.length} 次 ≥ 节点数 ${cap}，`
        + '判定节点池可能已全部被封：建议换国家/地区或换服务商，自动轮换已关闭'
      return { exhausted: true, reason: this.exhaustedReason }
    }
    return { exhausted: false, reason: '' }
  }

  /** 手动解除耗尽（换了一批节点后调用）。 */
  reset() {
    this.switches = []
    this.exhausted = false
    this.exhaustedReason = ''
    this.consecutive.clear()
  }

  snapshot() {
    return {
      consecutive: Object.fromEntries(this.consecutive),
      switchesInWindow: this.switches.length,
      exhausted: this.exhausted,
      exhaustedReason: this.exhaustedReason,
    }
  }
}

/* ---------------------------------------------------------------- 出口状态 */

/** 当前生效出口对象；active 为空或找不到 → 直连。 */
export function activeExit(cfg) {
  if (!cfg || !cfg.active) return null
  return cfg.exits.find((x) => x.id === cfg.active) || null
}

/**
 * 生成给子进程用的代理环境变量。**只返回，不写 process.env** ——
 * 由调用方决定作用域，避免污染宿主进程。
 */
export function proxyEnvOf(cfg) {
  const exit = activeExit(cfg)
  if (!cfg || !cfg.enabled || !exit) {
    return { HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost' }
  }
  return {
    HTTP_PROXY: exit.url,
    HTTPS_PROXY: exit.url,
    ALL_PROXY: exit.url,
    NO_PROXY: '127.0.0.1,localhost',
  }
}

/**
 * 汇总状态，供面板与工具使用。**不做网络探测**（探测放异步侧），
 * 只回本地事实：当前出口、节点数、窗口内切换次数、是否耗尽。
 */
export function proxyStatus(cfg, tracker) {
  const exit = activeExit(cfg)
  return {
    ok: true,
    enabled: !!cfg.enabled,
    mode: cfg.enabled ? (exit ? 'exit' : 'direct') : 'off',
    active: cfg.active || '',
    activeName: exit ? exit.name : '',
    activeUrl: exit ? exit.url : '',
    exits: cfg.exits.map((x) => ({
      id: x.id,
      name: x.name,
      url: x.url,
      note: x.note,
      current: x.id === cfg.active,
    })),
    nodeCount: cfg.exits.length,
    autoRotate: !!cfg.autoRotate,
    pinned: cfg.pinned || '',
    guard: tracker ? tracker.snapshot() : null,
  }
}

/** 切换出口；未命中返回错误而不是静默直连。 */
export function switchExit(cfg, exitId, root) {
  if (exitId === '' || exitId === 'direct') {
    return saveProxyConfig({ active: '', enabled: cfg.enabled }, root)
  }
  const hit = cfg.exits.find((x) => x.id === exitId)
  if (!hit) return { error: '出口不存在：' + exitId, candidates: cfg.exits.map((x) => x.id) }
  return saveProxyConfig({ active: hit.id, enabled: true }, root)
}

/** 开启自动轮换会顺带解除 pin（否则"固定"名不副实）。 */
export function setAutoRotate(cfg, on, root) {
  const patch = { autoRotate: !!on }
  if (on) patch.pinned = ''
  return saveProxyConfig(patch, root)
}

/** 固定节点会连带关闭自动轮换；unpin 时恢复自动轮换。 */
export function pinExit(cfg, exitId, root) {
  const hit = cfg.exits.find((x) => x.id === exitId)
  if (!hit) return { error: '出口不存在：' + exitId, candidates: cfg.exits.map((x) => x.id) }
  return saveProxyConfig({ active: hit.id, enabled: true, pinned: hit.id, autoRotate: false }, root)
}

export function unpinExit(cfg, root) {
  return saveProxyConfig({ pinned: '', autoRotate: true }, root)
}

export default {
  loadProxyConfig,
  saveProxyConfig,
  classifyFailure,
  BanTracker,
  activeExit,
  proxyEnvOf,
  proxyStatus,
  switchExit,
  setAutoRotate,
  pinExit,
  unpinExit,
}
