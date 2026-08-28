/**
 * fsviewer 客户端构建产物 — 由 build.js 从 src/client.js 生成，请勿手改。
 * 重新构建：npm run build
 */
window.__ModuleLoader__.load({
	id: "fsviewer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(stdin_exports);
var React = __toESM(require("react"));
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let panelOpen = false;
const panelListeners = /* @__PURE__ */ new Set();
let layoutApi = null;
let nativeOpenPath = null;
let panelFileDispatch = null;
function openFileInPanel(path) {
  setPanelOpen(true);
  if (layoutApi) layoutApi.openDetails();
  if (panelFileDispatch) panelFileDispatch(path);
  else if (nativeOpenPath) nativeOpenPath(path);
}
function subscribePanel(fn) {
  panelListeners.add(fn);
  return () => panelListeners.delete(fn);
}
function setPanelOpen(next) {
  panelOpen = typeof next === "function" ? next(panelOpen) : next;
  panelListeners.forEach((l) => l());
}
function usePanelOpen() {
  const [, force] = React.useState();
  React.useEffect(() => subscribePanel(() => force({})), []);
  return [panelOpen, setPanelOpen];
}
function togglePanel() {
  if (panelOpen) {
    closePanel();
    return;
  }
  setPanelOpen(true);
  if (layoutApi) layoutApi.openDetails();
}
function closePanel() {
  if (!panelOpen) return;
  setPanelOpen(false);
  wideOn = false;
  setExpandedFrame(false);
  if (layoutApi) layoutApi.closeDetails();
}
async function fetchJson(url) {
  const res = await fetch(url);
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new Error(data && data.error || "HTTP " + res.status);
  return data;
}
const fetchList = (path) => fetchJson("/fsviewer-api/list?path=" + encodeURIComponent(path || "/"));
const fetchFile = (path) => fetchJson("/fsviewer-api/file?path=" + encodeURIComponent(path));
const TOGGLE_CSS_ID = "fsviewer/toggle.css";
function injectToggleStyle() {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-plugin-css=" + JSON.stringify(TOGGLE_CSS_ID) + "]")) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "fsviewer";
  tag.dataset.pluginCss = TOGGLE_CSS_ID;
  tag.textContent = '.fsviewer-toggle{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.fsviewer-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.fsviewer-toggle--active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.fsviewer-iconbtn{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.fsviewer-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}.fsviewer-iconbtn--active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.fsviewer-row{display:flex;align-items:center;padding:2px 4px;cursor:pointer;font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;border-radius:3px}.fsviewer-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.fsviewer-badge{flex:0 0 auto;display:inline-flex;justify-content:center;align-items:center;width:20px;height:14px;border-radius:3px;font-size:8px;font-weight:700;margin-right:4px;color:#fff;mix-blend-mode:normal}.fsviewer-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:120px;padding:2px 6px;border-radius:6px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap}.fsviewer-tab--active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}.fsv-expanded-frame{grid-template-columns:var(--fsv-grid, 280px minmax(0,1fr) 360px) !important}.fsv-expanded-frame [class*="handle"]{display:none !important}';
  document.head.appendChild(tag);
}
const TREE_DEFAULT_WIDTH = 150;
let treeWidth = TREE_DEFAULT_WIDTH;
const Z_TRIGGER = 301;
const EXPAND_CLASS = "fsv-expanded-frame";
let wideOn = false;
function setExpandedFrame(on) {
  const col = document.querySelector('[class*="detailsCol"]');
  const frame = col && col.parentElement;
  if (!frame) return;
  if (on) {
    const cur = frame.style.gridTemplateColumns || getComputedStyle(frame).gridTemplateColumns;
    const parts = cur.split(" ");
    if (parts.length >= 3) parts[parts.length - 1] = "520px";
    frame.style.setProperty("--fsv-grid", parts.join(" "));
    frame.classList.add(EXPAND_CLASS);
  } else {
    frame.classList.remove(EXPAND_CLASS);
  }
}
const V = {
  fill: "var(--dsw-specific-sidebar-fill)",
  fg: "var(--dsw-alias-label-primary)",
  muted: "var(--dsw-alias-label-dimmed)",
  line: "var(--dsw-alias-border-l1)",
  edge: "var(--dsw-alias-border-l2)",
  input: "var(--dsw-alias-bg-base)",
  font: "var(--dsw-font-family, inherit)",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  accent: "#3b82f6"
};
function fmtError(e) {
  return e && e.message ? e.message : String(e);
}
function humanError(e) {
  const raw = fmtError(e);
  if (/EACCES|permission/i.test(raw)) return "\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u8BE5\u8DEF\u5F84";
  if (/ENOENT|not found|404/i.test(raw)) return "\u8DEF\u5F84\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u52A8";
  if (/network|fetch|timeout|abort|Failed to fetch/i.test(raw)) return "\u7F51\u7EDC\u5F02\u5E38\uFF0C\u8BF7\u786E\u8BA4\u4E3B\u673A\u670D\u52A1\u5728\u8FD0\u884C";
  return raw;
}
function matches(term, name) {
  return !term || name.toLowerCase().includes(term.toLowerCase());
}
function baseName(p) {
  const segs = String(p || "").split(/[\\/]+/).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : p;
}
function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function fileBadge(name) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const table = {
    md: ["MD", "#3fb950"],
    markdown: ["MD", "#3fb950"],
    json: ["{}", "#d29922"],
    jsonc: ["{}", "#d29922"],
    js: ["JS", "#58a6ff"],
    mjs: ["JS", "#58a6ff"],
    cjs: ["JS", "#58a6ff"],
    jsx: ["JS", "#58a6ff"],
    ts: ["TS", "#58a6ff"],
    tsx: ["TS", "#58a6ff"],
    yml: ["Y", "#f85149"],
    yaml: ["Y", "#f85149"],
    toml: ["T", "#f85149"],
    sql: ["SQL", "#a371f7"],
    db: ["DB", "#a371f7"],
    py: ["PY", "#3572a5"],
    rb: ["RB", "#e34c26"],
    go: ["GO", "#00add8"],
    rs: ["RS", "#dea584"],
    html: ["<>", "#e34c26"],
    css: ["CSS", "#a371f7"],
    scss: ["CSS", "#c6538c"],
    sh: ["$", "#8b949e"],
    bash: ["$", "#8b949e"],
    zsh: ["$", "#8b949e"],
    txt: ["TXT", "#8b949e"],
    log: ["LOG", "#8b949e"],
    png: ["IMG", "#d2a8ff"],
    jpg: ["IMG", "#d2a8ff"],
    jpeg: ["IMG", "#d2a8ff"],
    gif: ["IMG", "#d2a8ff"],
    svg: ["IMG", "#d2a8ff"],
    webp: ["IMG", "#d2a8ff"],
    zip: ["ZIP", "#d29922"],
    gz: ["ZIP", "#d29922"],
    tar: ["ZIP", "#d29922"]
  };
  const hit = table[ext];
  if (hit) return { text: hit[0], color: hit[1] };
  if (!ext) return { text: "FILE", color: "#8b949e" };
  return { text: ext.slice(0, 3).toUpperCase(), color: "#8b949e" };
}
const isMdFile = (name) => /\.(md|markdown)$/i.test(name || "");
function SidebarRightIcon() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 20 20", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement(
    "rect",
    {
      x: "2.75",
      y: "3.75",
      width: "14.5",
      height: "12.5",
      rx: "2.5",
      stroke: "currentColor",
      strokeWidth: "1.5"
    }
  ), /* @__PURE__ */ React.createElement(
    "line",
    {
      x1: "12.75",
      y1: "3.75",
      x2: "12.75",
      y2: "16.25",
      stroke: "currentColor",
      strokeWidth: "1.5"
    }
  ));
}
function FsToggleButton({ sessionId }) {
  const [open] = usePanelOpen();
  const lastSession = React.useRef(null);
  React.useEffect(() => {
    if (lastSession.current === null) {
      lastSession.current = sessionId;
      return;
    }
    if (lastSession.current !== sessionId) {
      lastSession.current = sessionId;
      closePanel();
    }
  }, [sessionId]);
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "aria-label": "\u6587\u4EF6\u7BA1\u7406\u5668",
      title: "\u6587\u4EF6\u7BA1\u7406\u5668",
      className: "fsviewer-toggle" + (open ? " fsviewer-toggle--active" : ""),
      onClick: togglePanel
    },
    /* @__PURE__ */ React.createElement(SidebarRightIcon, null)
  );
}
function initState() {
  return {
    root: void 0,
    // undefined=尚未解析；null=无 workspace；string=绝对路径
    nonce: 0,
    // 强制重载（刷新）
    crumbs: [],
    entries: [],
    truncated: false,
    loading: false,
    error: null,
    expanded: {},
    // path -> true（已展开）
    branches: {},
    // path -> { status:'new'|'ok'|'err', entries, truncated, error }
    term: "",
    tabs: [],
    // 已打开文件 [{ path, name }]（打开顺序）
    activePath: null,
    // 当前预览文件（null = 空状态）
    files: {},
    // path -> { status:'loading'|'ok'|'err', content?, size?, truncated?, binary?, error? }
    sourceMode: false
    // md：false=渲染视图，true=源码
  };
}
function openFileState(state, path) {
  const name = baseName(path);
  const tabs = state.tabs.some((t) => t.path === path) ? state.tabs : [...state.tabs, { path, name }];
  const files = state.files[path] ? state.files : { ...state.files, [path]: { status: "loading" } };
  return { ...state, tabs, activePath: path, files, sourceMode: false };
}
function reducer(state, action) {
  switch (action.type) {
    case "setRoot":
      return { ...state, root: action.root };
    case "refresh":
      return { ...state, nonce: state.nonce + 1 };
    case "loadStart":
      return { ...state, loading: true, error: null };
    case "loadRootOk":
      return {
        ...state,
        loading: false,
        error: null,
        root: action.path,
        crumbs: action.crumbs,
        entries: action.entries,
        truncated: action.truncated,
        branches: {},
        // 换根时清空已展开分支
        expanded: {},
        term: ""
      };
    case "loadFail":
      return { ...state, loading: false, error: action.error };
    case "toggle": {
      const p = action.path;
      const expanded = { ...state.expanded };
      const branches = { ...state.branches };
      if (expanded[p]) {
        delete expanded[p];
        delete branches[p];
      } else {
        expanded[p] = true;
        if (!branches[p]) branches[p] = { status: "new" };
      }
      return { ...state, expanded, branches };
    }
    case "branchOk":
      return { ...state, branches: { ...state.branches, [action.path]: { status: "ok", entries: action.entries, truncated: action.truncated } } };
    case "branchErr":
      return { ...state, branches: { ...state.branches, [action.path]: { status: "err", error: action.error } } };
    case "setTerm":
      return { ...state, term: action.term };
    case "openFile":
      return openFileState(state, action.path);
    case "activateTab":
      return { ...state, activePath: action.path, sourceMode: false };
    case "closeTab": {
      const tabs = state.tabs.filter((t) => t.path !== action.path);
      const files = { ...state.files };
      delete files[action.path];
      if (state.activePath !== action.path) return { ...state, tabs, files };
      const last = tabs[tabs.length - 1];
      return last ? { ...state, tabs, files, activePath: last.path } : { ...state, tabs, files, activePath: null };
    }
    case "fileOk":
      return { ...state, files: { ...state.files, [action.path]: { status: "ok", content: action.content, size: action.size, truncated: action.truncated, binary: action.binary } } };
    case "fileErr":
      return { ...state, files: { ...state.files, [action.path]: { status: "err", error: action.error } } };
    case "toggleSource":
      return { ...state, sourceMode: !state.sourceMode };
    default:
      return state;
  }
}
function Chevron({ open }) {
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
      style: { transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s ease", flex: "0 0 auto" }
    },
    /* @__PURE__ */ React.createElement("path", { d: "M6 3.5 10.5 8 6 12.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" })
  );
}
function DirRow({ entry, depth, expanded, loading, onToggle }) {
  return /* @__PURE__ */ React.createElement("div", { className: "fsviewer-row", style: { paddingLeft: 6 + depth * 14 }, onClick: onToggle, title: entry.path }, /* @__PURE__ */ React.createElement("span", { style: { width: 16, display: "inline-flex", justifyContent: "center", color: V.muted, flex: "0 0 auto" } }, loading ? "\u23F3" : /* @__PURE__ */ React.createElement(Chevron, { open: expanded })), /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", paddingLeft: 4 } }, entry.name));
}
function FileRow({ entry, depth, active, onOpen }) {
  const badge = fileBadge(entry.name);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "fsviewer-row",
      style: { paddingLeft: 20 + depth * 14, ...active ? { backgroundColor: "var(--dsw-alias-interactive-bg-active)" } : null },
      onClick: onOpen,
      title: entry.path
    },
    /* @__PURE__ */ React.createElement("span", { className: "fsviewer-badge", style: { backgroundColor: badge.color } }, badge.text),
    /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 4 } }, entry.name)
  );
}
class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("[fsviewer] panel crashed:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        title: "\u6587\u4EF6\u7BA1\u7406\u5668\u51FA\u9519\uFF1A" + fmtError(this.state.error),
        style: {
          position: "fixed",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          backgroundColor: "#5c1f1f",
          color: "#ffcccc",
          padding: "10px 8px",
          borderRadius: "4px 0 0 4px",
          fontSize: "14px",
          zIndex: Z_TRIGGER,
          cursor: "pointer",
          pointerEvents: "auto"
        },
        onClick: () => this.setState({ error: null })
      },
      "\u26A0"
    );
  }
}
function IconMaximize15() {
  return /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }));
}
function IconCopy15() {
  return /* @__PURE__ */ React.createElement("svg", { width: "15", height: "15", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("rect", { x: "5.5", y: "5.5", width: "8", height: "8", rx: "1.5", stroke: "currentColor" }), /* @__PURE__ */ React.createElement("path", { d: "M10.5 3.5h-6a1 1 0 0 0-1 1v6", stroke: "currentColor", strokeLinecap: "round" }));
}
function IconFolder15() {
  return /* @__PURE__ */ React.createElement("svg", { width: "15", height: "15", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z", stroke: "currentColor", strokeLinejoin: "round" }));
}
function EmptyState() {
  return /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: V.muted } }, /* @__PURE__ */ React.createElement("svg", { width: "44", height: "44", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { opacity: 0.6 } }, /* @__PURE__ */ React.createElement("path", { d: "M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z", stroke: "currentColor", strokeLinejoin: "round" })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: V.fg } }, "\u6253\u5F00\u6587\u4EF6"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12 } }, "\u4ECE\u5DE5\u4F5C\u533A\u76EE\u5F55\u6811\u4E2D\u9009\u62E9\u6587\u4EF6"));
}
function FilePreview({ state }) {
  const path = state.activePath;
  const file = state.files[path] || { status: "loading" };
  const isMd = isMdFile(baseName(path));
  const copyContent = () => {
    if (file.status === "ok" && file.content != null && navigator.clipboard) {
      navigator.clipboard.writeText(file.content).catch(() => {
      });
    }
  };
  return /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 16px 4px", flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: path }, baseName(path)), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: copyContent,
      title: "\u590D\u5236\u6587\u4EF6\u5185\u5BB9",
      "aria-label": "\u590D\u5236\u6587\u4EF6\u5185\u5BB9",
      style: { cursor: "pointer", flex: "0 0 auto", color: V.muted, background: "transparent", border: "none", padding: 4, display: "inline-flex" }
    },
    /* @__PURE__ */ React.createElement(IconCopy15, null)
  )), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", overflow: "auto", padding: "0 16px 14px", minWidth: 0 } }, file.status === "loading" ? /* @__PURE__ */ React.createElement("div", { style: { color: V.muted, textAlign: "center", padding: 12, fontSize: 12 } }, "\u23F3 \u52A0\u8F7D\u4E2D...") : file.status === "err" ? /* @__PURE__ */ React.createElement("div", { style: { color: "#e06c75", fontSize: 12 } }, "\u26A0 ", file.error) : file.binary ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: 24, color: V.muted, fontSize: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, marginBottom: 8 } }, "\u{1F5C2}"), "\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u4E0D\u652F\u6301\u9884\u89C8\uFF08", fmtSize(file.size), "\uFF09") : /* @__PURE__ */ React.createElement("div", null, file.truncated ? /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 8px", marginBottom: 8, borderRadius: 4, background: V.input, color: V.muted, fontSize: 11 } }, "\u6587\u4EF6\u8F83\u5927\uFF08", fmtSize(file.size), "\uFF09\uFF0C\u4EC5\u663E\u793A\u524D 1MB") : null, isMd && !state.sourceMode ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, wordBreak: "break-word" } }, /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.MarkdownText, { text: file.content })) : /* @__PURE__ */ React.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: V.mono, fontSize: 11, lineHeight: 1.5, color: V.fg } }, file.content))));
}
function TreeColumn({ workspaces, state, dispatch, width, onResizeStart }) {
  function entryMatchesDeep(entry) {
    if (matches(state.term, entry.name)) return true;
    if (entry.type !== "directory") return false;
    const branch = state.branches[entry.path];
    return !!(branch && branch.status === "ok" && branch.entries.some(entryMatchesDeep));
  }
  function filterEntries(entries) {
    if (!state.term) return entries;
    return entries.filter(entryMatchesDeep);
  }
  function renderRows(entries, depth) {
    return filterEntries(entries).map((entry) => {
      if (entry.type !== "directory") {
        return /* @__PURE__ */ React.createElement(
          FileRow,
          {
            key: entry.path,
            entry,
            depth,
            active: entry.path === state.activePath,
            onOpen: () => dispatch({ type: "openFile", path: entry.path })
          }
        );
      }
      const isExpanded = !!state.expanded[entry.path];
      const branch = state.branches[entry.path];
      const loading = isExpanded && branch && branch.status === "new";
      let childRows = null;
      if (isExpanded) {
        if (branch && branch.status === "ok") {
          childRows = branch.entries.length ? renderRows(branch.entries, depth + 1) : /* @__PURE__ */ React.createElement("div", { style: { padding: "2px 4px", paddingLeft: 24 + depth * 14, color: V.muted, fontSize: "12px" } }, state.term ? "\uFF08\u65E0\u5339\u914D\u9879\uFF09" : "\uFF08\u7A7A\u76EE\u5F55\uFF09");
        } else if (branch && branch.status === "err") {
          childRows = /* @__PURE__ */ React.createElement("div", { style: { padding: "2px 4px", paddingLeft: 24 + depth * 14, color: "#e06c75", fontSize: "12px" } }, "\u52A0\u8F7D\u5931\u8D25\uFF1A", branch.error);
        }
      }
      return /* @__PURE__ */ React.createElement("div", { key: entry.path }, /* @__PURE__ */ React.createElement(
        DirRow,
        {
          entry,
          depth,
          expanded: isExpanded,
          loading,
          onToggle: () => dispatch({ type: "toggle", path: entry.path })
        }
      ), childRows);
    });
  }
  const visible = filterEntries(state.entries);
  return /* @__PURE__ */ React.createElement("div", { style: { width, flex: "0 0 auto", borderLeft: "1px solid " + V.line, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onPointerDown: onResizeStart,
      title: "\u62D6\u62FD\u8C03\u6574\u6587\u4EF6\u6811\u5BBD\u5EA6",
      style: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 1 }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", padding: "10px 10px 8px", flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      id: "fsviewer-filter",
      type: "text",
      placeholder: "\u7B5B\u9009\u6587\u4EF6\u2026",
      value: state.term,
      onChange: (e) => dispatch({ type: "setTerm", term: e.target.value }),
      style: { flex: "1 1 auto", minWidth: 0, boxSizing: "border-box", padding: "5px 8px", backgroundColor: V.input, border: "1px solid " + V.line, borderRadius: 6, color: V.fg, fontSize: 12 }
    }
  )), state.error ? /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 12px", color: "#e06c75", fontSize: 12, flex: "0 0 auto" } }, "\u26A0 ", state.error) : null, /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", overflow: "auto", padding: "2px 0 4px" } }, !state.root ? /* @__PURE__ */ React.createElement("div", { style: { padding: 12, color: V.muted, textAlign: "center" } }, "\u672A\u68C0\u6D4B\u5230 workspace \u6839\u76EE\u5F55") : state.loading && !state.entries.length ? /* @__PURE__ */ React.createElement("div", { style: { padding: 12, color: V.muted, textAlign: "center" } }, "\u23F3 \u52A0\u8F7D\u4E2D...") : !state.entries.length ? /* @__PURE__ */ React.createElement("div", { style: { padding: 12, color: V.muted, textAlign: "center" } }, "\uFF08\u76EE\u5F55\u4E3A\u7A7A\uFF09") : renderRows(visible, 0)), state.truncated ? /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 12px", borderTop: "1px solid " + V.line, color: V.muted, fontSize: 11, flex: "0 0 auto" } }, "\u6761\u76EE\u8FC7\u591A\uFF0C\u5DF2\u622A\u65AD\uFF08\u6700\u591A 1000 \u9879\uFF09") : null);
}
function TabStrip({ state, dispatch, onClose }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4, flex: "1 1 auto", minWidth: 0, overflowX: "auto", padding: "6px 0 6px 8px" } }, state.tabs.length === 0 ? /* @__PURE__ */ React.createElement("span", { className: "fsviewer-tab fsviewer-tab--active", title: "\u672A\u6253\u5F00\u6587\u4EF6" }, /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, "\u6253\u5F00\u6587\u4EF6"), /* @__PURE__ */ React.createElement("span", { onClick: (e) => {
    e.stopPropagation();
    onClose();
  }, title: "\u5173\u95ED\u9762\u677F", style: { opacity: 0.7, padding: "0 1px" } }, "\xD7")) : state.tabs.map((tab) => /* @__PURE__ */ React.createElement(
    "span",
    {
      key: tab.path,
      className: "fsviewer-tab" + (tab.path === state.activePath ? " fsviewer-tab--active" : ""),
      onClick: () => dispatch({ type: "activateTab", path: tab.path }),
      title: tab.path
    },
    /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, tab.name),
    /* @__PURE__ */ React.createElement(
      "span",
      {
        onClick: (e) => {
          e.stopPropagation();
          dispatch({ type: "closeTab", path: tab.path });
        },
        title: "\u5173\u95ED\u9875\u7B7E",
        style: { opacity: 0.7, padding: "0 1px" }
      },
      "\xD7"
    )
  )), /* @__PURE__ */ React.createElement("span", { className: "fsviewer-tab", title: "\u7B5B\u9009\u6587\u4EF6", onClick: () => {
    const el = document.getElementById("fsviewer-filter");
    if (el) el.focus();
  } }, "+"));
}
function FileTreePanel({ workspaces, sessions }) {
  const [state, dispatch] = React.useReducer(reducer, void 0, initState);
  React.useEffect(() => {
    panelFileDispatch = (p) => dispatch({ type: "openFile", path: p });
    return () => {
      panelFileDispatch = null;
    };
  }, [dispatch]);
  const [visible, setVisible] = React.useState(false);
  const [treeW, setTreeW] = React.useState(treeWidth);
  const [treeOn, setTreeOn] = React.useState(true);
  const onClose = () => closePanel();
  React.useEffect(() => {
    const col = document.querySelector('[class*="detailsCol"]');
    if (!col || typeof ResizeObserver === "undefined") {
      setVisible(true);
      return;
    }
    const apply2 = () => setVisible(col.getBoundingClientRect().width > 80);
    apply2();
    const ro = new ResizeObserver(apply2);
    ro.observe(col);
    return () => ro.disconnect();
  }, []);
  React.useEffect(() => {
    if (!visible || state.root !== void 0) return;
    let disposed = false;
    const unsubs = [];
    const resolve = () => {
      let root = null;
      try {
        const ss = sessions.list.getSnapshot();
        if (ss && ss.current !== void 0 && ss.byId) {
          const rec = ss.byId[ss.current];
          if (rec && rec.cwd) root = rec.cwd;
        }
        if (!root) {
          const snap = workspaces.list.getSnapshot();
          if (snap && snap.items && snap.items.length) {
            const rec = snap.items.find((w) => w.workspaceId === snap.recentWorkspaceId);
            const chosen = rec || snap.items[0];
            if (chosen && chosen.path) root = chosen.path;
          }
        }
      } catch (e) {
        console.error("[fsviewer] resolve default root:", e);
      }
      if (disposed) return true;
      if (root !== null) {
        dispatch({ type: "setRoot", root });
        return true;
      }
      return false;
    };
    if (resolve()) return;
    const onChange = () => {
      if (resolve() && unsubs.length) unsubs.forEach((u) => u());
    };
    try {
      unsubs.push(sessions.list.subscribe(onChange));
      unsubs.push(workspaces.list.subscribe(onChange));
    } catch (e) {
      console.error("[fsviewer] subscribe root sources:", e);
    }
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, [visible]);
  React.useEffect(() => {
    if (visible && state.root) dispatch({ type: "refresh" });
  }, [visible]);
  React.useEffect(() => {
    if (!state.root) return;
    let alive = true;
    dispatch({ type: "loadStart" });
    fetchList(state.root).then(
      (l) => {
        if (alive) dispatch({ type: "loadRootOk", path: l.path, crumbs: l.crumbs || [], entries: l.entries || [], truncated: !!l.truncated });
      },
      (e) => {
        if (alive) dispatch({ type: "loadFail", error: humanError(e) });
      }
    );
    return () => {
      alive = false;
    };
  }, [state.root, state.nonce]);
  React.useEffect(() => {
    const targets = Object.keys(state.expanded).filter((p) => state.branches[p] && state.branches[p].status === "new");
    if (!targets.length) return;
    let disposed = false;
    targets.forEach((path) => {
      fetchList(path).then(
        (l) => {
          if (!disposed) dispatch({ type: "branchOk", path, entries: l.entries || [], truncated: !!l.truncated });
        },
        (e) => {
          if (!disposed) dispatch({ type: "branchErr", path, error: humanError(e) });
        }
      );
    });
    return () => {
      disposed = true;
    };
  }, [state.expanded]);
  React.useEffect(() => {
    const path = state.activePath;
    if (!path || !state.files[path] || state.files[path].status !== "loading") return;
    let alive = true;
    fetchFile(path).then(
      (f) => {
        if (alive) dispatch({ type: "fileOk", path, content: f.content, size: f.size, truncated: !!f.truncated, binary: !!f.binary });
      },
      (e) => {
        if (alive) dispatch({ type: "fileErr", path, error: humanError(e) });
      }
    );
    return () => {
      alive = false;
    };
  }, [state.activePath, state.files]);
  const onTreeResizeStart = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidth;
    const move = (ev) => {
      treeWidth = Math.min(Math.max(startW + (startX - ev.clientX), 120), 320);
      setTreeW(treeWidth);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [wide, setWide] = React.useState(wideOn);
  const toggleWide = () => {
    wideOn = !wideOn;
    setWide(wideOn);
    setExpandedFrame(wideOn);
  };
  const activeFile = state.activePath ? state.files[state.activePath] : null;
  const showSourceBtn = !!(state.activePath && isMdFile(baseName(state.activePath)) && activeFile && activeFile.status === "ok" && !activeFile.binary);
  const openFileInSystem = () => {
    if (state.activePath && nativeOpenPath) nativeOpenPath(state.activePath).catch((e) => console.error("[fsviewer] openPath:", e));
  };
  return /* @__PURE__ */ React.createElement("div", { style: {
    width: "100%",
    height: "100%",
    backgroundColor: V.fill,
    color: V.fg,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    fontFamily: V.font,
    fontSize: "13px"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", minHeight: 56, borderBottom: "1px solid " + V.line, flex: "0 0 auto", paddingRight: 6 } }, /* @__PURE__ */ React.createElement(TabStrip, { state, dispatch, onClose }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", marginLeft: "auto", flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: toggleWide,
      title: wide ? "\u6062\u590D\u9ED8\u8BA4\u5BBD\u5EA6" : "\u52A0\u5BBD\u9762\u677F\uFF08\u6700\u5927 520px\uFF09",
      "aria-label": "\u5207\u6362\u52A0\u5BBD",
      className: "fsviewer-iconbtn" + (wide ? " fsviewer-iconbtn--active" : "")
    },
    /* @__PURE__ */ React.createElement(IconMaximize15, null)
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 20px 5px 10px", borderBottom: "1px solid " + V.line, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: V.muted } }, state.root ? baseName(state.root) : "\u2026", state.activePath ? /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { style: { color: V.edge } }, " \u203A "), /* @__PURE__ */ React.createElement("span", { style: { color: V.fg } }, baseName(state.activePath))) : null), showSourceBtn ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => dispatch({ type: "toggleSource" }),
      title: "\u5207\u6362\u6E32\u67D3/\u6E90\u7801\u89C6\u56FE",
      style: { cursor: "pointer", flex: "0 0 auto", fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid " + V.line, background: state.sourceMode ? V.input : "transparent", color: V.fg }
    },
    state.sourceMode ? "\u6E32\u67D3\u89C6\u56FE" : "\u67E5\u770B\u6E90\u4EE3\u7801"
  ) : null, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setTreeOn(!treeOn),
      title: treeOn ? "\u6536\u8D77\u6587\u4EF6\u6811" : "\u5C55\u5F00\u6587\u4EF6\u6811",
      "aria-label": "\u5207\u6362\u6587\u4EF6\u6811",
      style: { cursor: "pointer", flex: "0 0 auto", color: treeOn ? V.fg : V.muted, background: treeOn ? "var(--dsw-alias-interactive-bg-active)" : "transparent", border: "1px solid " + V.line, borderRadius: 6, padding: 4, display: "inline-flex" }
    },
    /* @__PURE__ */ React.createElement(IconFolder15, null)
  ), state.activePath ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: openFileInSystem,
      title: "\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u5E94\u7528\u6253\u5F00\u6B64\u6587\u4EF6",
      style: { cursor: "pointer", flex: "0 0 auto", fontSize: 12, padding: "3px 12px", borderRadius: 6, border: "none", background: V.accent, color: "#fff" }
    },
    "\u29C9 \u6253\u5F00"
  ) : null), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", minHeight: 0 } }, state.activePath ? /* @__PURE__ */ React.createElement(FilePreview, { state }) : /* @__PURE__ */ React.createElement(EmptyState, null), treeOn ? /* @__PURE__ */ React.createElement(TreeColumn, { workspaces, state, dispatch, width: treeW, onResizeStart: onTreeResizeStart }) : null));
}
const inject = ["slots", "workspaces", "sessions", "layout"];
function apply(ctx) {
  injectToggleStyle();
  layoutApi = ctx.layout || null;
  if (ctx.workspaces && typeof ctx.workspaces.openPath === "function") {
    nativeOpenPath = ctx.workspaces.openPath.bind(ctx.workspaces);
    ctx.workspaces.openPath = (path) => {
      if (typeof path === "string" && path.length > 0 && !path.endsWith("/")) {
        openFileInPanel(path);
        return Promise.resolve();
      }
      return nativeOpenPath(path);
    };
  }
  ctx.slots.inject(
    "conversation.session.header.utilities",
    () => ctx.slots.register(
      { name: "conversation.session.header.utilities", id: "fsviewer-toggle", order: 50, label: "\u6587\u4EF6\u7BA1\u7406\u5668" },
      (props) => React.createElement(FsToggleButton, props)
    )
  );
  ctx.slots.inject(
    "details",
    () => ctx.slots.register(
      { name: "details", id: "fsviewer-panel", priority: -10 },
      () => React.createElement(
        PanelErrorBoundary,
        null,
        React.createElement(FileTreePanel, { workspaces: ctx.workspaces, sessions: ctx.sessions })
      )
    )
  );
  console.log("[fsviewer] Client plugin loaded (native details column takeover: preview + tree)");
}

		return module.exports;
	}
});
