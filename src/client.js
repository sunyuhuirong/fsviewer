/**
 * fsviewer - 客户端插件（目录树 + Markdown 文件预览）
 *
 * 停靠式右侧边栏（非弹窗）：
 *   - 顶部按钮挂在 conversation.session.header.utilities（session log 导出按钮右边），
 *     图标为「右侧栏」内联 SVG（圆角方框 + 靠右竖线），随主题着色。
 *   - 打开时通过 ctx.layout（ui-layout 提供）openDetails() 撑开原生右栏把中间内容
 *     推开，面板精确盖在右栏区域上（宽度对齐 360px）——观感即原生侧边栏。
 *   - 关闭时两者一起收起；切换会话时自动收起（原生布局本就会收右栏，这里保持同步）。
 *   - ctx.layout 不可用时自动退化为纯浮层（功能不丢，只是内容不被推开）。
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

// ---------- 面板开合状态（顶部按钮与面板共享） ----------
let panelOpen = false
const panelListeners = new Set()
// ui-layout 的布局服务，apply(ctx) 时捕获；缺失时退化为纯浮层
let layoutApi = null
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
// 开：先把原生右栏归一到默认宽度再撑开（closeDetails+openDetails），
// 避免此前拖拽/工具详情留下的其他宽度与浮层错位；关：两者一起收。
function togglePanel() {
  const next = !panelOpen
  setPanelOpen(next)
  if (!layoutApi) return
  if (next) {
    layoutApi.closeDetails()
    layoutApi.openDetails()
  } else {
    layoutApi.closeDetails()
  }
}
function closePanel() {
  if (!panelOpen) return
  setPanelOpen(false)
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
    '.fsviewer-row{display:flex;align-items:center;padding:2px 4px;cursor:pointer;font-size:13px;' +
    'color:var(--dsw-alias-label-primary);white-space:nowrap;border-radius:3px}' +
    '.fsviewer-row:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
    '.fsviewer-badge{flex:0 0 auto;display:inline-flex;justify-content:center;align-items:center;' +
    'width:20px;height:14px;border-radius:3px;font-size:8px;font-weight:700;margin-right:4px;' +
    'color:#fff;mix-blend-mode:normal}' +
    '.fsviewer-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:120px;' +
    'padding:2px 6px;border-radius:6px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary);' +
    'background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap}' +
    '.fsviewer-tab--active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}'
  document.head.appendChild(tag)
}

// ---------- 样式常量 ----------
// 宽度对齐原生右栏默认 360px（openDetails 的契约默认值），窄屏收缩到视口的 85%
const PANEL_CSS = 'min(360px, 85vw)'
const PANEL_HIDDEN_RIGHT = 'calc(-1 * min(360px, 85vw))'
// 叠放层级：高于普通页面内容与原生右栏（网格列），低于宿主弹窗层（常见 1000+）
const Z_PANEL = 300
const Z_TRIGGER = 301
// 颜色全部走宿主主题变量，明暗主题自动适配
const V = {
  fill: 'var(--dsw-specific-sidebar-fill)',
  fg: 'var(--dsw-alias-label-primary)',
  muted: 'var(--dsw-alias-label-dimmed)',
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
// session 作用域组件：拿到 sessionId，切换会话时自动收起面板，与原生右栏保持同步
function FsToggleButton({ sessionId }) {
  const [open] = usePanelOpen()
  const lastSession = React.useRef(sessionId)
  React.useEffect(() => {
    if (lastSession.current !== sessionId) {
      lastSession.current = sessionId
      closePanel()
    }
  }, [sessionId])
  // 会话关闭/按钮卸载时兜底收起，避免面板残留
  React.useEffect(() => () => { closePanel() }, [])
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
    view: 'tree',         // 'tree' | 'file'
    tabs: [],             // 已打开文件 [{ path, name }]（打开顺序）
    activePath: null,     // 当前预览文件
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
  return { ...state, view: 'file', tabs, activePath: path, files, sourceMode: false }
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
      return { ...state, view: 'file', activePath: action.path, sourceMode: false }
    case 'closeTab': {
      const tabs = state.tabs.filter((t) => t.path !== action.path)
      const files = { ...state.files }
      delete files[action.path]
      if (state.activePath !== action.path) return { ...state, tabs, files }
      const last = tabs[tabs.length - 1]
      return last
        ? { ...state, tabs, files, activePath: last.path, view: 'file' }
        : { ...state, tabs, files, activePath: null, view: 'tree' }
    }
    case 'backToTree':
      return { ...state, view: 'tree' }
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

// ---------- 目录行 ----------
function DirRow({ entry, depth, expanded, loading, onToggle, onEnter, onOpen }) {
  return (
    <div className="fsviewer-row" style={{ paddingLeft: 4 + depth * 14 }}>
      <span style={{ width: 16, textAlign: 'center', color: V.muted, flex: '0 0 auto' }}
        onClick={(e) => { e.stopPropagation(); onToggle() }}>{loading ? '⏳' : (expanded ? '▾' : '▸')}</span>
      <span style={{ marginRight: 4, flex: '0 0 auto' }}>📂</span>
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 4 }}
        onClick={onEnter} title={entry.path}>{entry.name}</span>
      <span title="在系统文件管理器中打开"
        style={{ color: V.muted, fontSize: '10px', padding: '0 4px' }}
        onClick={(e) => { e.stopPropagation(); onOpen() }}>⧉</span>
    </div>
  )
}

// ---------- 文件行（彩色类型徽章；点击打开预览） ----------
function FileRow({ entry, depth, onOpen }) {
  const badge = fileBadge(entry.name)
  return (
    <div className="fsviewer-row" style={{ paddingLeft: 20 + depth * 14 }}
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

// ---------- 文件预览视图 ----------
function FilePreview({ workspaces, state, dispatch }) {
  const path = state.activePath
  const file = state.files[path]
  const name = baseName(path)
  const isMd = isMdFile(name)

  // 系统打开
  const openInSystem = () => workspaces.openPath(path).catch((e) => console.error('[fsviewer] openPath:', e))

  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 文件操作条：返回 + 文件名 + 渲染/源码 + 系统打开 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid ' + V.line, flex: '0 0 auto' }}>
        <button type="button" onClick={() => dispatch({ type: 'backToTree' })} title="返回目录树" aria-label="返回目录树"
          style={{ cursor: 'pointer', color: V.muted, background: 'transparent', border: 'none', padding: '2px 4px', fontSize: 13 }}>←</button>
        <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: V.fg }} title={path}>{name}</span>
        {isMd && file && file.status === 'ok' && !file.binary
          ? <button type="button" onClick={() => dispatch({ type: 'toggleSource' })} title="切换渲染/源码"
            style={{ cursor: 'pointer', flex: '0 0 auto', fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid ' + V.line, background: state.sourceMode ? V.input : 'transparent', color: V.fg }}>
            {state.sourceMode ? '渲染' : '源码'}</button>
          : null}
        <button type="button" onClick={openInSystem} title="在系统默认应用中打开"
          style={{ cursor: 'pointer', flex: '0 0 auto', fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid ' + V.line, background: 'transparent', color: V.fg }}>⧉</button>
      </div>
      {/* 内容区 */}
      <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '10px 12px', minWidth: 0 }}>
        {!file || file.status === 'loading'
          ? <div style={{ color: V.muted, textAlign: 'center', padding: 12, fontSize: 12 }}>⏳ 加载中...</div>
          : file.status === 'err'
            ? <div style={{ color: '#e06c75', fontSize: 12 }}>⚠ {file.error}</div>
            : file.binary
              ? <div style={{ textAlign: 'center', padding: 24, color: V.muted, fontSize: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🗂</div>
                二进制文件，不支持预览（{fmtSize(file.size)}）
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={openInSystem}
                    style={{ cursor: 'pointer', fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid ' + V.line, background: V.input, color: V.fg }}>⧉ 在系统中打开</button>
                </div>
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

// ---------- 文件树视图 ----------
function TreeView({ workspaces, state, dispatch }) {
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
            onEnter={() => dispatch({ type: 'setRoot', root: entry.path })}
            onOpen={() => workspaces.openPath(entry.path).catch((e) => console.error('[fsviewer] openPath:', e))}
          />
          {childRows}
        </div>
      )
    })
  }

  const visible = filterEntries(state.entries)

  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 工具条 */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid ' + V.line, flex: '0 0 auto' }}>
        <button onClick={() => dispatch({ type: 'refresh' })} title="刷新当前目录"
          style={{ flex: 1, padding: '4px 0', backgroundColor: V.input, border: '1px solid ' + V.line, borderRadius: 4, color: V.fg, cursor: 'pointer', fontSize: 12 }}>🔄 刷新</button>
        <button onClick={() => workspaces.pickDirectory().then((p) => { if (p) dispatch({ type: 'setRoot', root: p }) }, (e) => console.error('[fsviewer] pickDirectory:', e))} title="选择其他文件夹作为根目录"
          style={{ flex: 1, padding: '4px 0', backgroundColor: V.input, border: '1px solid ' + V.line, borderRadius: 4, color: V.fg, cursor: 'pointer', fontSize: 12 }}>📂 选择目录</button>
        <button onClick={() => { if (state.root) workspaces.openPath(state.root).catch((e) => console.error('[fsviewer] openPath:', e)) }} title="在系统文件管理器中打开当前目录"
          style={{ flex: 1, padding: '4px 0', backgroundColor: V.input, border: '1px solid ' + V.line, borderRadius: 4, color: V.fg, cursor: 'pointer', fontSize: 12 }}>⧉ 打开</button>
      </div>
      {/* 搜索框 */}
      <div style={{ padding: '8px 12px', flex: '0 0 auto' }}>
        <input type="text" placeholder="🔍 筛选文件…" value={state.term}
          onChange={(e) => dispatch({ type: 'setTerm', term: e.target.value })}
          style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', backgroundColor: V.input, border: '1px solid ' + V.line, borderRadius: 4, color: V.fg, fontSize: 12 }} />
      </div>
      {/* 面包屑 */}
      <div style={{ padding: '4px 12px 8px', borderBottom: '1px solid ' + V.line, flex: '0 0 auto', overflowX: 'auto', whiteSpace: 'nowrap', color: V.muted, fontSize: 12 }}>
        {state.crumbs.length ? state.crumbs.map((crumb, idx) => (
          <span key={crumb.path || idx}>
            {idx > 0 ? <span style={{ color: V.line }}> / </span> : null}
            <span onClick={() => dispatch({ type: 'setRoot', root: crumb.path })} style={{ cursor: 'pointer', color: V.accent }}>{crumb.name || crumb.path}</span>
          </span>
        )) : <span>…</span>}
      </div>
      {/* 状态/错误 */}
      {state.error ? <div style={{ padding: '8px 12px', color: '#e06c75', fontSize: 12, flex: '0 0 auto' }}>⚠ {state.error}</div> : null}
      {/* 目录 + 文件树 */}
      <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '4px 0' }}>
        {!state.root
          ? <div style={{ padding: 12, color: V.muted, textAlign: 'center' }}>未检测到 workspace 根目录</div>
          : state.loading && !state.entries.length
            ? <div style={{ padding: 12, color: V.muted, textAlign: 'center' }}>⏳ 加载中...</div>
            : !state.entries.length
              ? <div style={{ padding: 12, color: V.muted, textAlign: 'center' }}>（当前目录为空）</div>
              : renderRows(visible, 0)}
      </div>
      {/* 底部截断/操作提示 */}
      {state.truncated
        ? <div style={{ padding: '6px 12px', borderTop: '1px solid ' + V.line, color: V.muted, fontSize: 11, flex: '0 0 auto' }}>条目过多，列表已截断（最多 1000 项）</div>
        : null}
      <div style={{ padding: '6px 12px', borderTop: '1px solid ' + V.line, color: V.muted, fontSize: 11, flex: '0 0 auto' }}>▸ 目录点击展开/进入 · 点击文件预览（支持 Markdown）</div>
    </div>
  )
}

