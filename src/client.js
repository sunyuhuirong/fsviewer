/**
 * fsviewer - 客户端插件（统一页签：文件 + 浏览器 + 侧边聊天，Codex 式右缘工作区）
 *
 * 全部内容收敛为 details 右栏（priority -10 影子接管）顶部的一排页签（Codex 式）：
 *   - 打开文件页签：单例（可关闭、可经 + 菜单重建），文件树浏览器；无激活文件时空状态。
 *   - 独立文件页签：树中点文件即打开/聚焦该文件的独立页签（同名复用不重复建），
 *     切换文件 = 切换页签；页签标题为文件名，悬停显示完整路径。
 *   - 侧边聊天页签：多开，每页签独立临时会话（关闭即弃）。直连 POST /fsviewer-api/chat
 *     （宿主 ctx.llm 流式调用，SSE 下发），assistant 消息用官方 MarkdownText streaming
 *     渲染；「引用当前文件」把激活文件页签的内容注入消息上下文。
 *   - 浏览器页签：多开（iframe 常驻挂载，隐藏不卸载、切回不丢状态）；
 *     URL 栏 + 后退/前进/刷新/直连|代理切换/新窗口。代理经宿主 /fsviewer-api/p/ 同源回源，
 *     绕过 X-Frame-Options；iframe 一律沙箱（直连放行 allow-same-origin，代理不放行）。
 *   - 全部页签可关闭；空页签时显示三个大号创建入口（浏览器/文件/侧边聊天，Codex 空状态）。
 *     × 只显示在激活页签上；「+」弹出菜单新建三类页签；页签条横向滚动隐藏滚动条；
 *     页签与会话 localStorage 持久化（防 HMR/刷新丢失）。
 *
 * 入口：会话头文件按钮（order 50）；侧边聊天经 + 菜单或快捷键 ⌥⌘S（最近聊天页签，
 * 无则新建）、⌥⌘T = 新建浏览器页签、⌘P = 打开文件页签（⌘T 留给浏览器本体）。
 * 聊天 Composer 对齐主会话窗口：模型选择器（目录来自 GET /fsviewer-api/models，
 * 选择按页签持久化，未选时跟随 dsh 默认模型）、圆形发送/停止按钮、引用当前文件。
 * dsh 无原生快捷键注册 API，用 e.code DOM 监听。
 *
 * 数据来源：
 *   - 目录/文件：GET /fsviewer-api/list、/file；聊天：POST /fsviewer-api/chat（SSE）
 *   - 浏览器代理：GET /fsviewer-api/p/<URL>
 *   - workspaces.list 仅用于解析默认根目录；选择目录 / 系统打开继续用 workspaces
 *
 * 插件契约：exports.inject = ["slots", "workspaces", "sessions", "layout"]。
 */

import * as React from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

// ---------- 面板开合状态（顶部按钮共享） ----------
// 展开 = layout.openDetails()（原生右栏推挤内容）；收起 = closeDetails()。
let panelOpen = false
const panelListeners = new Set()
// ui-layout 的布局服务：展开/收起原生右栏；apply(ctx) 时捕获
let layoutApi = null
// 原生系统打开（包装 workspaces.openPath 前保存，面板内 ⧉ 仍走系统打开）
let nativeOpenPath = null
// FileTreePanel 挂载时注册的程序化打开文件入口
let panelFileDispatch = null
// FileTreePanel 挂载时注册的程序化「树根跳转」入口（目录引用点击 → 面板树定位）
let panelDirDispatch = null

// ---------- 统一页签仓库（Codex 式）：所有页签一等公民 ----------
// kind: 'files' 打开文件（单例，可关闭、可经 + 菜单重建；文件树浏览器）
//     | 'file'  独立文件页签（每个打开的文件一个，同名复用；切换文件 = 切换页签）
//     | 'chat'  侧边聊天（多开，每页签独立会话，关闭即弃）
//     | 'browser' 浏览器页签（多开，iframe 常驻保活）
// 允许全部关闭：空页签时面板显示三类创建入口（Codex 空状态，见图）。
// 页签 × 只显示在激活页签上；「+」弹出菜单可新建三类页签。
const TABS_KEY = 'fsviewer/tabs.v2'
let tabs = []
let activeTabId = null
let seq = { f: 0, c: 0, b: 0 }
const browserById = {}   // 浏览器页签运行态：{ title, url, input, proxy, hist, idx, reload }
const chatById = {}      // 聊天页签会话：{ messages, route }（streaming/abort 为运行态，不持久化）
let tabsHydrated = false
const tabsListeners = new Set()
function subscribeTabs(fn) { tabsListeners.add(fn); return () => tabsListeners.delete(fn) }
function notifyTabs() { tabsListeners.forEach((l) => l()) }
function persistTabs() {
  try {
    const chats = {}
    for (const [id, c] of Object.entries(chatById)) {
      chats[id] = {
        route: c.route || null,
        model: (c.model && c.model.provider && c.model.model) ? { provider: c.model.provider, model: c.model.model } : null,
        messages: c.messages
          .filter((m) => !m.error && typeof m.content === 'string' && m.content.length)
          .slice(-40)
          .map((m) => ({ role: m.role, content: m.content }))
      }
    }
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeTabId, browser: browserById, chats }))
  } catch { /* 配额满等忽略 */ }
}
function mkId(kind) { return kind + (++seq[kind]) }
function hydrateTabs() {
  if (tabsHydrated) return
  tabsHydrated = true
  try {
    const d = JSON.parse(localStorage.getItem(TABS_KEY) || 'null')
    if (d && Array.isArray(d.tabs)) {
      const restored = d.tabs.filter((t) => t && t.id && t.kind)
      if (restored.length) {
        tabs = restored
        for (const [id, b] of Object.entries(d.browser || {})) {
          browserById[id] = { title: '新标签页', url: null, input: '', proxy: false, hist: [], idx: -1, reload: 0, ...b }
        }
      for (const [id, c] of Object.entries(d.chats || {})) {
        chatById[id] = {
          route: (c && c.route) || null,
          model: (c && c.model && c.model.provider && c.model.model) ? { provider: c.model.provider, model: c.model.model } : null,
          messages: (c && Array.isArray(c.messages) ? c.messages : [])
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length)
            .slice(-60)
        }
      }
        for (const t of tabs) {
          const n = Number(String(t.id).slice(1)) || 0
          if (t.kind === 'file') seq.f = Math.max(seq.f, n)
          else if (t.kind === 'chat') seq.c = Math.max(seq.c, n)
          else if (t.kind === 'browser') seq.b = Math.max(seq.b, n)
        }
        activeTabId = tabs.some((t) => t.id === d.activeTabId) ? d.activeTabId : tabs[tabs.length - 1].id
        return
      }
    }
  } catch { /* 历史损坏按默认 */ }
  // 默认页签条（Codex 默认）：打开文件 + 一个侧边聊天
  const c = mkId('c')
  tabs = [{ id: 'files', kind: 'files' }, { id: c, kind: 'chat' }]
  chatById[c] = { messages: [], route: null }
  activeTabId = 'files'
}
function getActiveTab() { return tabs.find((t) => t.id === activeTabId) || null }
function activateTab(id) {
  if (!tabs.some((t) => t.id === id)) return
  activeTabId = id
  persistTabs(); notifyTabs()
}
function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  const closed = tabs[idx]
  tabs = tabs.filter((t) => t.id !== id)
  if (closed.kind === 'browser') delete browserById[id]
  if (closed.kind === 'chat') delete chatById[id]   // 临时会话：关闭即弃
  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)]
    activeTabId = next ? next.id : null             // 全部关闭 → 空页签状态
  }
  persistTabs(); notifyTabs()
}
function ensureFilesTab() {
  let t = tabs.find((t) => t.kind === 'files')
  if (!t) { t = { id: 'files', kind: 'files' }; tabs = tabs.concat(t) }
  activeTabId = t.id
  persistTabs(); notifyTabs()
}
function openFileTab(path) {
  let t = tabs.find((t) => t.kind === 'file' && t.path === path)
  if (!t) { t = { id: mkId('f'), kind: 'file', path }; tabs = tabs.concat(t) }
  activeTabId = t.id
  persistTabs(); notifyTabs()
}
// 「打开文件」页签下双击文件：该页签原地替换为文件页签（不新增页签，Codex 首开语义）。
// 若该文件已有独立页签，则移除 files 页签并聚焦已有页签。
function replaceFilesTabWithFile(path) {
  const idx = tabs.findIndex((t) => t.kind === 'files')
  if (idx < 0) return openFileTab(path)
  const existing = tabs.find((t) => t.kind === 'file' && t.path === path)
  tabs = tabs.filter((t) => t.kind !== 'files')
  if (existing) {
    activeTabId = existing.id
  } else {
    const tab = { id: mkId('f'), kind: 'file', path }
    // 原位插入到 files 页签原来的位置
    const at = Math.min(idx, tabs.length)
    tabs = tabs.slice(0, at).concat(tab, tabs.slice(at))
    activeTabId = tab.id
  }
  persistTabs(); notifyTabs()
}
function newBrowserTab() {
  const id = mkId('b')
  browserById[id] = { title: '新标签页', url: null, input: '', proxy: false, hist: [], idx: -1, reload: 0 }
  tabs = tabs.concat({ id, kind: 'browser' })
  activeTabId = id
  persistTabs(); notifyTabs()
}
function newChatTab() {
  const id = mkId('c')
  chatById[id] = { messages: [], route: null }
  tabs = tabs.concat({ id, kind: 'chat' })
  activeTabId = id
  persistTabs(); notifyTabs()
}
function activateLatestChat() {
  const t = [...tabs].reverse().find((t) => t.kind === 'chat')
  if (t) activateTab(t.id)
  else newChatTab()
}
function updateBrowser(id, fn) {
  if (!browserById[id]) return
  browserById[id] = fn(browserById[id])
  persistTabs(); notifyTabs()
}
function useActiveTab() {
  hydrateTabs()
  const [, force] = React.useState()
  React.useEffect(() => subscribeTabs(() => force({})), [])
  return getActiveTab()
}

