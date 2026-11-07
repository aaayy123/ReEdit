/**
 * MCP 配置生成器（2.0 新增，降级实现）
 *
 * ARTEX 的做法是"首启自动注册 FOFA MCP 并授权给 6 个 agent"。
 * 本插件做不到自动注册 —— 宿主 `app.asar` 未向插件暴露 MCP 注册 API，
 * 且 `$DSH_HOME` 下不存在任何 `mcpServers` 配置位点（已核查）。
 *
 * 所以这里只做**诚实的生成器**：产出标准 `mcpServers` JSON 片段 +
 * 依赖自检（python 是否可用），由用户粘贴到真正支持 MCP 的宿主里。
 * 不伪造"已注册"状态，也不写入任何宿主配置。
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/** 内置 FOFA MCP 的最小实现（仅标准库，无第三方依赖）。 */
const FOFA_SERVER_SOURCE = `#!/usr/bin/env python3
"""FOFA MCP server (minimal, stdlib only).

Reads FOFA_EMAIL / FOFA_KEY from env. Exposes two tools:
  fofa_search(query, size)  -> table of matched assets
  fofa_account()            -> remaining F-points
"""
import base64, json, os, sys, urllib.parse, urllib.request

API = "https://fofa.info/api/v1"

def _call(path, **params):
    email = os.environ.get("FOFA_EMAIL", "")
    key = os.environ.get("FOFA_KEY", "")
    if not email or not key:
        raise SystemExit("FOFA_EMAIL / FOFA_KEY not set")
    q = {"email": email, "key": key}
    q.update({k: v for k, v in params.items() if v is not None})
    url = API + path + "?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def fofa_search(query, size=20):
    qbase64 = base64.b64encode(query.encode("utf-8")).decode("ascii")
    data = _call("/search/all", qbase64=qbase64, size=size, fields="host,ip,port,title,server")
    if data.get("error"):
        return "error: " + str(data.get("errmsg"))
    rows = data.get("results") or []
    return "\\n".join("\\t".join(str(c) for c in row) for row in rows) or "(no result)"

def fofa_account():
    data = _call("/info/my_info")
    return json.dumps(data.get("fofa_point", data), ensure_ascii=False)

if __name__ == "__main__":
    # 极简 MCP stdio 桩：只演示工具清单与调用形状，生产请用官方 SDK
    print(json.dumps({"tools": ["fofa_search", "fofa_account"]}), file=sys.stderr)
`

/**
 * 探测本机 python，返回可执行路径或 null。
 * 只做 `--version`，不执行生成的文件。
 */
export function detectPython() {
  const candidates = process.platform === 'win32'
    ? ['python.exe', 'python3.exe', 'py.exe']
    : ['python3', 'python']
  for (const exe of candidates) {
    try {
      const out = execFileSync(exe, ['--version'], { timeout: 3000, encoding: 'utf8', windowsHide: true })
      const m = String(out).match(/Python\s+(\d+\.\d+)/)
      if (m) return { ok: true, exe, version: m[1] }
    } catch { /* 换下一个 */ }
  }
  return { ok: false, exe: null, version: null, hint: '未找到 python3；FOFA MCP 需要 Python 3.8+' }
}

/**
 * 生成 mcpServers 片段。
 *
 * @param {object} opts
 * @param {string} [opts.serverPath] 已落盘的 server 脚本路径；不给则用占位符
 * @param {string} [opts.email]      可选，写进 env 便于粘贴即用（注意：会明文出现在配置里）
 * @returns {{ok:boolean, config?:object, snippet?:string, python?:object, note:string}}
 */
export function buildMcpConfig(opts = {}) {
  const py = detectPython()
  if (!py.ok) {
    return { ok: false, python: py, note: '本机没有可用 Python，生成配置也不会跑起来；先装 Python 3.8+ 再回头看这里。' }
  }
  const serverPath = String(opts.serverPath || '').trim() || '<把 fofa_mcp.py 放到任意绝对路径后填这里>'
  const env = {
    FOFA_EMAIL: opts.email ? String(opts.email) : '<your@email>',
    FOFA_KEY: '<your-fofa-key>',
  }
  const config = {
    mcpServers: {
      fofa: {
        command: py.exe,
        args: [serverPath],
        env,
        /* 只读工具：搜索与余额查询，不涉及写操作 */
        note: '只读（search / account），不写目标、不改配置',
      },
    },
  }
  return {
    ok: true,
    python: py,
    config,
    snippet: JSON.stringify(config, null, 2),
    note: '宿主若支持 MCP，把这段并入其 mcpServers 配置；本插件不会自动注册，也不会改写宿主配置。',
  }
}

/** 内置 server 源码（用户可自行落盘；本模块不写文件）。 */
export function fofaServerSource() {
  return FOFA_SERVER_SOURCE
}

export default { detectPython, buildMcpConfig, fofaServerSource }