// ---------- 页签条（已打开文件，同参考截图的页签概念） ----------
function TabStrip({ state, dispatch }) {
  if (state.view !== 'file' || !state.tabs.length) return null
  return (
    <div style={{ display: 'flex', gap: 4, padding: '6px 12px 0', overflowX: 'auto', flex: '0 0 auto' }}>
      {state.tabs.map((tab) => (
        <span key={tab.path}
          className={'fsviewer-tab' + (tab.path === state.activePath ? ' fsviewer-tab--active' : '')}
          onClick={() => dispatch({ type: 'activateTab', path: tab.path })}
          title={tab.path}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.name}</span>
          <span onClick={(e) => { e.stopPropagation(); dispatch({ type: 'closeTab', path: tab.path }) }}
            title="关闭页签" style={{ opacity: 0.7, padding: '0 1px' }}>×</span>
        </span>
      ))}
    </div>
  )
}

// ---------- 主面板（停靠在原生右栏上方，宽 360 与 openDetails 对齐） ----------
function FileTreePanel({ workspaces }) {
  const [open] = usePanelOpen()
  const [state, dispatch] = React.useReducer(reducer, undefined, initState)

  // 面板内关闭也走 closePanel（同步收起原生右栏）
  const onClose = () => closePanel()

  // 首次「点开面板」时才解析默认根目录（最近 workspace -> 首个 workspace -> 无则 null）
  React.useEffect(() => {
    if (!open || state.root !== undefined) return
    let root = null
    try {
      const snap = workspaces.list.getSnapshot()
      if (snap && snap.items && snap.items.length) {
        const rec = snap.items.find((w) => w.workspaceId === snap.recentWorkspaceId)
        const chosen = rec || snap.items[0]
        if (chosen && chosen.path) root = chosen.path
      }
    } catch (e) { console.error('[fsviewer] read workspaces list:', e) }
    dispatch({ type: 'setRoot', root })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 每次打开面板自动刷新根目录层：会话中新产生的文件立即可见
  React.useEffect(() => {
    if (open && state.root) dispatch({ type: 'refresh' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

  return (
    <div style={{
      position: 'fixed',
      right: open ? 0 : PANEL_HIDDEN_RIGHT,
      top: 0,
      width: PANEL_CSS,
      height: '100vh',
      backgroundColor: V.fill,
      borderLeft: '1px solid ' + V.edge,
      color: V.fg,
      transition: 'right 0.25s ease',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      zIndex: Z_PANEL,
      fontFamily: V.font,
      fontSize: '13px',
      pointerEvents: 'auto'
    }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid ' + V.line, flex: '0 0 auto' }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>文件管理器</span>
        <button type="button" onClick={onClose} title="关闭" aria-label="关闭文件管理器"
          style={{ cursor: 'pointer', fontSize: '14px', color: V.muted, background: 'transparent', border: 'none', padding: '2px 4px' }}>✕</button>
      </div>
      {/* 页签条（文件视图下显示已打开文件） */}
      <TabStrip state={state} dispatch={dispatch} />
      {state.view === 'file'
        ? <FilePreview workspaces={workspaces} state={state} dispatch={dispatch} />
        : <TreeView workspaces={workspaces} state={state} dispatch={dispatch} />}
    </div>
  )
}

// ---------- 插件契约 ----------
export const inject = ['slots', 'workspaces', 'layout']

export function apply(ctx) {
  injectToggleStyle()
  // 捕获布局服务：打开/关闭时同步原生右栏（缺失时退化为纯浮层）
  layoutApi = ctx.layout || null
  // 顶部切换按钮：会话头 utilities 区，位于 session log 导出按钮右边（order 更大）。
  // 工厂透传 props，组件才能拿到 sessionId（session 作用域）
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      { name: 'conversation.session.header.utilities', id: 'fsviewer-toggle', order: 50, label: '文件管理器' },
      (props) => React.createElement(FsToggleButton, props)
    )
  )
  // 文件面板：挂到 shell.overlay，视觉上停靠在原生右栏上方（保留渲染级错误边界）
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'fsviewer', order: 100, label: '文件管理器' },
      () => React.createElement(
        PanelErrorBoundary,
        null,
        React.createElement(FileTreePanel, { workspaces: ctx.workspaces })
      )
    )
  )
  console.log('[fsviewer] Client plugin loaded (docked sidebar, file list + md preview)')
}