// ---------- 当前预览文件上下文（聊天「引用当前文件」的数据源） ----------
// FileTreePanel 在激活文件内容就绪时写入；无激活文件/二进制时清空
let currentFileCtx = null
const fileCtxListeners = new Set()
function setCurrentFileCtx(next) {
  const prev = currentFileCtx
  if (prev === next) return
  if (prev && next && prev.path === next.path && prev.content === next.content && prev.truncated === next.truncated) return
  currentFileCtx = next
  fileCtxListeners.forEach((l) => l())
}
function useCurrentFileCtx() {
  const [, force] = React.useState()
  React.useEffect(() => {
    fileCtxListeners.add(force)
    return () => fileCtxListeners.delete(force)
  }, [])
  return currentFileCtx
}

// ---------- 聊天会话（每页签独立，多开；会话存于 chatById，随统一页签持久化） ----------
const CHAT_QUOTE_CHARS = 32000     // 引用文件注入正文的上限
const chatAbort = {}               // chatId -> AbortController（运行态）
function getChat(id) { return chatById[id] || (chatById[id] = { messages: [], route: null }) }
function updateChat(id, fn) {
  chatById[id] = fn(chatById[id]) || chatById[id]
  persistTabs(); notifyTabs()
}
function lastAssistant(c) {
  const m = c.messages[c.messages.length - 1]
  return m && m.role === 'assistant' ? m : null
}

/** 发送一轮：追加 user + 空 assistant，读 SSE 帧增量填充；abort/错误都落在 assistant 消息上 */
async function sendChat(chatId, text, fileCtx) {
  const trimmed = text.trim()
  const c = getChat(chatId)
  if (!trimmed || c.streaming) return
  let content = trimmed
  if (fileCtx && typeof fileCtx.content === 'string') {
    const clip = fileCtx.content.slice(0, CHAT_QUOTE_CHARS)
    const more = fileCtx.content.length > CHAT_QUOTE_CHARS ? '\n…（已截断）' : ''
    content += '\n\n---\n[引用文件: ' + fileCtx.path + (fileCtx.truncated ? '，前 1MB' : '') + ']\n```\n' + clip + more + '\n```'
  }
  updateChat(chatId, (cur) => {
    cur.messages = cur.messages.concat([
      { role: 'user', content },
      { role: 'assistant', content: '', streaming: true }
    ])
    cur.streaming = true
    return cur
  })
  const ctrl = new AbortController()
  chatAbort[chatId] = ctrl
  try {
    const cur = getChat(chatId)
    const body = { messages: cur.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) }
    if (cur.model && cur.model.provider && cur.model.model) {
      body.provider = cur.model.provider
      body.model = cur.model.model
    }
    const res = await fetch('/fsviewer-api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    if (!res.ok || !res.body) {
      let msg = 'HTTP ' + res.status
      try { const j = await res.json(); if (j && j.error) msg = j.error } catch { /* 非 JSON 错误体 */ }
      throw new Error(msg)
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!dataLine) continue
        let evt
        try { evt = JSON.parse(dataLine.slice(5).trim()) } catch { continue }
        updateChat(chatId, (cur) => {
          const m = lastAssistant(cur)
          if (evt.meta && evt.meta.provider) cur.route = evt.meta
          else if (evt.delta && m) {
            if (typeof evt.delta.text === 'string') m.content += evt.delta.text
            else if (typeof evt.delta.reasoning === 'string') m.reasoning = (m.reasoning || '') + evt.delta.reasoning
          } else if (evt.error && m) m.error = evt.error
          else if (evt.done && evt.done.finish === 'max-tokens' && m) m.note = '回复达到 token 上限，可能被截断'
          return cur
        })
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) {
      updateChat(chatId, (cur) => {
        const m = lastAssistant(cur)
        if (m) m.error = humanError(e)
        return cur
      })
    }
  } finally {
    updateChat(chatId, (cur) => {
      const m = lastAssistant(cur)
      if (m) delete m.streaming
      cur.streaming = false
      return cur
    })
    delete chatAbort[chatId]
  }
}
function stopChat(chatId) { if (chatAbort[chatId]) chatAbort[chatId].abort() }

// ---------- 模型目录（GET /fsviewer-api/models，进程内缓存一次） ----------
let modelsCache = null
let modelsPending = null
function loadModels() {
  if (modelsCache) return Promise.resolve(modelsCache)
  if (!modelsPending) {
    modelsPending = fetchJson('/fsviewer-api/models')
      .then((d) => { modelsCache = d; return d })
      .finally(() => { modelsPending = null })
  }
  return modelsPending
}

// ---------- 小窗口展开前的让位 ----------
// 原生让位链：details 先被挤压、再自动关闭（保 center ≥ 640），左栏从不让位。
// 窗口不够时右栏会被直接算成 0 宽（点开无效果）。与原生 columns 契约一致的常量：
const CENTER_MIN_PX = 640      // 原生 CENTER_MIN
const DETAILS_MIN_PX = 300     // 原生 DETAILS_MIN
const SIDEBAR_RAIL_PX = 56     // 原生 SIDEBAR_COLLAPSED 收起态图标栏
// 左栏当前实际渲染宽度：读 AppFrame 内联网格第一段；读不到按断点（1024）推断
function sidebarRenderedWidth() {
  const col = document.querySelector('[class*="detailsCol"]')
  const frame = col && col.parentElement
  const inline = frame && frame.style.gridTemplateColumns
  if (inline) {
    const first = parseFloat(inline.split(' ')[0])
    if (!Number.isNaN(first)) return first
  }
  return window.innerWidth > 1024 ? 280 : SIDEBAR_RAIL_PX
}
// 右栏展开前调用：左栏展开着、且按当前宽度右栏会被挤到最小宽以下时，
// 先收起左栏（原生 toggleSidebar 在 >1024 视口写偏好 0，收起为图标栏）。
// 只在左栏确实处于展开态时触发——收起态（56 图标栏）下再 toggle 会把它展开，反了。
// 返回收拢后的左栏有效宽度（供挤压判定使用，避免读到未刷新的 DOM）。
function ensureRoomForDetails() {
  if (!layoutApi) return sidebarRenderedWidth()
  const sidebarW = sidebarRenderedWidth()
  if (sidebarW > SIDEBAR_RAIL_PX + 8 &&
      window.innerWidth - sidebarW - CENTER_MIN_PX < DETAILS_MIN_PX) {
    layoutApi.toggleSidebar()
    return SIDEBAR_RAIL_PX
  }
  return sidebarW
}

// ---------- 极小窗口的挤压展开 ----------
// 原生让位链在 V ≤ 696（左栏已收成图标栏）时仍会把 details 算成 0 宽——点开无效果。
// 此时用与 ⤢ 相同的 CSS 覆盖把右栏钉在可用宽度（280-360px），center 段是 1fr
// 弹性轨道、自然吸收挤压；窗口变大到原生放得下（≥300）后自动解除覆盖。
let pinMode = null          // null | 'wide'（⤢ 用户选择，不自动解除）| 'squeeze'（小窗口挤压，自动解除）
let panelResizeWatch = null
function stopPanelResizeWatch() {
  if (panelResizeWatch) { window.removeEventListener('resize', panelResizeWatch); panelResizeWatch = null }
}
// 面板打开期间常驻：窗口尺寸变化时双向调度——原生被饿（<300 或 0）就钉挤压宽度，
// 原生放得下就解除覆盖交还（⤢ 的 520 是用户选择，不动）。
function startPanelResizeWatch() {
  stopPanelResizeWatch()
  panelResizeWatch = () => {
    if (!panelOpen || pinMode === 'wide') return
    const nativeFits = window.innerWidth - sidebarRenderedWidth() - CENTER_MIN_PX >= DETAILS_MIN_PX
    if (pinMode === 'squeeze') {
      if (nativeFits) tryReleaseSqueeze()
      else applySqueezeIfNeeded(sidebarRenderedWidth())  // 跟随窗口尺寸重算挤压宽度
    } else if (!nativeFits) {
      applySqueezeIfNeeded(sidebarRenderedWidth())
    }
  }
  window.addEventListener('resize', panelResizeWatch)
}
// 试探-回退式解除：resize 瞬间 sidebar 内联可能还是旧值（如 narrow 退出前仍是 56 图标栏），
// 误判「原生放得下」就解除会让原生把 details 关成 0（details 契约是 ≥300 或 0，无中间态），
// 面板凭空消失。故解除后延迟验证 detailsCol 实际宽度，原生没接住就重新钉上。
function tryReleaseSqueeze() {
  pinMode = null
  setFramePin(null)
  setTimeout(() => {
    if (pinMode !== null || !panelOpen) return  // 期间用户已 ⤢ 等其他操作，不回退
    const col = document.querySelector('[class*="detailsCol"]')
    const w = col ? col.getBoundingClientRect().width : 0
    if (w < 280) applySqueezeIfNeeded(sidebarRenderedWidth())
  }, 300)
}
// sidebarW = 收拢后的左栏有效宽度。原生已放得下则什么都不做。
function applySqueezeIfNeeded(sidebarW) {
  // 窄视口（<1024，原生自动收栏断点）下左栏必渲染成 56 图标栏；resize 瞬间
  // 读到的可能是旧展开宽度，按断点校正，避免挤压宽度算小
  const effW = window.innerWidth >= 1024 ? sidebarW : Math.min(sidebarW, SIDEBAR_RAIL_PX)
  const fitsNatively = window.innerWidth - effW - CENTER_MIN_PX >= DETAILS_MIN_PX
  if (!fitsNatively) {
    if (pinMode === 'wide') return  // ⤢ 已钉 520，比挤压更宽，不覆盖用户选择
    pinMode = 'squeeze'
    // 目标宽度：优先 360（默认宽），窗口太窄时给右栏留 360 可读聊天区，下限 280
    setFramePin(Math.max(280, Math.min(360, window.innerWidth - effW - 360)))
  } else if (pinMode === 'squeeze') {
    pinMode = null
    setFramePin(null)
  }
}
function openPanelWithRoom() {
  setPanelOpen(true)
  const sidebarW = ensureRoomForDetails()
  if (layoutApi) layoutApi.openDetails()
  applySqueezeIfNeeded(sidebarW)
  startPanelResizeWatch()
}
function openFileInPanel(path) {
  openPanelWithRoom()
  openFileTab(path)
}
// 目录引用点击（如「在文件夹中显示」）：面板树直接定位到该目录
function openDirInPanel(path) {
  openPanelWithRoom()
  ensureFilesTab()
  if (panelDirDispatch) panelDirDispatch(path)
  else if (nativeOpenPath) nativeOpenPath(path)
}
function subscribePanel(fn) { panelListeners.add(fn); return () => panelListeners.delete(fn) }
function setPanelOpen(next) {
  panelOpen = typeof next === 'function' ? next(panelOpen) : next
  panelListeners.forEach((l) => l())
}
function usePanelOpen() {
  const [, force] = React.useState()
  React.useEffect(() => subscribePanel(() => force({})), [])
  return [panelOpen, setPanelOpen]
}
function togglePanel() {
  if (panelOpen) { closePanel(); return }
  openPanelWithRoom()
}
function closePanel() {
  if (!panelOpen) return
  setPanelOpen(false)
  // 收起时解除所有宽度覆盖（⤢ 加宽 / 小窗挤压），恢复原生宽度
  wideOn = false
  pinMode = null
  stopPanelResizeWatch()
  setFramePin(null)
  if (layoutApi) layoutApi.closeDetails()
}

