/**
 * fsviewer - Host 半边（Node，Cordis 插件入口）
 *
 * 通过 dsh-host-webserver 的官方路由注册服务（ctx.webServer.register）挂载
 * `/fsviewer-api` 前缀路由，为浏览器半边提供四类能力：
 *   - GET /fsviewer-api/list?path=<绝对路径>   列目录（目录 + 文件，含类型/隐藏标记）
 *   - GET /fsviewer-api/file?path=<绝对路径>   读文本文件（1MB 上限，严格 UTF-8 检测二进制）
 *   - POST /fsviewer-api/chat                  侧边聊天：直连 ctx.llm 流式调用（SSE 下发），
 *                                              模型缺省取 ctx.agentDefaultModel 默认设置
 *   - GET /fsviewer-api/models                聊天模型目录（providers + 默认模型）
 *   - GET /fsviewer-api/f/<绝对路径>          静态文件服务：浏览器视图渲染本地 html 及其资源
 *   - GET /fsviewer-api/p/<目标URL>            浏览器视图同源代理：绕过 X-Frame-Options，
 *                                              注入 <base> + 尽力改写链接，让页面经代理回源
 *
 * 浏览器半边（lib/client.js）同源 fetch 这些端点。
 *
 * 信任级别说明：与官方 browse 目录选择后端一致——本机个人工具、无鉴权，
 * 可列出/读取本机任意绝对路径（browse 后端同样如此，openPath 亦然）。
 * 代理会把本机变成任意 URL 的中转，请勿在多用户暴露环境下使用。
 */

