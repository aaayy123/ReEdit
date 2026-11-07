/**
 * 系统资源采样（2.0 新增）
 *
 * 设计来源：ARTEX 仪表盘的"环形走势"思路 —— 单看瞬时百分比分不清
 * "一直这么高"和"正在爬升"，所以留一段历史窗口看斜率。
 *
 * 只依赖 node:os / node:fs，不引入任何外部包，也不 spawn 命令。
 * 采样本身是纯读取，不会影响宿主性能。
 */
import os from 'node:os'
import { statfsSync } from 'node:fs'

/** 默认留 12 个点；配合 5 秒采样 = 60 秒窗口。 */
const DEFAULT_POINTS = 12
const DEFAULT_INTERVAL_MS = 5000

function cpuTimesSnapshot() {
  const cpus = os.cpus() || []
  let idle = 0
  let total = 0
  for (const c of cpus) {
    const t = c.times || {}
    idle += t.idle || 0
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0)
  }
  return { idle, total }
}

function diskUsage() {
  /* Node 18.15+ 才有 statfsSync；拿不到就返回 null，不影响其它指标。 */
  try {
    const s = statfsSync(os.homedir())
    const total = Number(s.blocks) * Number(s.bsize)
    const free = Number(s.bfree) * Number(s.bsize)
    if (!Number.isFinite(total) || total <= 0) return null
    return { total, free, used: total - free, usedPct: Math.round(((total - free) / total) * 1000) / 10 }
  } catch {
    return null
  }
}

/**
 * 采样器：进程内单例即可，但做成类便于测试注入时钟。
 */
export class SysSampler {
  constructor(options = {}) {
    this.points = Math.max(3, Number(options.points) || DEFAULT_POINTS)
    this.intervalMs = Math.max(1000, Number(options.intervalMs) || DEFAULT_INTERVAL_MS)
    this.series = []
    this.lastCpu = cpuTimesSnapshot()
    this.lastAt = Date.now()
    this.timer = null
  }

  /** 采一次并推入环形窗口。 */
  sample(now = Date.now()) {
    const cur = cpuTimesSnapshot()
    const dIdle = cur.idle - this.lastCpu.idle
    const dTotal = cur.total - this.lastCpu.total
    /* 两次采样间隔太短会算出离谱的百分比，用 dTotal>0 兜住 */
    const cpuPct = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 1000) / 10 : 0
    this.lastCpu = cur
    this.lastAt = now

    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const point = {
      at: new Date(now).toISOString(),
      cpuPct: Math.min(100, Math.max(0, cpuPct)),
      memPct: Math.round((1 - freeMem / totalMem) * 1000) / 10,
      memUsed: totalMem - freeMem,
      memTotal: totalMem,
      disk: diskUsage(),
    }
    this.series.push(point)
    if (this.series.length > this.points) this.series.splice(0, this.series.length - this.points)
    return point
  }

  /** 后台定期采样；宿主卸载时要 stop()，否则定时器泄漏。 */
  start() {
    if (this.timer) return this
    this.sample()
    this.timer = setInterval(() => {
      try { this.sample() } catch { /* 采样失败不能拖垮进程 */ }
    }, this.intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    return this
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    return this
  }

  /**
   * 快照：当前值 + 走势（首末差）+ 负载。
   * `trend` 只给 delta 不给结论 —— 阈值判断交给调用方/面板。
   */
  snapshot() {
    const last = this.series[this.series.length - 1] || this.sample()
    const first = this.series[0] || last
    const delta = (k) => Math.round((last[k] - first[k]) * 10) / 10
    return {
      ok: true,
      at: last.at,
      cpu: { pct: last.cpuPct, trend: delta('cpuPct'), cores: (os.cpus() || []).length },
      mem: {
        pct: last.memPct, trend: delta('memPct'),
        used: last.memUsed, total: last.memTotal,
        usedHuman: humanBytes(last.memUsed), totalHuman: humanBytes(last.memTotal),
      },
      disk: last.disk ? {
        pct: last.disk.usedPct,
        used: last.disk.used, total: last.disk.total,
        usedHuman: humanBytes(last.disk.used), totalHuman: humanBytes(last.disk.total),
      } : null,
      load: os.loadavg ? os.loadavg().map((x) => Math.round(x * 100) / 100) : null,
      uptimeSec: Math.round(os.uptime()),
      series: this.series.map((p) => ({ at: p.at, cpu: p.cpuPct, mem: p.memPct })),
      /* 堆用量能一眼看出"进程在膨胀" */
      heapMB: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
    }
  }
}

export function humanBytes(n) {
  const v = Number(n) || 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let x = v
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i += 1 }
  return `${Math.round(x * 10) / 10}${units[i]}`
}

/** 进程级单例，避免面板多次请求各建一个定时器。 */
let singleton = null
export function sysSampler(options) {
  if (!singleton) singleton = new SysSampler(options).start()
  return singleton
}

export default { SysSampler, sysSampler, humanBytes }