// ---------- 数据访问（主机半边 /fsviewer-api 路由） ----------
async function fetchJson(url) {
  const res = await fetch(url)
  let data = null
  try { data = await res.json() } catch { /* 非 JSON 响应按 HTTP 状态报错 */ }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
  return data
}
const fetchList = (path) => fetchJson('/fsviewer-api/list?path=' + encodeURIComponent(path || '/'))
const fetchFile = (path) => fetchJson('/fsviewer-api/file?path=' + encodeURIComponent(path))

// ---------- 样式注入（按钮 + 行悬停，走主题变量适配明暗） ----------
const TOGGLE_CSS_ID = 'fsviewer/toggle.css'
function injectToggleStyle() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(TOGGLE_CSS_ID) + ']')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'fsviewer'
  tag.dataset.pluginCss = TOGGLE_CSS_ID
  tag.textContent =
    '.fsviewer-toggle{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);' +
    'background:transparent;border:none;border-radius:50%;flex:none;justify-content:center;' +
    'align-items:center;padding:0;display:inline-flex}' +
    '.fsviewer-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
    '.fsviewer-toggle--active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}' +
    '.fsviewer-iconbtn{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);' +
    'background:transparent;border:none;border-radius:50%;flex:none;justify-content:center;' +
    'align-items:center;padding:0;display:inline-flex}' +
    '.fsviewer-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
    '.fsviewer-iconbtn--active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}' +
    '.fsviewer-row{display:flex;align-items:center;padding:2px 4px;cursor:pointer;font-size:13px;' +
    'color:var(--dsw-alias-label-primary);white-space:nowrap;border-radius:3px}' +
    '.fsviewer-row:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
    '.fsviewer-badge{flex:0 0 auto;display:inline-flex;justify-content:center;align-items:center;' +
    'width:20px;height:14px;border-radius:3px;font-size:8px;font-weight:700;margin-right:4px;' +
    'color:#fff;mix-blend-mode:normal}' +
    '.fsviewer-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;max-width:150px;' +
    'padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary);' +
    'background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap}' +
    '.fsviewer-tab--active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}' +
    '.fsv-expanded-frame{grid-template-columns:var(--fsv-grid, 280px minmax(0,1fr) 360px) !important}' +
    '.fsv-expanded-frame [class*="handle"]{display:none !important}' +
    // 悬停提示气泡：内嵌浏览器不渲染原生 title，用 CSS 气泡保证可见
    '.fsviewer-tip{position:relative}' +
    '.fsviewer-tip:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);right:0;' +
    'background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);' +
    'font-size:12px;line-height:1;padding:6px 9px;border-radius:6px;white-space:nowrap;z-index:60;' +
    'pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.18)}' +
    // 统一页签条：文件组 | 侧边聊天 | 浏览器页签 之间的细分隔线
    '.fsviewer-tab-divider{flex:0 0 auto;width:1px;height:14px;' +
    'background:var(--dsw-alias-border-l1);margin:0 2px}' +
    '.fsviewer-tab svg{flex:0 0 auto}' +
    // 「+」新建页签菜单（浏览器/文件/侧边聊天）
    '.fsviewer-plus-menu{position:fixed;z-index:60;min-width:200px;padding:4px;border-radius:10px;' +
    'border:1px solid ' + V.line + ';background:var(--dsw-specific-sidebar-fill);' +
    'box-shadow:0 8px 24px rgba(0,0,0,.28)}' +
    '.fsviewer-plus-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;' +
    'border:none;background:transparent;border-radius:6px;color:var(--dsw-alias-label-primary);' +
    'font-size:12.5px;cursor:pointer;font-family:inherit}' +
    '.fsviewer-plus-item:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
    '.fsviewer-plus-item svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}' +
    '.fsviewer-plus-hint{color:var(--dsw-alias-label-secondary);font-size:11px}' +
    // 页签条横向滚动不显示滚动条（避免占位）
    '.fsviewer-tabstrip{scrollbar-width:none;-ms-overflow-style:none}' +
    '.fsviewer-tabstrip::-webkit-scrollbar{display:none}' +
    // 空页签状态的大号创建入口
    '.fsviewer-empty-item{display:flex;align-items:center;gap:12px;width:100%;padding:14px 18px;' +
    'border:none;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);' +
    'color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer;font-family:inherit}' +
    '.fsviewer-empty-item:hover{background:var(--dsw-alias-interactive-bg-active)}' +
    '.fsviewer-empty-item svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}' +
    // 侧边聊天（面板内页签视图，充满 details 列）
    '.fsviewer-chat-scroll{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:12px 14px;' +
    'display:flex;flex-direction:column;gap:10px;min-height:0}' +
    '.fsviewer-chat-user{align-self:flex-end;max-width:88%;background:var(--dsw-alias-interactive-bg-hover);' +
    'border-radius:12px;padding:8px 11px;font-size:13px;line-height:1.55;white-space:pre-wrap;' +
    'word-break:break-word;color:var(--dsw-alias-label-primary)}' +
    '.fsviewer-chat-ai{align-self:stretch;min-width:0;font-size:13px;line-height:1.6;' +
    'color:var(--dsw-alias-label-primary);word-break:break-word}' +
    '.fsviewer-chat-quote{display:inline-flex;align-items:center;gap:4px;max-width:100%;' +
    'padding:3px 8px;border-radius:999px;border:1px solid ' + V.line + ';background:transparent;' +
    'color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;overflow:hidden;white-space:nowrap}' +
    '.fsviewer-chat-quote.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}'
  document.head.appendChild(tag)
}

// ---------- 样式常量 ----------
// 面板渲染在原生 details 右栏内（宽度由原生列决定，用户可拖拽 300-520px）；
// 树栏默认 150px，左缘可拖拽调宽（120-320px）
const TREE_DEFAULT_WIDTH = 150
let treeWidth = TREE_DEFAULT_WIDTH
const Z_TRIGGER = 301
// ⤢ 展开：覆盖 AppFrame 网格列宽（!important 压过内联样式）；
// 极小窗口挤压展开复用同一机制，只是钉的宽度不同。
const EXPAND_CLASS = 'fsv-expanded-frame'
let wideOn = false
let frameStyleObserver = null
// 钉住网格的 details 段为指定宽度（px=null 解除）；sidebar/center 段镜像 React 的
// 最新内联值（center 是 minmax(0,1fr) 弹性轨道，自然吸收挤压；否则收起左侧边栏时
// sidebar 段会被冻结成旧宽度）。用 MutationObserver 监听 AppFrame 内联网格变化并
// 同步 --fsv-grid；带去重守卫防止自身写入触发死循环。
function setFramePin(px) {
  const col = document.querySelector('[class*="detailsCol"]')
  const frame = col && col.parentElement
  if (!frame) return
  if (px != null) {
    let last = ''
    const sync = () => {
      const inline = frame.style.gridTemplateColumns
      if (!inline) return
      const parts = inline.split(' ')
      if (parts.length < 3) return
      parts[parts.length - 1] = px + 'px'
      const next = parts.join(' ')
      if (next !== last) {
        last = next
        frame.style.setProperty('--fsv-grid', next)
      }
    }
    sync()
    frame.classList.add(EXPAND_CLASS)
    if (frameStyleObserver) frameStyleObserver.disconnect()
    frameStyleObserver = new MutationObserver(sync)
    frameStyleObserver.observe(frame, { attributes: true, attributeFilter: ['style'] })
  } else {
    if (frameStyleObserver) { frameStyleObserver.disconnect(); frameStyleObserver = null }
    frame.classList.remove(EXPAND_CLASS)
    frame.style.removeProperty('--fsv-grid')
  }
}
// 颜色全部走宿主主题变量，明暗主题自动适配
// muted 用 label-secondary（浅色主题下 label-dimmed 对比度过低，文字图标看不清）
// fill 对齐主会话背景（主会话消息区/输入卡片同为 bg-base 白底，配阴影浮起）
const V = {
  fill: 'var(--dsw-alias-bg-base, #fff)',
  fg: 'var(--dsw-alias-label-primary)',
  muted: 'var(--dsw-alias-label-secondary)',
  line: 'var(--dsw-alias-border-l1)',
  edge: 'var(--dsw-alias-border-l2)',
  input: 'var(--dsw-alias-bg-base)',
  font: 'var(--dsw-font-family, inherit)',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  accent: '#3b82f6'
}

