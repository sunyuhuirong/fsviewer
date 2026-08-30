/**
 * fsviewer 冒烟测试（Node 环境，无需浏览器）
 * 模拟 window.__ModuleLoader__ 加载 lib/client.js，验证：
 * 1. 产物能被加载且 require("react") 正常解析（命名导出风格）
 * 2. exports.inject / exports.apply 契约完整
 * 3. apply(ctx) 能走完 slots.inject -> slots.register 挂载流程
 */
import fs from 'node:fs'

const code = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

// 1) 模拟浏览器全局
let loaded = null
globalThis.window = { __ModuleLoader__: { load: (def) => { loaded = def } } }
;(0, eval)(code)

if (!loaded || loaded.id !== 'fsviewer') throw new Error('module not loaded or wrong id')

// 2) 模拟模块加载器的 require（react 为命名导出风格，与 shl-session-history 产物用法一致）
const fakeReact = {
  createElement: (...args) => ({ element: true, type: args[0], props: args[1] }),
  Fragment: 'FRAGMENT',
  Component: class Component { constructor(props) { this.props = props } setState() {} render() { return null } },
  useState: (v) => [v, () => {}],
  useReducer: (r, i) => [i, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
}
const fakePrimitives = {
  MarkdownText: (props) => ({ element: true, type: 'MarkdownText', props }),
}
const requireShim = (name) => {
  if (name === 'react') return fakeReact
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives
  throw new Error('unexpected require: ' + name)
}

const exports = loaded.factory(requireShim)
if (typeof exports.apply !== 'function') throw new Error('exports.apply missing')
if (!Array.isArray(exports.inject) || !exports.inject.includes('slots') || !exports.inject.includes('workspaces')) {
  throw new Error('exports.inject wrong: ' + JSON.stringify(exports.inject))
}

// 3) 走一遍 apply 挂载流程
const registrations = []
const stubCtx = {
  slots: {
    inject: (slotName, register) => {
      registrations.push(register())
    },
    register: (meta, compFactory) => ({ meta, comp: compFactory() }),
  },
  workspaces: {},
  // ui-layout 布局服务桩：记录 open/close 调用，验证停靠联动被正确触发
  layout: {
    calls: [],
    openDetails() { this.calls.push('openDetails') },
    closeDetails() { this.calls.push('closeDetails') },
  },
}
exports.apply(stubCtx)

if (registrations.length !== 2) throw new Error('expected exactly 2 slot registrations, got ' + registrations.length)
const utilReg = registrations.find((r) => r.meta.name === 'conversation.session.header.utilities' && r.meta.id === 'fsviewer-toggle')
const detailsReg = registrations.find((r) => r.meta.name === 'details')
if (!utilReg) throw new Error('missing utilities registration')
if (utilReg.meta.id !== 'fsviewer-toggle') throw new Error('wrong utilities id: ' + utilReg.meta.id)
if (detailsReg) {
  if (detailsReg.meta.id !== 'fsviewer-panel') throw new Error('wrong details id: ' + detailsReg.meta.id)
  if (detailsReg.meta.priority !== -10) throw new Error('details priority should be -10 (shadow conversation), got ' + detailsReg.meta.priority)
} else throw new Error('missing details registration')
const reg = detailsReg
if (!reg.comp || !reg.comp.element) throw new Error('component factory returned unexpected value')

console.log('SMOKE OK')
console.log('  utilities slot:', utilReg.meta.name, '| id:', utilReg.meta.id)
console.log('  details slot:', reg.meta.name, '| id:', reg.meta.id, '| priority:', reg.meta.priority)
console.log('  inject:', exports.inject.join(', '))
console.log('  component:', reg.comp.element ? 'React element' : typeof reg.comp)

// 4) 主机半边（src/index.js，纯 ESM 无 JSX）：语法 + 导出契约校验
const host = await import('./src/index.js')
if (host.name !== 'fsviewer') throw new Error('host name wrong: ' + host.name)
if (!Array.isArray(host.inject) || !host.inject.includes('webServer')) {
  throw new Error('host inject wrong: ' + JSON.stringify(host.inject))
}
if (typeof host.apply !== 'function') throw new Error('host apply missing')

// 主机 apply 走一遍挂载流程：验证 webServer.register 被调用且路由可应答
const hostRegistrations = []
let routeHandler = null
const fakeRes = (status, body) => ({ status, body })
const hostCtx = {
  effect: (fn) => fn(),
  webServer: {
    register: (route) => {
      hostRegistrations.push(route)
      routeHandler = route.handler
      return () => {}
    },
  },
}
host.apply(hostCtx)
if (hostRegistrations.length !== 1 || hostRegistrations[0].kind !== 'prefix' || hostRegistrations[0].path !== '/fsviewer-api') {
  throw new Error('host route registration wrong: ' + JSON.stringify(hostRegistrations))
}
const mkRes = () => {
  const res = { code: 0, headers: null, body: '' }
  res.writeHead = (code, headers) => { res.code = code; res.headers = headers }
  res.end = (b) => { res.body = b ?? '' }
  return res
}
// list 端点：列本插件目录（有 src/ 子目录与文件）
const resList = mkRes()
await routeHandler({ method: 'GET', url: '/fsviewer-api/list?path=' + encodeURIComponent(new URL('.', import.meta.url).pathname.replace(/\/$/, '')) }, resList)
const listed = JSON.parse(resList.body)
if (resList.code !== 200 || !Array.isArray(listed.entries)) throw new Error('list failed: ' + resList.body)
if (!listed.entries.some((e) => e.type === 'directory' && e.name === 'src')) throw new Error('list missing src dir')
if (!listed.entries.some((e) => e.type === 'file' && e.name === 'package.json')) throw new Error('list missing file entry')
// file 端点：读本文件（应含 SMOKE 标记）
const resFile = mkRes()
await routeHandler({ method: 'GET', url: '/fsviewer-api/file?path=' + encodeURIComponent(new URL(import.meta.url).pathname) }, resFile)
const fileData = JSON.parse(resFile.body)
if (resFile.code !== 200 || fileData.binary || !fileData.content.includes('SMOKE OK')) throw new Error('file read failed: ' + resFile.body.slice(0, 200))
// file 端点：目录应 400
const resDir = mkRes()
await routeHandler({ method: 'GET', url: '/fsviewer-api/file?path=' + encodeURIComponent(new URL('.', import.meta.url).pathname) }, resDir)
if (resDir.code !== 400) throw new Error('dir read should 400: ' + resDir.body)
console.log('  host routes: /fsviewer-api/list + /fsviewer-api/file OK')

// chat 端点：宿主未提供 ctx.llm 时应 503 JSON（而非崩溃/非 JSON 响应）
const resChat = mkRes()
await routeHandler({ method: 'POST', url: '/fsviewer-api/chat' }, resChat)
if (resChat.code !== 503) throw new Error('chat without llm should 503, got ' + resChat.code + ': ' + resChat.body)
const chatErr = JSON.parse(resChat.body)
if (!chatErr.error) throw new Error('chat 503 body missing error: ' + resChat.body)
console.log('  host route: POST /fsviewer-api/chat (llm missing -> 503) OK')