import { open, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve as resolvePath, sep } from 'node:path'
import { BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'fsviewer'

// cordis 按 inject 白名单门控 ctx 属性访问：llm / agentDefaultModel 必须显式声明
// 才能在请求处理器里读取（声明即依赖，宿主启动时按序装配这两个服务）。
export const inject = ['webServer', 'llm', 'agentDefaultModel']

const MAX_LIST_ENTRIES = 1000
const MAX_READ_BYTES = 1024 * 1024

// ---------- 侧边聊天 ----------
const MAX_CHAT_BODY_BYTES = 2 * 1024 * 1024
const MAX_CHAT_MESSAGES = 80
const MAX_CHAT_MESSAGE_CHARS = 100_000
const CHAT_MAX_TOKENS = 8192
const CHAT_SYSTEM_PROMPT =
  '你是 dsh 工作区的侧边聊天助手。回答简洁、直接、正确；' +
  '用户消息里可能附带你正在查看的工作区文件内容，请结合该上下文回答。' +
  '始终使用与用户相同的语言。'

// ---------- 同源代理 ----------
const PROXY_PREFIX = '/fsviewer-api/p/'
const MAX_PROXY_BYTES = 8 * 1024 * 1024

// ---------- 静态文件服务（内置浏览器渲染本地 html 及其资源） ----------
// 路径结构化：/fsviewer-api/f/<绝对路径>，页面内相对引用（./style.css）会自然解析回
// 同前缀路由，本地 css/js/图片随之加载。跨平台：POSIX 补前导 '/'，Windows 盘符路径
// （C:/...，反斜杠统一转 '/'）。信任级别同 list/file 路由：本机个人工具、无鉴权。
const RAW_PREFIX = '/fsviewer-api/f/'
const MAX_RAW_BYTES = 30 * 1024 * 1024
const RAW_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}
function mimeFor(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (RAW_MIME[name.slice(dot).toLowerCase()] || 'application/octet-stream') : 'application/octet-stream'
}
async function handleRawFile(url, res) {
  let target = url.pathname.startsWith(RAW_PREFIX) ? url.pathname.slice(RAW_PREFIX.length) : ''
  try { target = decodeURIComponent(target) } catch { /* 保留原样 */ }
  target = target.replace(/\\/g, '/')
  // POSIX 补前导 '/'；Windows 盘符路径（C:/...）isAbsolute 已认可
  if (!isAbsolute(target)) target = '/' + target
  target = resolvePath(target)
  const info = await stat(target).catch((e) => {
    throw httpError(e.code === 'ENOENT' ? 404 : 500, `无法读取文件 ${target}: ${e.message}`)
  })
  if (info.isDirectory()) throw httpError(400, `${target} 是目录`)
  if (info.size > MAX_RAW_BYTES) throw httpError(413, `文件超过 ${Math.floor(MAX_RAW_BYTES / 1024 / 1024)}MB 上限`)
  const buf = await readFile(target).catch((e) => {
    throw httpError(500, `无法读取 ${target}: ${e.message}`)
  })
  res.writeHead(200, {
    'content-type': mimeFor(target),
    'cache-control': 'no-store',
    'content-length': buf.length
  })
  res.end(buf)
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function httpError(status, message) {
  const e = new Error(message)
  e.httpStatus = status
  return e
}

/**
 * 绝对路径 -> 面包屑（[{name,path},...]）。
 * 跨平台：POSIX 路径首节点为 '/'；Windows 路径首节点为盘符根（如 'C:\\'）。
 * 路径片段同时按 '/' 与 '\\' 切分，避免混用分隔符时面包屑塌陷成单节点。
 */
function crumbsFor(absPath) {
  const segs = absPath.split(/[/\\]+/).filter(Boolean)
  const winDrive = /^[A-Za-z]:$/.test(segs[0])
  const rootName = winDrive ? segs[0] + sep : '/'
  const rootPath = winDrive ? segs[0] + sep : sep
  const crumbs = [{ name: rootName, path: rootPath }]
  let acc = rootPath
  const start = winDrive ? 1 : 0
  for (const seg of segs.slice(start)) {
    acc = join(acc, seg)
    crumbs.push({ name: seg, path: acc })
  }
  return crumbs
}

/** git 式二进制嗅探：前 8KB 出现 NUL 即视为二进制 */
function looksBinary(buf) {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

function decodeStrict(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

async function requireAbsPath(url) {
  const raw = url.searchParams.get('path')
  // isAbsolute 跨平台：POSIX 接受 '/foo'，Windows 同时接受 'C:\\foo' 与 'C:/foo'
  if (!raw || !isAbsolute(raw)) throw httpError(400, 'path 必须是绝对路径')
  return resolvePath(raw)
}

async function handleList(url, res) {
  const target = await requireAbsPath(url)
  const info = await stat(target).catch((e) => {
    throw httpError(e.code === 'ENOENT' ? 404 : 500, `无法读取目录 ${target}: ${e.message}`)
  })
  if (!info.isDirectory()) throw httpError(400, `${target} 不是目录`)

  const dirents = await readdir(target, { withFileTypes: true }).catch((e) => {
    throw httpError(500, `无法列出 ${target}: ${e.message}`)
  })

  const rows = []
  for (const d of dirents) {
    let type = d.isDirectory() ? 'directory' : d.isFile() ? 'file' : null
    if (type === null && d.isSymbolicLink()) {
      // 符号链接跟随一次：指向目录按目录、指向文件按文件、悬空链接跳过
      try {
        type = (await stat(join(target, d.name))).isDirectory() ? 'directory' : 'file'
      } catch {
        continue
      }
    }
    if (type === null) continue // 套接字/FIFO 等跳过
    rows.push({ name: d.name, path: join(target, d.name), type, hidden: d.name.startsWith('.') })
  }
  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  const truncated = rows.length > MAX_LIST_ENTRIES
  json(res, 200, {
    path: target,
    crumbs: crumbsFor(target),
    entries: rows.slice(0, MAX_LIST_ENTRIES),
    truncated
  })
}

async function handleFile(url, res) {
  const target = await requireAbsPath(url)
  const info = await stat(target).catch((e) => {
    throw httpError(e.code === 'ENOENT' ? 404 : 500, `无法读取文件 ${target}: ${e.message}`)
  })
  if (info.isDirectory()) throw httpError(400, `${target} 是目录，请选择文件`)

  if (info.size <= MAX_READ_BYTES) {
    const buf = await readFile(target).catch((e) => {
      throw httpError(500, `无法读取 ${target}: ${e.message}`)
    })
    if (looksBinary(buf)) return json(res, 200, { path: target, size: info.size, binary: true, truncated: false, content: null })
    return json(res, 200, { path: target, size: info.size, binary: false, truncated: false, content: decodeStrict(buf) ?? '' })
  }

  // 超大文件：只读前 1MB。头部按非严格解码（截断处可能断在多字节字符中间）
  const handle = await open(target, 'r').catch((e) => {
    throw httpError(500, `无法读取 ${target}: ${e.message}`)
  })
  try {
    const buf = Buffer.alloc(MAX_READ_BYTES)
    const { bytesRead } = await handle.read(buf, 0, MAX_READ_BYTES, 0)
    const head = buf.subarray(0, bytesRead)
    const binary = looksBinary(head)
    const content = binary ? null : new TextDecoder('utf-8').decode(head)
    return json(res, 200, { path: target, size: info.size, binary, truncated: true, content })
  } finally {
    await handle.close()
  }
}

// ---------- 请求体读取（async iterable，带大小上限） ----------
async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const c of req) {
    total += c.length
    if (total > limit) throw httpError(413, `请求体超过上限（${Math.floor(limit / 1024)}KB）`)
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * POST /fsviewer-api/chat —— 侧边聊天流式端点。
 *
 * 请求：{ messages:[{role:'user'|'assistant', content:string}, ...], system?, provider?, model?, maxTokens? }
 * 响应：SSE，每帧 `data: {json}\n\n`：
 *   { meta:{provider,model} }  起始帧，回显实际使用的模型路由
 *   { delta:{text|reasoning} } 增量文本 / 思考内容
 *   { done:{finish, usage?} }  正常结束（finish: stop|max-tokens|tool-calls）
 *   { error }                  失败（含模型侧 error/aborted 终态）
 *
 * 模型路由：显式 provider/model > ctx.agentDefaultModel 当前默认设置。
 * 体验为轻量多轮对话（不走 agent 会话/工具），复用 dsh 已配置的 provider 与密钥。
 */
async function handleChat(ctx, req, res) {
  const llm = ctx.llm
  if (!llm || typeof llm.stream !== 'function') {
    return json(res, 503, { error: 'llm 服务不可用（宿主未提供 ctx.llm）' })
  }
  const body = JSON.parse(await readBody(req, MAX_CHAT_BODY_BYTES))
  const incoming = Array.isArray(body && body.messages) ? body.messages : []

  // 路由解析：显式指定优先，缺省回落到默认模型设置
  let provider = typeof body.provider === 'string' && body.provider ? body.provider : null
  let model = typeof body.model === 'string' && body.model ? body.model : null
  if (!provider || !model) {
    const defaults = ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function'
      ? ctx.agentDefaultModel.currentSelection()
      : null
    if ((!defaults || !defaults.provider || !defaults.model) && (!provider || !model)) {
      throw httpError(400, '未配置模型：请先在 dsh 设置中选择默认模型')
    }
    provider = provider || (defaults && defaults.provider)
    model = model || (defaults && defaults.model)
  }

  const system = typeof body.system === 'string' && body.system.trim() ? body.system : CHAT_SYSTEM_PROMPT
  const maxTokens = Number.isInteger(body.maxTokens) && body.maxTokens > 0 && body.maxTokens <= 32768
    ? body.maxTokens
    : CHAT_MAX_TOKENS

  // 平铺的多轮历史 -> dsh 消息（assistant 历史以当前路由标记 provenance，无 replay）
  const convo = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length)
    .slice(-MAX_CHAT_MESSAGES)
    .map((m) => {
      const content = [{ type: 'text', text: m.content.slice(0, MAX_CHAT_MESSAGE_CHARS) }]
      return m.role === 'user'
        ? createUserMessage({ content, source: { kind: 'plugin', plugin: 'fsviewer' } })
        : createAssistantMessage({ content, source: { kind: 'model', provider, model } })
    })
  if (!convo.length) throw httpError(400, 'messages 为空或格式不合法（需要 role:user/assistant + content 字符串）')

  const controller = new AbortController()
  let closed = false
  req.on('close', () => { closed = true; controller.abort() })

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  const send = (obj) => { if (!closed) res.write('data: ' + JSON.stringify(obj) + '\n\n') }

  send({ meta: { provider, model } })
  let usage = null
  let finished = false
  try {
    for await (const chunk of llm.stream({
      provider, model, messages: convo, system, maxTokens, signal: controller.signal
    })) {
      if (closed) break
      if (chunk.type === 'text-delta') send({ delta: { text: chunk.text } })
      else if (chunk.type === 'reasoning-delta') send({ delta: { reasoning: chunk.text } })
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish') {
        finished = true
        const kind = chunk.reason && chunk.reason.kind
        if (kind === 'error' || kind === 'aborted') {
          const detail = chunk.reason && chunk.reason.failure && chunk.reason.failure.message
          send({ error: detail || ('模型流式调用失败（' + kind + '）') })
        } else {
          send({ done: { finish: kind || 'stop', usage } })
        }
      }
    }
    if (!finished && !closed) send({ done: { finish: 'stop', usage } })
  } catch (e) {
    send({ error: e && e.message ? e.message : String(e) })
  } finally {
    if (!closed) { try { res.end() } catch { /* 客户端已断开 */ } }
  }
}

/**
 * GET /fsviewer-api/models —— 侧边聊天模型选择器的目录。
 * 返回 { providers:[{id,name,models:[{id,name}]}], default:{provider,model}|null }，
 * 目录来自 ctx.llm.listProviders()/listModels()，默认取 ctx.agentDefaultModel。
 */
async function handleModels(ctx, res) {
  const llm = ctx.llm
  if (!llm || typeof llm.listProviders !== 'function') {
    return json(res, 503, { error: 'llm 服务不可用（宿主未提供 ctx.llm）' })
  }
  const providers = []
  for (const p of llm.listProviders()) {
    let models = []
    try {
      models = (await llm.listModels(p.id)).map((m) => ({ id: m.id, name: m.name || m.id }))
    } catch (e) {
      models = []   // 单个 provider 目录失败不阻断整体
    }
    providers.push({ id: p.id, name: p.name || p.id, models })
  }
  let defaults = null
  try {
    const sel = ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function'
      ? ctx.agentDefaultModel.currentSelection()
      : null
    if (sel && sel.provider && sel.model) defaults = { provider: sel.provider, model: sel.model }
  } catch { /* 无默认设置则置空 */ }
  return json(res, 200, { providers, default: defaults })
}

// ---------- 同源代理（浏览器视图） ----------
/** 相对/绝对 URL -> 经代理回源的路径；data:/#:/javascript: 等原样返回 null 不改写 */
function proxiedAttr(rawAttr, docUrl) {
  const v = rawAttr.trim()
  if (!v || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(v)) return null
  let abs
  try { abs = new URL(v, docUrl).href } catch { return null }
  if (!/^https?:/i.test(abs)) return null
  return PROXY_PREFIX + abs
}
function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
/** 尽力改写：去 CSP meta / 旧 base，重写 href/src/action/poster/srcset 与 CSS url()，注入 <base> */
function rewriteHtml(html, docUrl) {
  let out = html
    .replace(/<meta[^>]+http-equiv=["']?(content-security-policy|refresh)["']?[^>]*>/gi, '')
    .replace(/<base[^>]*>/gi, '')
  out = out.replace(/\s(href|src|action|poster)=(?:"([^"]*)"|'([^']*)')/gi, (m, attr, dq, sq) => {
    const v = dq !== undefined ? dq : sq
    const p = proxiedAttr(v, docUrl)
    return p ? ' ' + attr + '="' + escAttr(p) + '"' : m
  })
  out = out.replace(/\ssrcset=(?:"([^"]*)"|'([^']*)')/gi, (m, dq, sq) => {
    const v = dq !== undefined ? dq : sq
    const parts = v.split(',').map((cand) => {
      const t = cand.trim().split(/\s+/)
      const p = t[0] ? proxiedAttr(t[0], docUrl) : null
      return p ? [p].concat(t.slice(1)).join(' ') : cand.trim()
    })
    return ' srcset="' + escAttr(parts.join(', ')) + '"'
  })
  out = out.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
    const p = proxiedAttr(u, docUrl)
    return p ? 'url(' + q + p + q + ')' : m
  })
  const base = '<base href="' + escAttr(PROXY_PREFIX + docUrl) + '">'
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + base)
  else out = base + out
  return out
}