// ---------- 小工具 ----------
function fmtError(e) {
  return e && e.message ? e.message : String(e)
}
function humanError(e) {
  const raw = fmtError(e)
  if (/EACCES|permission/i.test(raw)) return '没有权限访问该路径'
  if (/ENOENT|not found|404/i.test(raw)) return '路径不存在或已被移动'
  if (/network|fetch|timeout|abort|Failed to fetch/i.test(raw)) return '网络异常，请确认主机服务在运行'
  return raw
}
function matches(term, name) {
  return !term || name.toLowerCase().includes(term.toLowerCase())
}
function baseName(p) {
  const segs = String(p || '').split(/[\\/]+/).filter(Boolean)
  return segs.length ? segs[segs.length - 1] : p
}
function fmtSize(n) {
  if (n == null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
// 文件类型徽章（对齐参考截图风格：彩色 monogram 小徽章）
function fileBadge(name) {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const table = {
    md: ['MD', '#3fb950'], markdown: ['MD', '#3fb950'],
    json: ['{}', '#d29922'], jsonc: ['{}', '#d29922'],
    js: ['JS', '#58a6ff'], mjs: ['JS', '#58a6ff'], cjs: ['JS', '#58a6ff'],
    jsx: ['JS', '#58a6ff'], ts: ['TS', '#58a6ff'], tsx: ['TS', '#58a6ff'],
    yml: ['Y', '#f85149'], yaml: ['Y', '#f85149'], toml: ['T', '#f85149'],
    sql: ['SQL', '#a371f7'], db: ['DB', '#a371f7'],
    py: ['PY', '#3572a5'], rb: ['RB', '#e34c26'], go: ['GO', '#00add8'], rs: ['RS', '#dea584'],
    html: ['<>', '#e34c26'], css: ['CSS', '#a371f7'], scss: ['CSS', '#c6538c'],
    sh: ['$', '#8b949e'], bash: ['$', '#8b949e'], zsh: ['$', '#8b949e'],
    txt: ['TXT', '#8b949e'], log: ['LOG', '#8b949e'],
    png: ['IMG', '#d2a8ff'], jpg: ['IMG', '#d2a8ff'], jpeg: ['IMG', '#d2a8ff'], gif: ['IMG', '#d2a8ff'], svg: ['IMG', '#d2a8ff'], webp: ['IMG', '#d2a8ff'],
    zip: ['ZIP', '#d29922'], gz: ['ZIP', '#d29922'], tar: ['ZIP', '#d29922']
  }
  const hit = table[ext]
  if (hit) return { text: hit[0], color: hit[1] }
  if (!ext) return { text: 'FILE', color: '#8b949e' }
  return { text: ext.slice(0, 3).toUpperCase(), color: '#8b949e' }
}
const isMdFile = (name) => /\.(md|markdown)$/i.test(name || '')

// ---------- 顶部切换按钮图标：右侧栏 ----------
// 与原生 IconPanelLeftOutline16 完全同源（同一份 16x16 实心路径），仅水平镜像
// （竖线从靠左变为靠右 = 「右侧栏」），保证与原生按钮字形尺寸/线宽完全一致。
const PANEL_PATH = 'M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z'
function SidebarRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g transform="translate(16 0) scale(-1 1)">
        <path fillRule="evenodd" clipRule="evenodd" d={PANEL_PATH} fill="currentColor" />
      </g>
    </svg>
  )
}

// ---------- 顶部切换按钮（注入会话头 utilities，位于 session log 导出按钮右边） ----------
// session 作用域组件：拿到 sessionId，切换会话时自动收起面板。
// 点击 = layout.openDetails()/closeDetails()（原生右栏推挤/收起，位置随头部移动、确定可预期）
function FsToggleButton({ sessionId }) {
  const [open] = usePanelOpen()
  // null=尚未记录（首帧赋值不算「切换」，避免会话恢复期间误关面板）
  const lastSession = React.useRef(null)
  React.useEffect(() => {
    if (lastSession.current === null) {
      lastSession.current = sessionId
      return
    }
    if (lastSession.current !== sessionId) {
      lastSession.current = sessionId
      closePanel()
    }
  }, [sessionId])
  return (
    <button
      type="button"
      aria-label="文件管理器"
      title="文件管理器"
      className={'fsviewer-toggle' + (open ? ' fsviewer-toggle--active' : '')}
      onClick={togglePanel}
    >
      <SidebarRightIcon />
    </button>
  )
}

// ---------- 文件树 + 预览状态 ----------
// 布局为 Codex 式左右分栏：左侧预览（无激活文件时空状态），右侧目录树常显。
function initState() {
  return {
    root: undefined,      // undefined=尚未解析；null=无 workspace；string=绝对路径
    nonce: 0,             // 强制重载（刷新）
    crumbs: [],
    entries: [],
    truncated: false,
    loading: false,
    error: null,
    expanded: {},         // path -> true（已展开）
    branches: {},         // path -> { status:'new'|'ok'|'err', entries, truncated, error }
    term: '',
    activePath: null,     // 当前预览文件（null = 空状态）——由统一页签仓库派生同步
    files: {},            // path -> { status:'loading'|'ok'|'err', content?, size?, truncated?, binary?, error? }
    sourceMode: false     // md：false=渲染视图，true=源码
  }
}
function reducer(state, action) {
  switch (action.type) {
    case 'setRoot':
      return { ...state, root: action.root }
    case 'gotoRoot':
      // 程序化树根跳转（目录引用点击）：nonce +1 保证同根也强制重载
      return { ...state, root: action.root, nonce: state.nonce + 1 }
    case 'refresh':
      return { ...state, nonce: state.nonce + 1 }
    case 'loadStart':
      return { ...state, loading: true, error: null }
    case 'loadRootOk':
      return {
        ...state,
        loading: false,
        error: null,
        root: action.path,
        crumbs: action.crumbs,
        entries: action.entries,
        truncated: action.truncated,
        branches: {},          // 换根时清空已展开分支
        expanded: {},
        term: ''
      }
    case 'loadFail':
      return { ...state, loading: false, error: action.error }
    case 'toggle': {
      const p = action.path
      const expanded = { ...state.expanded }
      const branches = { ...state.branches }
      if (expanded[p]) {
        delete expanded[p]
        delete branches[p]
      } else {
        expanded[p] = true
        if (!branches[p]) branches[p] = { status: 'new' }
      }
      return { ...state, expanded, branches }
    }
    case 'branchOk':
      return { ...state, branches: { ...state.branches, [action.path]: { status: 'ok', entries: action.entries, truncated: action.truncated } } }
    case 'branchErr':
      return { ...state, branches: { ...state.branches, [action.path]: { status: 'err', error: action.error } } }
    case 'setTerm':
      return { ...state, term: action.term }
    case 'setActive':
      // 统一页签仓库派生：激活文件页签 -> 预览；激活 打开文件/聊天/浏览器页签 -> 空状态
      return { ...state, activePath: action.path || null, sourceMode: false }
    case 'fileLoading':
      return { ...state, files: { ...state.files, [action.path]: { status: 'loading' } } }
    case 'fileOk':
      return { ...state, files: { ...state.files, [action.path]: { status: 'ok', content: action.content, size: action.size, truncated: action.truncated, binary: action.binary } } }
    case 'fileErr':
      return { ...state, files: { ...state.files, [action.path]: { status: 'err', error: action.error } } }
    case 'toggleSource':
      return { ...state, sourceMode: !state.sourceMode }
    default:
      return state
  }
}

// ---------- 目录行（Codex 式：细箭头 + 名称，无文件夹图标） ----------
function Chevron({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flex: '0 0 auto' }}>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function DirRow({ entry, depth, expanded, loading, onToggle }) {
  return (
    <div className="fsviewer-row" style={{ paddingLeft: 6 + depth * 14 }} onClick={onToggle} title={entry.path}>
      <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center', color: V.muted, flex: '0 0 auto' }}>
        {loading ? '⏳' : <Chevron open={expanded} />}
      </span>
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 4 }}>{entry.name}</span>
    </div>
  )
}

// ---------- 文件行（彩色类型徽章；激活高亮） ----------
// 手势按当前页签类型区分（Codex 语义）：
//   打开文件页签：双击打开（原地替换为文件页签），单击仅选中
//   文件页签：单击即新建/聚焦该文件的独立页签（双击同义）
function FileRow({ entry, depth, active, tabKind, onActivate, onOpen }) {
  const badge = fileBadge(entry.name)
  return (
    <div className="fsviewer-row" style={{ paddingLeft: 20 + depth * 14, ...(active ? { backgroundColor: 'var(--dsw-alias-interactive-bg-active)' } : null) }}
      onClick={tabKind === 'file' ? onActivate : undefined}
      onDoubleClick={onOpen}
      title={tabKind === 'files' ? '双击打开 ' + entry.name : entry.path}>
      <span className="fsviewer-badge" style={{ backgroundColor: badge.color }}>{badge.text}</span>
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 4 }}>{entry.name}</span>
    </div>
  )
}

// ---------- 错误边界 ----------
class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    console.error('[fsviewer] panel crashed:', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div title={'文件管理器出错：' + fmtError(this.state.error)}
        style={{
          position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)',
          backgroundColor: '#5c1f1f', color: '#ffcccc', padding: '10px 8px',
          borderRadius: '4px 0 0 4px', fontSize: '14px', zIndex: Z_TRIGGER,
          cursor: 'pointer', pointerEvents: 'auto'
        }}
        onClick={() => this.setState({ error: null })}>⚠</div>
    )
  }
}

// ---------- 图标（Codex 风格单色线性图标，统一 16px / strokeWidth 1.3-1.5） ----------
function IconMaximize() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 四向箭头展开图标，与 dsh IconFullscreenOutline16 风格一致：粗填充路径 */}
      <path d="M2.58875 12.3407L6.59167 8.33777L7.66296 9.40808L3.66003 13.411H7.99988V14.8065H3.05457C2.02633 14.8065 1.19324 13.9734 1.19324 12.9452V7.99988H2.58875V12.3407Z" fill="currentColor" />
      <path d="M12.9452 1.19324C13.9734 1.19324 14.8065 2.02633 14.8065 3.05457V7.99988H13.411V3.66003L9.40808 7.66296L8.33777 6.59167L12.3407 2.58875H7.99988V1.19324H12.9452Z" fill="currentColor" />
    </svg>
  )
}
function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" />
      <path d="M10.5 3.5h-6a1 1 0 0 0-1 1v6" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}
