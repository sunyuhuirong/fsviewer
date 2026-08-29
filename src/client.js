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
function openFileInPanel(path) {
  setPanelOpen(true)
  if (layoutApi) layoutApi.openDetails()
  if (panelFileDispatch) panelFileDispatch(path)
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
  setPanelOpen(true)
  if (layoutApi) layoutApi.openDetails()
}
function closePanel() {
  if (!panelOpen) return
  setPanelOpen(false)
  // 收起时解除 ⤢ 展开覆盖，恢复原生宽度
  wideOn = false
  setExpandedFrame(false)
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
    '.fsviewer-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:120px;' +
    'padding:2px 6px;border-radius:6px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary);' +
    'background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap}' +
    '.fsviewer-tab--active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}' +
    '.fsv-expanded-frame{grid-template-columns:var(--fsv-grid, 280px minmax(0,1fr) 360px) !important}' +
    '.fsv-expanded-frame [class*="handle"]{display:none !important}'
  document.head.appendChild(tag)
}

// ---------- 样式常量 ----------
// 面板渲染在原生 details 右栏内（宽度由原生列决定，用户可拖拽 300-520px）；
// 树栏默认 150px，左缘可拖拽调宽（120-320px）
const TREE_DEFAULT_WIDTH = 150
let treeWidth = TREE_DEFAULT_WIDTH
const Z_TRIGGER = 301
// ⤢ 展开：覆盖 AppFrame 网格列宽（!important 压过内联样式），把右栏加宽到原生上限 520
const EXPAND_CLASS = 'fsv-expanded-frame'
let wideOn = false
function setExpandedFrame(on) {
  const col = document.querySelector('[class*="detailsCol"]')
  const frame = col && col.parentElement
  if (!frame) return
  if (on) {
    const cur = frame.style.gridTemplateColumns || getComputedStyle(frame).gridTemplateColumns
    const parts = cur.split(' ')
    if (parts.length >= 3) parts[parts.length - 1] = '520px'
    frame.style.setProperty('--fsv-grid', parts.join(' '))
    frame.classList.add(EXPAND_CLASS)
  } else {
    frame.classList.remove(EXPAND_CLASS)
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

// ---------- 顶部切换按钮图标：右侧栏（用户指定图标的水平镜像） ----------
function SidebarRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"
        stroke="currentColor" strokeWidth="1.5" />
      {/* 竖线靠右 = 原图（靠左）的水平镜像，表示「右侧栏」 */}
      <line x1="12.75" y1="3.75" x2="12.75" y2="16.25"
        stroke="currentColor" strokeWidth="1.5" />
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

// ---------- 图标（Codex 风格单色线性图标） ----------
function IconMaximize15() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconCopy15() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" />
      <path d="M10.5 3.5h-6a1 1 0 0 0-1 1v6" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}
function IconFolder15() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z" stroke="currentColor" strokeLinejoin="round" />
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
          style={{ cursor: 'pointer', flex: '0 0 auto', color: V.muted, background: 'transparent', border: 'none', padding: 4, display: 'inline-flex' }}>
          <IconCopy15 />
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
    return () => { panelFileDispatch = null }
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
    setExpandedFrame(wideOn)
  }

  const activeFile = state.activePath ? state.files[state.activePath] : null
  const showSourceBtn = !!(state.activePath && isMdFile(baseName(state.activePath)) && activeFile && activeFile.status === 'ok' && !activeFile.binary)
  const openFileInSystem = () => { if (state.activePath && nativeOpenPath) nativeOpenPath(state.activePath).catch((e) => console.error('[fsviewer] openPath:', e)) }

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
          <button type="button" onClick={toggleWide} title={wide ? '恢复默认宽度' : '加宽面板（最大 520px）'} aria-label="切换加宽"
            className={'fsviewer-iconbtn' + (wide ? ' fsviewer-iconbtn--active' : '')}><IconMaximize15 /></button>
        </div>
      </div>
      {/* 行2：面包屑 … 查看源代码 / 文件夹（收展树栏）/ 打开 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 20px 5px 10px', borderBottom: '1px solid ' + V.line, flex: '0 0 auto' }}>
        <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: V.muted }}>
          {state.root ? baseName(state.root) : '…'}
          {state.activePath ? <span><span style={{ color: V.edge }}> › </span><span style={{ color: V.fg }}>{baseName(state.activePath)}</span></span> : null}
        </span>
        {showSourceBtn
          ? <button type="button" onClick={() => dispatch({ type: 'toggleSource' })} title="切换渲染/源码视图"
            style={{ cursor: 'pointer', flex: '0 0 auto', fontSize: 12, padding: '3px 10px', borderRadius: 6, border: '1px solid ' + V.line, background: state.sourceMode ? V.input : 'transparent', color: V.fg }}>
            {state.sourceMode ? '渲染视图' : '查看源代码'}</button>
          : null}
        <button type="button" onClick={() => setTreeOn(!treeOn)} title={treeOn ? '收起文件树' : '展开文件树'} aria-label="切换文件树"
          style={{ cursor: 'pointer', flex: '0 0 auto', color: treeOn ? V.fg : V.muted, background: treeOn ? 'var(--dsw-alias-interactive-bg-active)' : 'transparent', border: '1px solid ' + V.line, borderRadius: 6, padding: 4, display: 'inline-flex' }}>
          <IconFolder15 />
        </button>
        {state.activePath
          ? <button type="button" onClick={openFileInSystem} title="用系统默认应用打开此文件"
            style={{ cursor: 'pointer', flex: '0 0 auto', fontSize: 12, padding: '3px 12px', borderRadius: 6, border: 'none', background: V.accent, color: '#fff' }}>
            ⧉ 打开</button>
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
  // 目录（尾斜杠）与插件未就绪时保持原生行为。
  if (ctx.workspaces && typeof ctx.workspaces.openPath === 'function') {
    nativeOpenPath = ctx.workspaces.openPath.bind(ctx.workspaces)
    ctx.workspaces.openPath = (path) => {
      if (typeof path === 'string' && path.length > 0 && !path.endsWith('/')) {
        openFileInPanel(path)
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
