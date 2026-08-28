/**
 * fsviewer - Host 半边（Node，Cordis 插件入口）
 *
 * 通过 dsh-host-webserver 的官方路由注册服务（ctx.webServer.register）挂载
 * `/fsviewer-api` 前缀路由，为浏览器半边提供两类能力：
 *   - GET /fsviewer-api/list?path=<绝对路径>   列目录（目录 + 文件，含类型/隐藏标记）
 *   - GET /fsviewer-api/file?path=<绝对路径>   读文本文件（1MB 上限，严格 UTF-8 检测二进制）
 *
 * 浏览器半边（lib/client.js）同源 fetch 这些端点。
 *
 * 信任级别说明：与官方 browse 目录选择后端一致——本机个人工具、无鉴权，
 * 可列出/读取本机任意绝对路径（browse 后端同样如此，openPath 亦然）。
 * 请勿在多用户暴露环境下使用。
 */

import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'

export const name = 'fsviewer'

export const inject = ['webServer']

const MAX_LIST_ENTRIES = 1000
const MAX_READ_BYTES = 1024 * 1024

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function httpError(status, message) {
  const e = new Error(message)
  e.httpStatus = status
  return e
}

/** 绝对路径 -> 面包屑（[{name:'/',path:'/'},{name:'a',path:'/a'},...]） */
function crumbsFor(absPath) {
  const crumbs = [{ name: '/', path: '/' }]
  let acc = ''
  for (const seg of absPath.split('/').filter(Boolean)) {
    acc += '/' + seg
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
  if (!raw || !raw.startsWith('/')) throw httpError(400, 'path 必须是绝对路径')
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

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/fsviewer-api',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return json(res, 405, { error: '仅支持 GET' })
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === '/fsviewer-api/list') return await handleList(url, res)
        if (url.pathname === '/fsviewer-api/file') return await handleFile(url, res)
        return json(res, 404, { error: '未知端点，可用：/fsviewer-api/list、/fsviewer-api/file' })
      } catch (e) {
        return json(res, e && e.httpStatus ? e.httpStatus : 500, { error: e && e.message ? e.message : String(e) })
      }
    }
  }), 'fsviewer: /fsviewer-api routes')
  console.log('[fsviewer] Host routes ready: GET /fsviewer-api/list, /fsviewer-api/file')
}