function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  )
}
// ---------- Finder 图标：直接内嵌 macOS 系统原生 Finder.icns 提取的 64px PNG（真实苹果图标，非重绘） ----------
const FINDER_ICON_SRC = 'data:image/png;base64,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'
function IconFinder() {
  return <img src={FINDER_ICON_SRC} width={18} height={18} alt="" draggable={false} style={{ display: 'block', borderRadius: 4.5 }} />
}
// ---------- 浏览器/聊天图标（与既有 16px 线性风格一致） ----------
function IconChatBubble() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 1.8c3.6 0 6.5 2.5 6.5 5.6s-2.9 5.6-6.5 5.6c-.7 0-1.4-.1-2-.3l-3.2 1.2c-.4.1-.7-.2-.6-.6l.7-2.6C1.9 9.7 1.5 8.6 1.5 7.4c0-3.1 2.9-5.6 6.5-5.6z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M5.2 7.5h.01M8 7.5h.01M10.8 7.5h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
// 空状态大图标：气泡内加号（Codex 侧边聊天空状态同款字形，16 viewBox 可无级缩放）
function IconChatPlus({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 1.8c3.6 0 6.5 2.5 6.5 5.6s-2.9 5.6-6.5 5.6c-.7 0-1.4-.1-2-.3l-3.2 1.2c-.4.1-.7-.2-.6-.6l.7-2.6C1.9 9.7 1.5 8.6 1.5 7.4c0-3.1 2.9-5.6 6.5-5.6z" stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
      <path d="M8 4.9v4.4M5.8 7.1h4.4" stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" />
    </svg>
  )
}
function IconArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconReload() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75M13.2 1.8v2.9h-2.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconExternal() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 3.5H4.1c-1 0-1.6.7-1.6 1.6v6.8c0 .9.7 1.6 1.6 1.6h6.8c.9 0 1.6-.7 1.6-1.6V9" stroke="currentColor" strokeLinecap="round" />
      <path d="M9.5 2.5h4v4M13.2 2.8 8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconGlobe() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="8" cy="8" rx="2.8" ry="6.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.8 8h12.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
function IconFileLine() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8.8 1.8H4.5c-.9 0-1.6.7-1.6 1.6v9.2c0 .9.7 1.6 1.6 1.6h7c.9 0 1.6-.7 1.6-1.6V6.1L8.8 1.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8.6 2v4.2h4.3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
// ---------- 空状态（未打开任何文件时，预览区居中提示，同 Codex） ----------
function EmptyState() {
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)' }}>
      <svg width="44" height="44" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z" stroke="currentColor" strokeLinejoin="round" />
      </svg>
      <div style={{ fontSize: 15, fontWeight: 600, color: V.fg }}>打开文件</div>
      <div style={{ fontSize: 12 }}>双击目录树中的文件打开</div>
    </div>
  )
}

// ---------- 文件预览（左侧主区：Codex 式大标题 + 复制，正文渲染/源码） ----------
function FilePreview({ state }) {
  const path = state.activePath
  const file = state.files[path] || { status: 'loading' }
  const isMd = isMdFile(baseName(path))
  const copyContent = () => {
    if (file.status === 'ok' && file.content != null && navigator.clipboard) {
      navigator.clipboard.writeText(file.content).catch(() => {})
    }
  }
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      {/* 标题行：文件名 + 复制 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px 4px', flex: '0 0 auto' }}>
        <span style={{ fontSize: 18, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>{baseName(path)}</span>
        <button type="button" onClick={copyContent} title="复制文件内容" aria-label="复制文件内容"
          className="fsviewer-iconbtn">
          <IconCopy />
        </button>
      </div>
      {/* 正文 */}
      <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '0 16px 14px', minWidth: 0 }}>
        {file.status === 'loading'
          ? <div style={{ color: V.muted, textAlign: 'center', padding: 12, fontSize: 12 }}>⏳ 加载中...</div>
          : file.status === 'err'
            ? <div style={{ color: '#e06c75', fontSize: 12 }}>⚠ {file.error}</div>
            : file.binary
              ? <div style={{ textAlign: 'center', padding: 24, color: V.muted, fontSize: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🗂</div>
                二进制文件，不支持预览（{fmtSize(file.size)}）
              </div>
              : <div>
                {file.truncated
                  ? <div style={{ padding: '4px 8px', marginBottom: 8, borderRadius: 4, background: V.input, color: V.muted, fontSize: 11 }}>
                    文件较大（{fmtSize(file.size)}），仅显示前 1MB
                  </div>
                  : null}
                {isMd && !state.sourceMode
                  ? <div style={{ fontSize: 13, wordBreak: 'break-word' }}><MarkdownText text={file.content} /></div>
                  : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: V.mono, fontSize: 11, lineHeight: 1.5, color: V.fg }}>{file.content}</pre>}
              </div>}
      </div>
    </div>
  )
}

// ---------- 文件树栏（右侧窄栏：筛选 + 目录文件树；左缘可拖拽调宽） ----------
function TreeColumn({ workspaces, state, dispatch, width, onResizeStart, tabKind }) {
  function entryMatchesDeep(entry) {
    if (matches(state.term, entry.name)) return true
    if (entry.type !== 'directory') return false
    const branch = state.branches[entry.path]
    return !!(branch && branch.status === 'ok' && branch.entries.some(entryMatchesDeep))
  }
  function filterEntries(entries) {
    if (!state.term) return entries
    return entries.filter(entryMatchesDeep)
  }

  function renderRows(entries, depth) {
    return filterEntries(entries).map((entry) => {
      if (entry.type !== 'directory') {
        return (
          <FileRow key={entry.path} entry={entry} depth={depth} tabKind={tabKind}
            active={entry.path === state.activePath}
            onActivate={() => openFileTab(entry.path)}
            onOpen={() => (tabKind === 'files' ? replaceFilesTabWithFile(entry.path) : openFileTab(entry.path))} />
        )
      }
      const isExpanded = !!state.expanded[entry.path]
      const branch = state.branches[entry.path]
      const loading = isExpanded && branch && branch.status === 'new'
      let childRows = null
      if (isExpanded) {
        if (branch && branch.status === 'ok') {
          childRows = branch.entries.length
            ? renderRows(branch.entries, depth + 1)
            : <div style={{ padding: '2px 4px', paddingLeft: 24 + depth * 14, color: V.muted, fontSize: '12px' }}>{state.term ? '（无匹配项）' : '（空目录）'}</div>
        } else if (branch && branch.status === 'err') {
          childRows = <div style={{ padding: '2px 4px', paddingLeft: 24 + depth * 14, color: '#e06c75', fontSize: '12px' }}>加载失败：{branch.error}</div>
        }
      }
      return (
        <div key={entry.path}>
          <DirRow
            entry={entry}
            depth={depth}
            expanded={isExpanded}
            loading={loading}
            onToggle={() => dispatch({ type: 'toggle', path: entry.path })}
          />
          {childRows}
        </div>
      )
    })
  }

  const visible = filterEntries(state.entries)

  return (
    <div style={{ width, flex: '0 0 auto', borderLeft: '1px solid ' + V.line, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      {/* 左缘拖拽调宽把手 */}
      <div onPointerDown={onResizeStart} title="拖拽调整文件树宽度"
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 1 }} />
      {/* 筛选行 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 10px 8px', flex: '0 0 auto' }}>
        <input id="fsviewer-filter" type="text" placeholder="筛选文件…" value={state.term}
          onChange={(e) => dispatch({ type: 'setTerm', term: e.target.value })}
          style={{ flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box', padding: '5px 8px', backgroundColor: V.input, border: '1px solid ' + V.line, borderRadius: 6, color: V.fg, fontSize: 12 }} />
      </div>
      {/* 状态/错误 */}
      {state.error ? <div style={{ padding: '8px 12px', color: '#e06c75', fontSize: 12, flex: '0 0 auto' }}>⚠ {state.error}</div> : null}
      {/* 目录 + 文件树 */}
      <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '2px 0 4px' }}>
        {!state.root
          ? <div style={{ padding: 12, color: V.muted, textAlign: 'center' }}>未检测到 workspace 根目录</div>
          : state.loading && !state.entries.length
            ? <div style={{ padding: 12, color: V.muted, textAlign: 'center' }}>⏳ 加载中...</div>
            : !state.entries.length
              ? <div style={{ padding: 12, color: V.muted, textAlign: 'center' }}>（目录为空）</div>
              : renderRows(visible, 0)}
      </div>
      {/* 截断提示 */}
      {state.truncated
        ? <div style={{ padding: '6px 12px', borderTop: '1px solid ' + V.line, color: V.muted, fontSize: 11, flex: '0 0 auto' }}>条目过多，已截断（最多 1000 项）</div>
        : null}
    </div>
  )
}