/** 代理内的错误也以 HTML 呈现（显示在 iframe 里而非静默白屏） */
function proxyErrorPage(res, status, message) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><meta charset="utf-8"><body style="font:13px/1.6 system-ui;padding:24px;' +
    'background:#1e1e1e;color:#ccc">' +
    '<b style="color:#e06c75">代理加载失败（' + status + '）</b><br>' +
    String(message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) +
    '<br><br>可尝试切换「直连」模式，或用 ⧉ 在新窗口打开。</body>')
}

async function handleProxy(url, req, res) {
  // pathname 保留原始编码后的目标 URL（可能含中文/空格），search 原样拼接
  const targetRaw = url.pathname.startsWith(PROXY_PREFIX) ? url.pathname.slice(PROXY_PREFIX.length) : ''
  const target = targetRaw + url.search
  if (!/^https?:\/\//i.test(target)) return proxyErrorPage(res, 400, '仅支持 http/https 目标：' + target)

  let resp
  try {
    resp = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    })
  } catch (e) {
    return proxyErrorPage(res, 502, '无法访问目标：' + (e && e.message ? e.message : e))
  }
  if (!resp.ok && !resp.body) return proxyErrorPage(res, 502, '目标返回 HTTP ' + resp.status)

  const ctype = resp.headers.get('content-type') || 'application/octet-stream'
  const buf = Buffer.from(await resp.arrayBuffer())
  if (buf.length > MAX_PROXY_BYTES) return proxyErrorPage(res, 413, '响应超过 8MB 上限')

  if (/text\/html/i.test(ctype)) {
    // 仅确定/默认 UTF-8 时改写；其他编码原样吐出（保证不乱码，只是链接不经代理）
    const isUtf8 = !/charset=/i.test(ctype) || /utf-?8/i.test(ctype)
    let html = buf.toString('utf8')
    if (isUtf8) html = rewriteHtml(html, resp.url || target)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return void res.end(html)
  }
  res.writeHead(200, { 'content-type': ctype, 'cache-control': 'no-store' })
  return void res.end(buf)
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/fsviewer-api',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname
        if (req.method === 'GET' || req.method === 'HEAD') {
          if (path === '/fsviewer-api/list') return await handleList(url, res)
          if (path === '/fsviewer-api/file') return await handleFile(url, res)
          if (path === '/fsviewer-api/models') return await handleModels(ctx, res)
          if (path.startsWith(RAW_PREFIX)) return await handleRawFile(url, res)
          if (path.startsWith(PROXY_PREFIX)) return await handleProxy(url, req, res)
        } else if (req.method === 'POST' && path === '/fsviewer-api/chat') {
          return await handleChat(ctx, req, res)
        }
        return json(res, 405, { error: '不支持的请求：可用 GET /fsviewer-api/list、/file、/models、/f/<路径>、/p/<URL> 与 POST /fsviewer-api/chat' })
      } catch (e) {
        return json(res, e && e.httpStatus ? e.httpStatus : 500, { error: e && e.message ? e.message : String(e) })
      }
    }
  }), 'fsviewer: /fsviewer-api routes')
  console.log('[fsviewer] Host routes ready: GET /fsviewer-api/{list,file,models,f/*,p/*}, POST /fsviewer-api/chat')
}
