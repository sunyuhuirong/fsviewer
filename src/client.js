/**
 * fsviewer - 客户端插件（目录树 + Markdown 文件预览）
 *
 * 停靠式文件面板（Codex 式，左预览右树）：
 *   - 顶部按钮挂在 conversation.session.header.utilities（session log 导出按钮右边），
 *     图标为「右侧栏」内联 SVG（圆角方框 + 靠右竖线），随主题着色。
 *   - 打开时借原生右栏（ctx.layout openDetails）推挤内容，面板从右侧滑入停靠；
 *     顶部按钮「钉」在视口原位不动（fixed 定位，成为面板右上角的常驻开关），
 *     再次点击即收起。面板左缘可拖拽调宽，⤢ 全宽切换。
 *   - 面包屑行的文件夹图标收起/展开右侧文件树；无文件时显示「打开文件」空状态。
 *   - 切换会话时自动收起。
 *
 * 数据来源：
 *   - 目录列表（含文件）：主机半边注册的 GET /fsviewer-api/list（webServer 路由）
 *   - 文件内容：GET /fsviewer-api/file（1MB 上限，二进制不回传）
 *   - workspaces.list 仅用于解析默认根目录；选择目录 / 系统打开继续用 workspaces
 *
 * 预览：
 *   - .md 文件用官方聊天同款 MarkdownText 渲染（可切「源码」）
 *   - 其他文本文件显示源码；二进制/超大文件给出提示 + 系统打开入口
 *   - 已打开文件以小页签呈现，可切换/关闭
 *
 * 插件契约：exports.inject = ["slots", "workspaces", "layout"]。
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
  if (panelFileDispatch) panelFileDispatch(path)
  else if (nativeOpenPath) nativeOpenPath(path)
}
// 目录引用点击（如「在文件夹中显示」）：面板树直接定位到该目录
function openDirInPanel(path) {
  openPanelWithRoom()
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
    'pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.18)}'
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
const V = {
  fill: 'var(--dsw-specific-sidebar-fill)',
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
    tabs: [],             // 已打开文件 [{ path, name }]（打开顺序）
    activePath: null,     // 当前预览文件（null = 空状态）
    files: {},            // path -> { status:'loading'|'ok'|'err', content?, size?, truncated?, binary?, error? }
    sourceMode: false     // md：false=渲染视图，true=源码
  }
}
function openFileState(state, path) {
  const name = baseName(path)
  const tabs = state.tabs.some((t) => t.path === path)
    ? state.tabs
    : [...state.tabs, { path, name }]
  const files = state.files[path]
    ? state.files
    : { ...state.files, [path]: { status: 'loading' } }
  return { ...state, tabs, activePath: path, files, sourceMode: false }
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
    case 'openFile':
      return openFileState(state, action.path)
    case 'activateTab':
      return { ...state, activePath: action.path, sourceMode: false }
    case 'closeTab': {
      const tabs = state.tabs.filter((t) => t.path !== action.path)
      const files = { ...state.files }
      delete files[action.path]
      if (state.activePath !== action.path) return { ...state, tabs, files }
      const last = tabs[tabs.length - 1]
      return last
        ? { ...state, tabs, files, activePath: last.path }
        : { ...state, tabs, files, activePath: null }
    }
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

// ---------- 文件行（彩色类型徽章；点击打开预览；激活文件高亮） ----------
function FileRow({ entry, depth, active, onOpen }) {
  const badge = fileBadge(entry.name)
  return (
    <div className="fsviewer-row" style={{ paddingLeft: 20 + depth * 14, ...(active ? { backgroundColor: 'var(--dsw-alias-interactive-bg-active)' } : null) }}
      onClick={onOpen} title={entry.path}>
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
const FINDER_ICON_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAeGVYSWZNTQAqAAAACAAEARoABQAAAAEAAAA+ARsABQAAAAEAAABGASgAAwAAAAEAAgAAh2kABAAAAAEAAABOAAAAAAAAAJAAAAABAAAAkAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAACU3PoRAAAACXBIWXMAABYlAAAWJQFJUiTwAAACnGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iPgogICAgICAgICA8dGlmZjpYUmVzb2x1dGlvbj4xNDQ8L3RpZmY6WFJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjE0NDwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6UmVzb2x1dGlvblVuaXQ+MjwvdGlmZjpSZXNvbHV0aW9uVW5pdD4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjI1NjwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOlBpeGVsWERpbWVuc2lvbj4yNTY8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpDb2xvclNwYWNlPjE8L2V4aWY6Q29sb3JTcGFjZT4KICAgICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+Cun+yXEAABBLSURBVHgB7VppbF3FFT73vs3P73mLYye2MZCFEMgKBAhbA5RFAdQqrCItCKJCJRBUqQJClaAtoqVFwI+yCEQpCChVU0AlUqGgQktoEEVJSQMxSSAhchavcbz77bffN/fO8/XzvX62Y/60PvK8We7MmXO+c+bM3LkWmaZpBKYRmEZgGoH/XwSMyapuiZg/eWtjdcfCpXUDEp2VisXLU2KWZgwJ5XJGIGuIkQbzLFIOPyyrlHNytPFZku1sc/pkUcafZPmQxAopK5YYFlrNlKQzQzLY3yuJoTZp3tEi667vRA+INHGaCADsa/1syzu1TYvOvbrFKrmyK2Eu7UubNYmMRKG4UsiCGJQknxyx3HXqxH4k1Y4fdz0/2O5id8p3dgYRIEOGxMh1SDC3Q1KJv8iOj96Qmy9vV0+GR3GkL40XAIOC3tLTs3ZnJv7A1wPmgqO9MM4QGjNI2kq+00zhA7fELAeQwkghJCO3R5L9D8ppFa+iRnJgtitev6ZXY0Gb8Zu7VofXHOl/9P2+8le2NpsLjhyAzj3oRZ/mFBTkWBNY5C1Pnn6JYCsXcvrQAINIlGfQXCDB8ldke/+jsno1YXHDhepoKtbB2IhF9+qR/ke2JGI/7mgGA05ebNToecZuAc/GUpFlMZE4LQoqNB3rGfwMoG9bSqQ5IdKFXHV0m5GyVSAlBh6X0+P3oqThQnE0jaUKn1lrD7fdtNmqfekglS+UajS/Cbdwba0/XuTeOpFZjvLFmDBwtsD7PuwT+W2byOajzgitDfM4Um/7zXLerJdRUro4vUZkY01p3P76y3Wfn3DWS7tazSoh2lNNsM0PGkSeBABxtxWLzBPE80pIviwqsrZGpKZEZAuWQMq9c9BY0ZJlsmTxRnnrTwN+LMea1jp61iXXfD0UmCtAWjkSJ5iqhLVbBiXugeWPhSIYfDdAeHEh+FEbHZSxRBAh58qSC65Fwdd3/QAwrkNsbTMrr+qme02V0m4+EHQF3HQ+NXARJfVLrm6jildj3f90LnzdPQfXSqTyKvz6BkQ/AKT68YdqutOhRdl+DKdEDCVTnC6vQoQFW02avRcA+pk7Zz83rasVWQmeI7wgF1ok6x+Cj3iTe353DyuxdGV9f9KsUWvfPesUlUOY+WIK61CeLbTKeSQelArbtbE1EFUIdd+rB0M2kCG36Sx0OGWlbkXDSGI88aREWXVtMm1EFJo6unr2nEQjBDy5TORUbH0kt/Ksa4VYHpPQUYV3/DCas7wSS6ESh6JuHbQt6ABd/Ph4AaB4ZqOxijQlGbc0flN4tGP9XwjrxzATlacl80foCc5ngAcFJhGEWVjt9Ygr3Tylav+GLnzuRV4AqH7ZYDiaUy6Eqp7Bi8Mk2y6rtgfm3RiK53XPF4owp/JOX8sBIoJ8Jo/FClXkfG6GsWF6ky8AuawVztE84xWG/AkUEycnsVxI4FmPE98K2ETjm8Uc2gMKu7MehGkpRpZHQZpcE6tOWQNAo6vTJGXnQ6WDSUhIbCGrPI0BgBHIL049S36YRwF9jN5uMQa6JFc7d7hD4ViAcw7cvxYzc5fSwU1JNUI0mwX13X+gHQEwJ431s/JvjZqtVlzxcRqVtm4Asmp1DMvkKulV4mqyi1YOU5PJeBOEn/HB81L93O0i7a1jjrvc2ZTImkalBzB5TZVIZ+TnDz8rP7rnYRkYSkoWW4G7rx6rlxJ5mOCVZ8ayZfnq6e8BHKcl0nCjzZfQNwDrp/qO4o0FR8eq2XZX99QQJg7znDtD8CJvK6+2Ns7jRZg3kcpIV3ePdHZ2Sd9QQsxQWEzTto0eQvHoAXRwxUoDwAd+vJ3BvgDkESQDMhoHWQy79FmahUdSt/IcDzMtnylyArY/7lKF7k93dhMDHAGiwoZpSgbXRRkMCiAZmEcFQIzhMOpMUvryRyvOB7rMDgXkCwCvsfIgFAhWwMOuok8uBbXSSG4B3J3B89vYkbldKTd2FKT0SgH1MzxAYQn1EgncgqXTKrZmlamhtNOXOcVTdZRxFWcz00rrfJjtiJIvALyb4w2cUmacAHSf+C0xMtiEK+rtce6pIByj+UUAgO6v7v4wh9ppUFf6qB/3IFz0RMKyatXZACEhJaWlahw1JjgqtzNcBtmF3FQBoAQjU4cxSmMT0V9+pcgSJPotlWHieBLyeeU4AWL7GwKwjC+cgwZ1jGr3K/jls3W3rUVfuH8mKznDhN7Q0uFPIBws1Bw5LjvOyURivzHI1wO4BCYUBDkJJ+WEyjxOWQuAmLAK1i+FF3TxAIC+eQBQ9ScDa99SIBlmAOxR1zwxSC0Bhh6UCRZFUMuB3kty9bUbRv76AjDhJTCSrz1xweQXY2MYdBSn8nQUCljQzaPBtrHq54xRGmO4egJeekkwtiiGCgmUkWunQG0U+QIw4SA4irWrAULU4vR3Go6/A/AEvf6V60NgpRi6M6dC4yJnkAIAP1gZSlnlVVTeAYDewIMRD11e5AsAP1ZMKAh6cddtUPpsbH9ViI8dvKmBUNr9dRd37uhmN42oOL0clDRYCgTKi8cEVS0BBwA2TgoAvghNGQAQ5mJsDEnkamkpSUfq5/YGKsQuvkQl8VD3ofvjqKDqeeUdAEzkvlYGD99nygPIhMGEsx0LYfyCSpF+un9e6mGGakdAO0FQQAw/GldJAYAlwCOwOgZzDicIEpCCW7cRPH0BUC5KJg6SI0ZNtAI+29pFTsI7gLKQM55y4qiv8FU7JxomCoKyDX4YApiClFcntqOsXo7Q7EW+APBjpUJxKgAAq4c/FtnRgWMwzgHKXaFsFLOvWWBfZxOAfFwgEF7SerTR+gSVYvKESYXVYEdu5QEKJY/BaPIFIAfLTFkMwER4kZPXPnMJAaFjuKa4ag6ER1nvDHprdPUcu0gA0IPWJ2j5JeAAoDyAyPiQLwA4etvr0WHkM35izZRSE6SNoE6Xz2AODcAxLwGiQJk1AKj7Koluvs8K91Mt96hcK+UEnXEHTEdQZgQAp1z7eMwGHyI4AUiMF0PJOAZSSwAuQDGYKLeKMxoA5JOKAVlOQEEcRiyOIoTv+K5NuNoKS/KkK4Yf0yeLEZmDN5Wi9cfjAUFo8uUXe2Xfl3tl5aoLJBq1r/p4CNI7APm4PYBgTAoAWqUoADBDRdNGMVq2S0d3qySX3woTOdoXA4HMkdQSgPXpAXonsCd2IQheAazjzz9tkrdef0MOHTws8xctlrp6fBSEy1F5vgQpD3D4asOpc4D2ThdLXfRdAvQAm6OaQ/cfmZsRaVm+QSqObpAZn/xa+vsOS98Zd+HaB6GekxIEPyAoKECmwdQSYJmgsx2kcioOrdK4Fdr+8cfy4Tt/lba2Drni+hukYsZMSeKwEgAyVJyWVkCQocObc7NtUh6AW2EQmJHhGErk6k6X7kuekfiH90t85wsS6WqSnmV3SPq48xBhMJDjSYU8HN6cg26rYgDKehfgOqciB5sPytbNf5cdn3yCSyZTrr5lnZy6/DTVX70BcQr0Y3/mBDH/HoNn9AC8Q+KJN/l6QCaFTZDQUYFC4d28MKtVvUD6Ln1GktuelLKvNkrNP+6W5ImXSd+8ayRVswyfJvG1QovAnPyQ8xKDolF5tXbZjGdpfJHpaj8su/+zTXZu+5e0HmqRhnkL5dI118ms+gYcniwJBoNQ2FSBU58rGAsUP2zhWm56QNDe0NE4mnwBgAek1V1qMQCoDaGP4l8IzrlfuhoukpLPn5PY7k1S2/yeZGafLoN1F0iiepmkY8eJFcY3MYZyEK3F4UkoPNifkN7uI9JxqFmav9qlUmd7h8QqZ8pFa9bK4hUrgWNI/fdYANGQ9wI8VvNrMG+B6AFcBuQ5iFs57XkBGwAuaE/yBcBKpIaKxoA8S0iAiTirdfz5MjT7DEkc2CLhvW9K9OA2iR34SCqjUDxeL9l4nVjRGjHCMRyEwvK7J4LSP5SW/t4e6T3aKX09PVDMlBmzGuW8K2+Qk5etkHhZOSzNSxHcBmHNW3AT/Cueml1vg7SBWgYAoMv1RTtEALLQxSYlpVNWmR8ARqavt1d9VeeQUcPcLNxl+iDqwYhYcy6RZOOFkuzeL71t/5Zgx3YJ9u+TcM8u/CPhpxI2s5LC0tiyr1pKKmZIaXmVlFc3ytzlF0rjnIVSU3echCMlUDanlDVxG8SXfiqvX6ioPIm58gBMn4StDx5FoyMzFp8Y1AXZcCtKDnkBwKGm1dvaIVVWEv411suU5lOQO4uRUlXNk1zVfEmddK2k0oNwT8iS7MPlaUIqSw355Y1V0jVYIiF8vguGI1AEY9TaYIYtLoBARMUxA+OE0gI/zEluDyjHsWAf/mWyswcPePzFoKhhJQMD0MUZinwEeQHADoa1+4MWOW412AUb9HoaMbJohSI6kjIyQS/hN8oQUmw2LImnAODEOXBnfEhKpejisDbWNO/+eO9P7diPKa+xMy8fk1Q38Cb7KnxveGoz+jtbMD7uSXko25logi6jOHC0Pc4uFfwm3n+sI5hNNikkGawmkyg4k5IeIlIi5cq2cglGf0Rs7vUGP37gORPFoqvznoBWV4l9UVbbnNPGdc86/622AfcNW/fjP8b2ONOBbwznpMpQsmn784/RAzyJwHkRxU4EB9veDrIHJjnmpMHQgMB0gwlDDnRBSFiOSmhrU3EmraxfzjEE4Xh8ajuCr3GPvGuPUaBjfD3OY2XJtrcPQxdooGZGPoL8AKDKgeDW594MZ9P7ub8eMwDk6JFe/AiCwnqliFZUiAHOnZSV0Za3NngQEIo0IyZyCm6a98DBN7yG6A8QFIFPCaw/N57e3/XPF/6MNnb3BMBZSfa4gl/lixXrd96aKj/12eSAH4uCUROs8t7hO8vx8QMHRwqTRJ3KegnG9c7lwkRvOQjv2bRD5G+77Trjp9IS/c6cj/9ACzT98NXbFr0AtoQesIwmr3ncvbiLRMrva/lVKjL7jtQ3CEINvhotbbADGU92hUTFaHn8Z7p0Yp/nVneI0R5tBkI5h6hgCRCWzEUqa336nZvq7kMUp/tj1MQ9AGOU64SkrCFefufWB9NhgICbHYvspphodWUjZcIxmFNTJ3FpasWpPD4dyuJG3D3GWp/e9osVD+zadYhHIp4C6QGexPHFCNOot4KSivWf3ZitWLAhnQvPY/RW/0Pky9qxSBHuxfT1thuYOiDglUDi2FnrEAjnVKX2Vg3tefT3ty/5A3rQ8mMqT9HGAwD7aRDMyPl3Npacedd3rdjsy7JG9JSchKqxZZXwJSZPKCv5mDtlujXLzN1lVPN1/ZxtehxzMqMAui9jQAiVaMhKxCPpI2WhoS9K063vtr/7xJvv/fGpZnQlrkWVR59xA6D7MjDqw1Np2Yrv11hz8MUvVldrlFaUG8Eozq5myMK5Fe9qJgXlts8BDFD850jm3FpZ5udylgufqeiLHzxSz+zczJlmDp//c2kjM5Swhnp6M70t7V0732/dsukV7vODSFScwY6pqHOhz4QAYH8SDaFkdMqsF5JXW2GfydTdSrHMeZgzcTGOW3H0VXQsguqxOidDd9me4Zv5LQTCXf9mZpzmOo3ANAL/kwj8F4qOcaGcJiOEAAAAAElFTkSuQmCC'
function IconFinder() {
  return <img src={FINDER_ICON_SRC} width={18} height={18} alt="" draggable={false} style={{ display: 'block', borderRadius: 4.5 }} />
}
// ---------- 空状态（未打开任何文件时，预览区居中提示，同 Codex） ----------
function EmptyState() {
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)' }}>
      <svg width="44" height="44" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z" stroke="currentColor" strokeLinejoin="round" />
      </svg>
      <div style={{ fontSize: 15, fontWeight: 600, color: V.fg }}>打开文件</div>
      <div style={{ fontSize: 12 }}>从工作区目录树中选择文件</div>
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
function TreeColumn({ workspaces, state, dispatch, width, onResizeStart }) {
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
          <FileRow key={entry.path} entry={entry} depth={depth}
            active={entry.path === state.activePath}
            onOpen={() => dispatch({ type: 'openFile', path: entry.path })} />
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

// ---------- 页签条（Codex 式：面板左上角；无文件时显示「打开文件」伪页签，× 关闭面板） ----------
function TabStrip({ state, dispatch, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 auto', minWidth: 0, overflowX: 'auto', padding: '6px 0 6px 8px' }}>
      {state.tabs.length === 0
        ? (
          <span className="fsviewer-tab fsviewer-tab--active" title="未打开文件">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>打开文件</span>
            <span onClick={(e) => { e.stopPropagation(); onClose() }} title="关闭面板" style={{ opacity: 0.7, padding: '0 1px' }}>×</span>
          </span>
        )
        : state.tabs.map((tab) => (
          <span key={tab.path}
            className={'fsviewer-tab' + (tab.path === state.activePath ? ' fsviewer-tab--active' : '')}
            onClick={() => dispatch({ type: 'activateTab', path: tab.path })}
            title={tab.path}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.name}</span>
            <span onClick={(e) => { e.stopPropagation(); dispatch({ type: 'closeTab', path: tab.path }) }}
              title="关闭页签" style={{ opacity: 0.7, padding: '0 1px' }}>×</span>
          </span>
        ))}
      <span className="fsviewer-tab" title="筛选文件" onClick={() => { const el = document.getElementById('fsviewer-filter'); if (el) el.focus() }}>+</span>
    </div>
  )
}

// ---------- 主面板（渲染在原生 details 右栏内：左预览 + 右树栏，顶部双栏） ----------
function FileTreePanel({ workspaces, sessions }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initState)

  // 注册程序化打开入口：会话内点击文件引用经此在面板中预览
  React.useEffect(() => {
    panelFileDispatch = (p) => dispatch({ type: 'openFile', path: p })
    panelDirDispatch = (p) => dispatch({ type: 'gotoRoot', root: p })
    return () => { panelFileDispatch = null; panelDirDispatch = null }
  }, [dispatch])
  // 右栏可见性：原生列收起时宽度为 0（仍挂载）——宽度 > 80px 视为展开，才加载数据
  const [visible, setVisible] = React.useState(false)
  // 树栏宽度（模块级记忆）；树栏开关
  const [treeW, setTreeW] = React.useState(treeWidth)
  const [treeOn, setTreeOn] = React.useState(true)

  // 空状态伪页签的 ×：收起面板（收起原生右栏）
  const onClose = () => closePanel()

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

  // 当前激活文件处于 loading -> 拉取内容（迟到的旧响应丢弃）
  React.useEffect(() => {
    const path = state.activePath
    if (!path || !state.files[path] || state.files[path].status !== 'loading') return
    let alive = true
    fetchFile(path).then(
      (f) => { if (alive) dispatch({ type: 'fileOk', path, content: f.content, size: f.size, truncated: !!f.truncated, binary: !!f.binary }) },
      (e) => { if (alive) dispatch({ type: 'fileErr', path, error: humanError(e) }) }
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {/* 行1：页签（无文件时「打开文件」伪页签，× 收起面板）… ⤢ 加宽/还原（原生 360⇄520 上限） */}
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 56, borderBottom: '1px solid ' + V.line, flex: '0 0 auto', paddingRight: 6 }}>
        <TabStrip state={state} dispatch={dispatch} onClose={onClose} />
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', flex: '0 0 auto' }}>
          <button type="button" onClick={toggleWide} data-tip={wide ? '恢复默认宽度' : '加宽面板（最大 520px）'} aria-label="切换加宽"
            className={'fsviewer-iconbtn fsviewer-tip' + (wide ? ' fsviewer-iconbtn--active' : '')}><IconMaximize /></button>
        </div>
      </div>
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
        {treeOn ? <TreeColumn workspaces={workspaces} state={state} dispatch={dispatch} width={treeW} onResizeStart={onTreeResizeStart} /> : null}
      </div>
    </div>
  )
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
  console.log('[fsviewer] Client plugin loaded (native details column takeover: preview + tree)')
}