// ---------- 页签条（Codex 式统一管理）：打开文件 | 文件页签 | 侧边聊天 | 浏览器页签 | + 菜单 ----------
// × 只显示在激活页签上（Codex 行为）；「+」弹出菜单新建 浏览器/文件/侧边聊天 三类页签。
function TabStrip() {
  hydrateTabs()
  const [, force] = React.useState()
  React.useEffect(() => subscribeTabs(() => force({})), [])
  const [menu, setMenu] = React.useState(null)   // { top, left } | null
  const plusRef = React.useRef(null)
  const openMenu = () => {
    const r = plusRef.current.getBoundingClientRect()
    setMenu({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 210)) })
  }
  const firstBrowser = tabs.find((t) => t.kind === 'browser')
  const tabLabel = (t) => {
    if (t.kind === 'files') return '打开文件'
    if (t.kind === 'chat') return '侧边聊天'
    if (t.kind === 'file') return baseName(t.path)
    return (browserById[t.id] && browserById[t.id].title) || '新标签页'
  }
  const tabIcon = (t) => {
    if (t.kind === 'files') return <IconFileLine />
    if (t.kind === 'chat') return <IconChatBubble />
    if (t.kind === 'browser') return <IconGlobe />
    return null
  }
  return (
    <div className="fsviewer-tabstrip" style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 auto', minWidth: 0, overflowX: 'auto', padding: '6px 0 6px 8px' }}>
      {tabs.map((t) => {
        const active = t.id === activeTabId
        return (
          <React.Fragment key={t.id}>
            {t.kind === 'browser' && firstBrowser && firstBrowser.id === t.id && tabs[0].kind !== 'browser'
              ? <span className="fsviewer-tab-divider" />
              : null}
            <span className={'fsviewer-tab' + (active ? ' fsviewer-tab--active' : '')}
              onClick={() => activateTab(t.id)}
              title={t.kind === 'file' ? t.path : tabLabel(t)}>
              {tabIcon(t)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tabLabel(t)}</span>
              {active
                ? <span onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
                  title="关闭页签" style={{ opacity: 0.7, padding: '0 1px' }}>×</span>
                : null}
            </span>
          </React.Fragment>
        )
      })}
      {tabs.length > 0
        ? (
          <span ref={plusRef} className="fsviewer-tab" title="新建页签"
            onClick={() => (menu ? setMenu(null) : openMenu())}>+</span>
        )
        : null}
      {menu
        ? (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setMenu(null)} />
            <div className="fsviewer-plus-menu" style={{ top: menu.top, left: menu.left }}>
              <button type="button" className="fsviewer-plus-item" onClick={() => { setMenu(null); openPanelWithRoom(); newBrowserTab() }}>
                <IconGlobe /><span style={{ flex: '1 1 auto', textAlign: 'left' }}>浏览器</span><span className="fsviewer-plus-hint">⌥⌘T</span>
              </button>
              <button type="button" className="fsviewer-plus-item" onClick={() => { setMenu(null); openPanelWithRoom(); ensureFilesTab() }}>
                <IconFileLine /><span style={{ flex: '1 1 auto', textAlign: 'left' }}>文件</span><span className="fsviewer-plus-hint">⌘P</span>
              </button>
              <button type="button" className="fsviewer-plus-item" onClick={() => { setMenu(null); openPanelWithRoom(); newChatTab() }}>
                <IconChatBubble /><span style={{ flex: '1 1 auto', textAlign: 'left' }}>侧边聊天</span><span className="fsviewer-plus-hint">⌥⌘S</span>
              </button>
            </div>
          </>
        )
        : null}
    </div>
  )
}

// ---------- 主面板（渲染在原生 details 右栏内：左预览 + 右树栏，顶部双栏） ----------
function FileTreePanel({ workspaces, sessions }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initState)

  // 注册程序化打开入口：会话内点击文件引用经此在面板中预览
  React.useEffect(() => {
    panelFileDispatch = (p) => openFileTab(p)
    panelDirDispatch = (p) => dispatch({ type: 'gotoRoot', root: p })
    return () => { panelFileDispatch = null; panelDirDispatch = null }
  }, [dispatch])
  // 统一页签仓库 -> 激活文件派生：文件页签激活时预览该文件，其余页签时显示树浏览器
  const activeTab = useActiveTab()
  React.useEffect(() => {
    const p = activeTab && activeTab.kind === 'file' ? activeTab.path : null
    if (p !== state.activePath) dispatch({ type: 'setActive', path: p })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, state.activePath])
  // 右栏可见性：原生列收起时宽度为 0（仍挂载）——宽度 > 80px 视为展开，才加载数据
  const [visible, setVisible] = React.useState(false)
  // 树栏宽度（模块级记忆）；树栏开关
  const [treeW, setTreeW] = React.useState(treeWidth)
  const [treeOn, setTreeOn] = React.useState(true)

  // 跟踪原生右栏列宽 → 可见性
  React.useEffect(() => {
    const col = document.querySelector('[class*="detailsCol"]')
    if (!col || typeof ResizeObserver === 'undefined') { setVisible(true); return }
    const apply = () => setVisible(col.getBoundingClientRect().width > 80)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(col)
    return () => ro.disconnect()
  }, [])

  // 面板可见时才解析默认根目录。优先级：
  //   1) 当前会话的工作目录 cwd（用户正在聊天的项目）
  //   2) workspaces 列表（最近优先 -> 首个）
  // 两个存储都是异步装载的（服务重启后面板首开时快照可能还是空的），
  // 因此先立即试一次，未就绪就订阅等数据到达后再落根。
  React.useEffect(() => {
    if (!visible || state.root !== undefined) return
    let disposed = false
    const unsubs = []
    const resolve = () => {
      let root = null
      try {
        const ss = sessions.list.getSnapshot()
        if (ss && ss.current !== undefined && ss.byId) {
          const rec = ss.byId[ss.current]
          if (rec && rec.cwd) root = rec.cwd
        }
        if (!root) {
          const snap = workspaces.list.getSnapshot()
          if (snap && snap.items && snap.items.length) {
            const rec = snap.items.find((w) => w.workspaceId === snap.recentWorkspaceId)
            const chosen = rec || snap.items[0]
            if (chosen && chosen.path) root = chosen.path
          }
        }
      } catch (e) { console.error('[fsviewer] resolve default root:', e) }
      if (disposed) return true
      if (root !== null) {
        dispatch({ type: 'setRoot', root })
        return true
      }
      return false
    }
    if (resolve()) return
    const onChange = () => {
      if (resolve() && unsubs.length) unsubs.forEach((u) => u())
    }
    try {
      unsubs.push(sessions.list.subscribe(onChange))
      unsubs.push(workspaces.list.subscribe(onChange))
    } catch (e) { console.error('[fsviewer] subscribe root sources:', e) }
    return () => { disposed = true; unsubs.forEach((u) => u()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // 每次面板可见自动刷新根目录层：会话中新产生的文件立即可见
  React.useEffect(() => {
    if (visible && state.root) dispatch({ type: 'refresh' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // root/nonce 变化 -> 加载根目录层（主机路由：目录 + 文件）
  React.useEffect(() => {
    if (!state.root) return
    let alive = true
    dispatch({ type: 'loadStart' })
    fetchList(state.root).then(
      (l) => { if (alive) dispatch({ type: 'loadRootOk', path: l.path, crumbs: l.crumbs || [], entries: l.entries || [], truncated: !!l.truncated }) },
      (e) => { if (alive) dispatch({ type: 'loadFail', error: humanError(e) }) }
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.root, state.nonce])

  // 首次展开的目录 -> 懒加载子目录。
  // cleanup 里统一作废：切换根目录/再次切换展开状态后，迟到的旧响应直接丢弃，
  // 避免写进新状态造成"数据串台"。
  React.useEffect(() => {
    const targets = Object.keys(state.expanded).filter((p) => state.branches[p] && state.branches[p].status === 'new')
    if (!targets.length) return
    let disposed = false
    targets.forEach((path) => {
      fetchList(path).then(
        (l) => { if (!disposed) dispatch({ type: 'branchOk', path, entries: l.entries || [], truncated: !!l.truncated }) },
        (e) => { if (!disposed) dispatch({ type: 'branchErr', path, error: humanError(e) }) }
      )
    })
    return () => { disposed = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.expanded])

  // 当前激活文件缺内容 -> 标记 loading 并拉取（已 ok/err 走缓存；迟到的旧响应丢弃）
  React.useEffect(() => {
    const path = state.activePath
    if (!path) return
    const entry = state.files[path]
    if (entry && entry.status !== 'loading') return
    let alive = true
    if (!entry) dispatch({ type: 'fileLoading', path })
    fetchFile(path).then(
      (f) => { if (alive) dispatch({ type: 'fileOk', path, content: f.content, size: f.size, truncated: !!f.truncated, binary: !!f.binary }) },
      (e) => { if (alive) dispatch({ type: 'fileErr', path, error: humanError(e) }) }
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activePath, state.files])

  // 当前文件内容就绪 -> 写入聊天「引用当前文件」上下文（无激活文件/二进制时清空）
  React.useEffect(() => {
    const f = state.activePath ? state.files[state.activePath] : null
    if (state.activePath && f && f.status === 'ok' && !f.binary && typeof f.content === 'string') {
      setCurrentFileCtx({ path: state.activePath, content: f.content, truncated: !!f.truncated })
    } else {
      setCurrentFileCtx(null)
    }
  }, [state.activePath, state.files])

  // 树栏左缘拖拽调宽：120-320px
  const onTreeResizeStart = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = treeWidth
    const move = (ev) => {
      treeWidth = Math.min(Math.max(startW + (startX - ev.clientX), 120), 320)
      setTreeW(treeWidth)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ⤢ 加宽/还原：原生布局服务不暴露 setDetails（宽度合同 300-520 只能靠拖拽把手，
  // 而把手对合成 pointer 有保护、无法程序化拖拽），故用 CSS !important 覆盖
  // AppFrame 的网格列宽实现「加宽到上限 520」；还原 = 移除覆盖类，恢复原生内联样式。
  const [wide, setWide] = React.useState(wideOn)
  const toggleWide = () => {
    wideOn = !wideOn
    setWide(wideOn)
    if (wideOn) {
      pinMode = 'wide'
      setFramePin(520)
      return
    }
    // 还原：若极小窗口挤压仍在生效则回到挤压宽度，否则完全交还原生
    pinMode = null
    const sidebarW = sidebarRenderedWidth()
    if (window.innerWidth - sidebarW - CENTER_MIN_PX < DETAILS_MIN_PX) applySqueezeIfNeeded(sidebarW)
    else setFramePin(null)
  }

  const activeFile = state.activePath ? state.files[state.activePath] : null
  const kind = activeTab ? activeTab.kind : 'empty'
  const showSourceBtn = !!(state.activePath && isMdFile(baseName(state.activePath)) && activeFile && activeFile.status === 'ok' && !activeFile.binary)
  // ⧉ 打开 = 在系统文件管理器中打开文件所在文件夹（macOS：Finder）
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i) }
  const openFolderInSystem = () => {
    if (state.activePath && nativeOpenPath) nativeOpenPath(dirOf(state.activePath)).catch((e) => console.error('[fsviewer] openPath:', e))
  }
  const openFolderTip = /Mac/i.test(navigator.platform || navigator.userAgent) ? '在 Finder 中打开' : '在文件夹中打开'

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: V.fill,
      color: V.fg,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: V.font,
      fontSize: '13px'
    }}>
      {/* 行1：统一页签条（打开文件 | 侧边聊天 | 浏览器页签 | +菜单）… ⤢ 加宽/还原 */}
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 56, borderBottom: '1px solid ' + V.line, flex: '0 0 auto', paddingRight: 6 }}>
        <TabStrip />
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', flex: '0 0 auto' }}>
          <button type="button" onClick={toggleWide} data-tip={wide ? '恢复默认宽度' : '加宽面板（最大 520px）'} aria-label="切换加宽"
            className={'fsviewer-iconbtn fsviewer-tip' + (wide ? ' fsviewer-iconbtn--active' : '')}><IconMaximize /></button>
        </div>
      </div>
      {kind === 'chat' ? (
        <ChatPanel chatId={activeTab.id} />
      ) : kind === 'browser' ? (
        <BrowserPane tabId={activeTab.id} />
      ) : kind === 'empty' ? (
        <EmptyTabsState />
      ) : (
        <>
        {/* 行2：面包屑 … 查看源代码 / 文件夹（收展树栏）/ 打开。右边距与行1一致，文件夹与 ⤢ 右缘对齐 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 4px 10px', borderBottom: '1px solid ' + V.line, flex: '0 0 auto' }}>
          <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: V.muted }}>
            {state.root ? baseName(state.root) : '…'}
            {state.activePath ? <span><span style={{ color: V.edge }}> › </span><span style={{ color: V.fg }}>{baseName(state.activePath)}</span></span> : null}
          </span>
          {showSourceBtn
            ? <button type="button" onClick={() => dispatch({ type: 'toggleSource' })} title="切换渲染/源码视图"
              style={{ cursor: 'pointer', flex: '0 0 auto', height: 28, fontSize: 12, lineHeight: 1, padding: '0 10px', borderRadius: 6, border: '1px solid ' + V.line, background: state.sourceMode ? V.input : 'transparent', color: V.fg, display: 'inline-flex', alignItems: 'center' }}>
              {state.sourceMode ? '渲染视图' : '查看源代码'}</button>
            : null}
          <button type="button" onClick={() => setTreeOn(!treeOn)} data-tip={treeOn ? '收起文件树' : '展开文件树'} aria-label="切换文件树"
            className={'fsviewer-iconbtn fsviewer-tip' + (treeOn ? ' fsviewer-iconbtn--active' : '')}>
            <IconFolder />
          </button>
          {state.activePath
            ? <button type="button" onClick={openFolderInSystem} data-tip={openFolderTip} aria-label={openFolderTip}
              className="fsviewer-tip"
              style={{ cursor: 'pointer', flex: '0 0 auto', height: 28, fontSize: 12, lineHeight: 1, padding: '0 8px', borderRadius: 6, border: '1px solid ' + V.line, background: 'transparent', color: V.fg, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <IconFinder />打开</button>
            : null}
        </div>
        {/* 内容：左预览（无激活文件时空状态） | 右文件树栏（可拖拽调宽） */}
        <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
          {state.activePath ? <FilePreview state={state} /> : <EmptyState />}
          {treeOn ? <TreeColumn workspaces={workspaces} state={state} dispatch={dispatch} width={treeW} onResizeStart={onTreeResizeStart} tabKind={kind} /> : null}
        </div>
        </>
      )}
    </div>
  )
}

// ---------- 浏览器面板（页签内视图；多页签 iframe 常驻挂载，隐藏不卸载、切回不丢状态） ----------
// 输入归一化：补协议；域名样式的补 https；localhost 补 http；其余当搜索词
function normalizeUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/i.test(s)) return 'http://' + s
  if (/^[a-z0-9][a-z0-9.-]*(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(s)) return 'https://' + s
  return 'https://www.bing.com/search?q=' + encodeURIComponent(s)
}
function browserTitle(url) {
  if (!url) return '新标签页'
  try { return new URL(url).hostname || url } catch { return url }
}
function BrowserPane({ tabId }) {
  const [, force] = React.useState()
  React.useEffect(() => subscribeTabs(() => force({})), [])
  const active = browserById[tabId]
  if (!active) return null
  const patch = (fn) => updateBrowser(tabId, fn)
  const navigate = (raw) => {
    const url = normalizeUrl(raw)
    if (!url) return
    patch((t) => {
      const hist = t.hist.slice(0, t.idx + 1).concat(url)
      return { ...t, url, input: url, title: browserTitle(url), hist, idx: hist.length - 1 }
    })
  }
  const go = (delta) => patch((t) => {
    const idx = t.idx + delta
    if (idx < 0 || idx >= t.hist.length) return t
    return { ...t, idx, url: t.hist[idx], input: t.hist[idx], title: browserTitle(t.hist[idx]) }
  })
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* URL 行：← → ⟳ 地址栏 [直连|代理] ⧉ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px 4px 8px', borderBottom: '1px solid ' + V.line, flex: '0 0 auto' }}>
        <button type="button" onClick={() => go(-1)} disabled={active.idx <= 0} data-tip="后退" aria-label="后退"
          className="fsviewer-iconbtn fsviewer-tip" style={{ opacity: active.idx <= 0 ? 0.4 : 1 }}><IconArrowLeft /></button>
        <button type="button" onClick={() => go(1)} disabled={active.idx >= active.hist.length - 1} data-tip="前进" aria-label="前进"
          className="fsviewer-iconbtn fsviewer-tip" style={{ opacity: active.idx >= active.hist.length - 1 ? 0.4 : 1 }}><IconArrowRight /></button>
        <button type="button" onClick={() => patch((t) => ({ ...t, reload: t.reload + 1 }))} data-tip="重新加载" aria-label="重新加载"
          className="fsviewer-iconbtn fsviewer-tip"><IconReload /></button>
        <input type="text" placeholder="输入网址或搜索词，回车打开" value={active.input} spellCheck={false}
          onChange={(e) => patch((t) => ({ ...t, input: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(e.currentTarget.value) }}
          style={{ flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box', padding: '5px 8px', backgroundColor: V.input, border: '1px solid ' + V.line, borderRadius: 6, color: V.fg, fontSize: 12 }} />
        <button type="button" onClick={() => patch((t) => ({ ...t, proxy: !t.proxy, reload: t.reload + 1 }))}
          data-tip={active.proxy ? '代理模式：经主机同源回源（绕过 X-Frame-Options）' : '直连模式：部分站点会拒绝被嵌入，可切代理'}
          aria-label="切换代理模式"
          className={active.proxy ? 'fsviewer-chat-quote on' : 'fsviewer-chat-quote'}>{active.proxy ? '代理' : '直连'}</button>
        <button type="button" onClick={() => { if (active.url) window.open(active.url, '_blank', 'noopener') }}
          disabled={!active.url} data-tip="在新窗口打开" aria-label="在新窗口打开"
          className="fsviewer-iconbtn fsviewer-tip" style={{ opacity: active.url ? 1 : 0.4 }}><IconExternal /></button>
      </div>
      {/* 页面层：所有页签的 iframe 常驻，仅切换可见性（保活页面状态）。
          沙箱按模式区分：直连 = 跨源内容，放行 allow-same-origin 让页面用自己的
          storage 正常渲染（源隔离依然成立，且无 allow-top-navigation 防劫持）；
          代理 = 内容经本源服务，绝不能放行 allow-same-origin（否则代理页面获得
          本应用全部权限），代价是页面 storage 不可用（文档站为主，可接受）。 */}
      <div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>
        {tabs.filter((t) => t.kind === 'browser').map((t) => {
          const b = browserById[t.id]
          if (!b) return null
          return (
            <iframe
              key={t.id + '#' + b.reload}
              src={b.url ? (b.proxy ? '/fsviewer-api/p/' + b.url : b.url) : 'about:blank'}
              title={b.title}
              sandbox={b.proxy
                ? 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
                : 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin'}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none',
                display: t.id === tabId ? 'block' : 'none', backgroundColor: '#fff' }} />
          )
        })}
      </div>
    </div>
  )
}

// ---------- 空页签状态（全部关闭时）：大号创建入口，同 Codex 空状态 ----------
function EmptyTabsState() {
  const rows = [
    { key: 'b', icon: <IconGlobe />, label: '浏览器', hint: '⌥⌘T', act: newBrowserTab },
    { key: 'f', icon: <IconFileLine />, label: '文件', hint: '⌘P', act: ensureFilesTab },
    { key: 'c', icon: <IconChatBubble />, label: '侧边聊天', hint: '⌥⌘S', act: newChatTab }
  ]
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: '0 26px', minHeight: 0 }}>
      {rows.map((r) => (
        <button key={r.key} type="button" className="fsviewer-empty-item" onClick={r.act}>
          {r.icon}
          <span style={{ flex: '1 1 auto', textAlign: 'left' }}>{r.label}</span>
          <span className="fsviewer-plus-hint">{r.hint}</span>
        </button>
      ))}
    </div>
  )
}

// ---------- 侧边聊天：消息与输入区（UI 对齐主会话窗口：Composer 内嵌模型选择器） ----------
function ChatMessage({ m }) {
  if (m.role === 'user') return <div className="fsviewer-chat-user">{m.content}</div>
  const waiting = m.streaming && !m.content && !m.error
  return (
    <div className="fsviewer-chat-ai">
      {waiting
        ? <span style={{ color: V.muted, fontSize: 12 }}>{m.reasoning ? '思考中…' : '…'}</span>
        : (m.content ? <MarkdownText text={m.content} streaming={!!m.streaming} /> : null)}
      {m.note ? <div style={{ marginTop: 4, fontSize: 11, color: V.muted }}>ⓘ {m.note}</div> : null}
      {m.error ? <div style={{ marginTop: 4, fontSize: 12, color: '#e06c75' }}>⚠ {m.error}</div> : null}
    </div>
  )
}
function ChatPanel({ chatId }) {
  hydrateTabs()
  const [, force] = React.useState()
  React.useEffect(() => subscribeTabs(() => force({})), [])
  const chat = getChat(chatId)
  const fileCtx = useCurrentFileCtx()
  const [quote, setQuote] = React.useState(false)
  const [text, setText] = React.useState('')
  const endRef = React.useRef(null)
  const modelBtnRef = React.useRef(null)
  const taRef = React.useRef(null)
  const [modelMenu, setModelMenu] = React.useState(null)   // { left, bottom } | null
  const [models, setModels] = React.useState(modelsCache)
  // 输入随内容自动长高（对齐主会话）；空文本时清掉 inline 高度回到单行
  const autoGrow = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }
  React.useEffect(() => {
    const el = taRef.current
    if (!el) return
    if (!text) { el.style.height = ''; return }
    autoGrow(el)
  }, [text])
  // 消息尾部增长时贴底滚动（新消息/增量都触发）
  const tail = chat.messages[chat.messages.length - 1]
  const tailLen = tail ? tail.content.length + (tail.reasoning ? tail.reasoning.length : 0) : 0
  React.useEffect(() => {
    const el = endRef.current
    if (el) el.scrollIntoView({ block: 'end' })
  }, [chat.messages.length, tailLen, chat.streaming])
  const effectiveModel = chat.model || (modelsCache && modelsCache.default) || null
  const modelLabel = effectiveModel ? effectiveModel.model : '默认模型'
  const toggleModelMenu = () => {
    if (modelMenu) return setModelMenu(null)
    const r = modelBtnRef.current.getBoundingClientRect()
    setModelMenu({ left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 260)), bottom: window.innerHeight - r.top + 6 })
    loadModels().then((d) => setModels(d)).catch(() => setModels({ providers: [], default: null }))
  }
  const pickModel = (m) => {
    updateChat(chatId, (cur) => { cur.model = m; return cur })
    setModelMenu(null)
  }
  const submit = () => {
    const t = text
    if (!t.trim() || chat.streaming) return
    setText('')
    const quoted = quote && fileCtx && !fileCtx.binary
      ? { path: fileCtx.path, content: fileCtx.content, truncated: fileCtx.truncated }
      : null
    if (quote) setQuote(false)
    sendChat(chatId, t, quoted)
  }
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, fontFamily: V.font }}>
      {/* 消息列表 */}
      <div className="fsviewer-chat-scroll">
        {chat.messages.length === 0
          ? (
            <div style={{ margin: 'auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', color: V.muted }}>
              <IconChatPlus size={40} />
              <div style={{ fontSize: 16, fontWeight: 600, color: V.fg }}>侧边聊天</div>
              <div style={{ fontSize: 13 }}>侧边聊天是临时聊天，关闭应用后会消失。</div>
            </div>
          )
          : chat.messages.map((m, i) => <ChatMessage key={i} m={m} />)}
        <div ref={endRef} />
      </div>
      {/* Composer（对齐主会话窗口：与主会话卡片同款主题变量，深浅主题自适应） */}
      <div style={{ padding: '8px 10px 10px', flex: '0 0 auto' }}>
        <div style={{
          border: '1px solid var(--dsw-alias-border-l2-darkmode-thin)',
          borderRadius: 22,
          background: 'var(--dsw-specific-input-major)',
          boxShadow: 'var(--dsw-shadow-lv2)',
          padding: '2px 10px 6px'
        }}>
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            onChange={(e) => { setText(e.target.value); autoGrow(e.target) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', resize: 'none', border: 'none', outline: 'none', background: 'transparent', padding: '10px 6px 0', overflow: 'hidden', color: V.fg, fontSize: 13.5, lineHeight: 1.45, fontFamily: V.font }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 2px 0' }}>
            {fileCtx
              ? (
                <button type="button" className={'fsviewer-chat-quote' + (quote ? ' on' : '')}
                  title={'引用文件内容作为上下文：' + fileCtx.path}
                  onClick={() => setQuote(!quote)}>
                  📎 {baseName(fileCtx.path)}
                </button>
              )
              : null}
            <span style={{ flex: '1 1 auto' }} />
            <button type="button" ref={modelBtnRef} onClick={toggleModelMenu}
              className="fsviewer-chat-quote" title="选择模型"
              style={{ maxWidth: 170 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{modelLabel}</span>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: '0 0 auto' }}>
                <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" onClick={chat.streaming ? () => stopChat(chatId) : submit}
              disabled={!chat.streaming && !text.trim()}
              title={chat.streaming ? '停止生成' : '发送'}
              style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', flex: '0 0 auto',
                cursor: chat.streaming || text.trim() ? 'pointer' : 'default',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: chat.streaming ? 'var(--dsw-alias-interactive-bg-active)' : (text.trim() ? V.accent : 'var(--dsw-alias-interactive-bg-hover)'),
                color: chat.streaming || text.trim() ? '#fff' : 'var(--dsw-alias-label-secondary)' }}>
              {chat.streaming
                ? <span style={{ width: 9, height: 9, borderRadius: 2, background: 'currentColor', display: 'block' }} />
                : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 13V3.5M8 3.5 3.8 7.7M8 3.5l4.2 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
            </button>
          </div>
        </div>
      </div>
      {/* 模型选择菜单（向上弹出） */}
      {modelMenu
        ? (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setModelMenu(null)} />
            <div className="fsviewer-plus-menu" style={{ left: modelMenu.left, bottom: modelMenu.bottom, top: 'auto', maxHeight: 340, overflowY: 'auto', minWidth: 240 }}>
              <div style={{ padding: '6px 10px 4px', fontSize: 11, color: V.muted }}>模型</div>
              <button type="button" className="fsviewer-plus-item" onClick={() => pickModel(null)}>
                <span style={{ flex: '1 1 auto', textAlign: 'left' }}>默认模型（跟随 dsh 设置）</span>
                {!chat.model ? <span style={{ color: V.accent }}>✓</span> : null}
              </button>
              {(models ? models.providers : []).map((p) => (
                <React.Fragment key={p.id}>
                  <div style={{ padding: '6px 10px 2px', fontSize: 11, color: V.muted }}>{p.name}</div>
                  {p.models.length
                    ? p.models.map((m) => {
                      const on = chat.model && chat.model.provider === p.id && chat.model.model === m.id
                      return (
                        <button key={m.id} type="button" className="fsviewer-plus-item" onClick={() => pickModel({ provider: p.id, model: m.id })}>
                          <span style={{ flex: '1 1 auto', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                          {on ? <span style={{ color: V.accent }}>✓</span> : null}
                        </button>
                      )
                    })
                    : <div style={{ padding: '2px 10px 6px', fontSize: 11, color: V.muted }}>（无可用模型）</div>}
                </React.Fragment>
              ))}
              {models && !models.providers.length
                ? <div style={{ padding: '6px 10px 8px', fontSize: 12, color: V.muted }}>未发现可用 provider，请先在 dsh 设置中配置模型</div>
                : null}
              {!models
                ? <div style={{ padding: '6px 10px 8px', fontSize: 12, color: V.muted }}>⏳ 加载模型目录…</div>
                : null}
            </div>
          </>
        )
        : null}
    </div>
  )
}
// ---------- 快捷键（dsh 无原生快捷键注册 API，自行 DOM 监听） ----------
// 用 e.code 而非 e.key：macOS ⌥ 组合会把 key 变成特殊字符（⌥S -> 'ß'）。
// ⌥⌘S = 最近聊天页签（无则新建，Codex 同键）；⌥⌘T = 新建浏览器页签；⌘P = 打开文件页签。
function installShortcuts() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey || e.ctrlKey || e.shiftKey) return
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault()
      openPanelWithRoom()
      activateLatestChat()
    } else if (e.altKey && e.code === 'KeyT') {
      e.preventDefault()
      openPanelWithRoom()
      newBrowserTab()
    } else if (!e.altKey && e.code === 'KeyP') {
      e.preventDefault()
      openPanelWithRoom()
      ensureFilesTab()
    }
  })
}

// ---------- 插件契约 ----------
export const inject = ['slots', 'workspaces', 'sessions', 'layout']

export function apply(ctx) {
  injectToggleStyle()
  // 捕获布局服务：顶部按钮开/收原生右栏
  layoutApi = ctx.layout || null
  // 拦截系统打开：会话内点击文件引用改道到插件预览（保留原生打开供面板 ⧉ 使用）。
  // 引用路径不带类型标记，先探测：list 接口对目录返回 200、对文件返回 400「不是目录」——
  // 目录 → 面板树定位到该目录（如「在文件夹中显示」）；文件 → 预览；
  // 探测失败（404/500/主机未就绪）→ 保持原生行为。尾斜杠路径保持原生。
  if (ctx.workspaces && typeof ctx.workspaces.openPath === 'function') {
    nativeOpenPath = ctx.workspaces.openPath.bind(ctx.workspaces)
    ctx.workspaces.openPath = (path) => {
      if (typeof path === 'string' && path.length > 0 && !path.endsWith('/')) {
        fetchList(path).then(
          () => openDirInPanel(path),
          (e) => {
            if (e && e.message && e.message.includes('不是目录')) openFileInPanel(path)
            else if (nativeOpenPath) return nativeOpenPath(path)
          }
        )
        return Promise.resolve()
      }
      return nativeOpenPath(path)
    }
  }
  // 顶部切换按钮：会话头 utilities 区，位于 session log 导出按钮右边（order 更大）。
  // 工厂透传 props，组件才能拿到 sessionId（session 作用域）
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      { name: 'conversation.session.header.utilities', id: 'fsviewer-toggle', order: 50, label: '文件管理器' },
      (props) => React.createElement(FsToggleButton, props)
    )
  )
  // 文件面板：直接接管原生 details 右栏（影子注册）。single 槽位同优先级冲突，
  // 不同优先级影子共存——conversation 的工具详情面板未传 priority（=0），
  // 本插件用 -10（更低者优先渲染）接管该栏；本插件停用后原生工具详情自动恢复。
  // 面板内容全部收敛为统一页签：文件页签 | 侧边聊天（常驻）| 浏览器页签 + 新建。
  ctx.slots.inject('details', () =>
    ctx.slots.register(
      { name: 'details', id: 'fsviewer-panel', priority: -10 },
      () => React.createElement(
        PanelErrorBoundary,
        null,
        React.createElement(FileTreePanel, { workspaces: ctx.workspaces, sessions: ctx.sessions })
      )
    )
  )
  installShortcuts()
  console.log('[fsviewer] Client plugin loaded (details takeover: unified tabs — files / browser tabs / side chat)')
}
