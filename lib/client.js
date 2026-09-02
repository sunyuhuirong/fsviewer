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
let panelDirDispatch = null;
const TABS_KEY = "fsviewer/tabs.v3";
let currentWs = null;
let panels = {};
let seq = { f: 0, c: 0, b: 0 };
let panelsHydrated = false;
const tabsListeners = /* @__PURE__ */ new Set();
let sessionsSvc = null;
let workspacesSvc = null;
function subscribeTabs(fn) {
  tabsListeners.add(fn);
  return () => tabsListeners.delete(fn);
}
function notifyTabs() {
  tabsListeners.forEach((l) => l());
}
function mkId(kind) {
  return kind + ++seq[kind];
}
function wsDisplayName(root) {
  const segs = String(root || "").split(/[\\/]+/).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : "";
}
function resolveDefaultRoot(sessionId) {
  try {
    const snap = workspacesSvc && workspacesSvc.list && workspacesSvc.list.getSnapshot();
    if (snap && snap.items && snap.items.length) {
      const rec = snap.items.find((w) => w.workspaceId === snap.recentWorkspaceId);
      const chosen = rec || snap.items[0];
      if (chosen && chosen.path) return chosen.path;
    }
    const ss = sessionsSvc && sessionsSvc.list && sessionsSvc.list.getSnapshot();
    if (ss && ss.byId) {
      const sid = sessionId && ss.byId[sessionId] ? sessionId : ss.current;
      if (sid !== void 0 && ss.byId[sid]) {
        const rec = ss.byId[sid];
        if (rec && rec.cwd) return rec.cwd;
      }
    }
  } catch (e) {
    console.error("[fsviewer] resolve default root:", e);
  }
  return null;
}
function ensureCurrentWs() {
  if (!currentWs) {
    setWorkspace(resolveDefaultRoot() || "@default");
  }
}
function P() {
  hydratePanels();
  return panels[currentWs] || null;
}
function newPanel() {
  const c = mkId("c");
  return {
    tabs: [{ id: "files", kind: "files" }, { id: c, kind: "chat" }],
    activeTabId: "files",
    browser: {},
    chats: { [c]: { messages: [], route: null, model: null } },
    panelOpen: null,
    // null=未记录（跟随当前）；true/false=该工作区记忆的开合
    expanded: {},
    treeOn: true,
    treeW: TREE_DEFAULT_WIDTH
  };
}
function persistPanels() {
  if (!panelsHydrated) return;
  try {
    const out = {};
    for (const [ws, p] of Object.entries(panels)) {
      out[ws] = {
        activeTabId: p.activeTabId,
        panelOpen: p.panelOpen,
        expanded: p.expanded || {},
        treeOn: p.treeOn !== false,
        treeW: p.treeW || TREE_DEFAULT_WIDTH,
        tabs: p.tabs,
        browser: p.browser,
        chats: Object.fromEntries(Object.entries(p.chats).map(([id, c]) => [id, {
          route: c.route || null,
          model: c.model && c.model.provider && c.model.model ? { provider: c.model.provider, model: c.model.model } : null,
          messages: c.messages.filter((m) => !m.error && typeof m.content === "string" && m.content.length).slice(-40).map((m) => ({ role: m.role, content: m.content }))
        }]))
      };
    }
    localStorage.setItem(TABS_KEY, JSON.stringify({ currentWs, panels: out }));
  } catch {
  }
}
function hydratePanels() {
  if (panelsHydrated) return;
  panelsHydrated = true;
  let d = null;
  try {
    d = JSON.parse(localStorage.getItem(TABS_KEY) || "null");
  } catch {
  }
  if (d && d.panels && Object.keys(d.panels).length) {
    for (const [ws, sp] of Object.entries(d.panels)) {
      const p = newPanel();
      p.tabs = (Array.isArray(sp.tabs) ? sp.tabs : []).filter((t) => t && t.id && t.kind);
      p.activeTabId = sp.activeTabId || null;
      p.panelOpen = sp.panelOpen != null ? !!sp.panelOpen : null;
      p.expanded = sp.expanded && typeof sp.expanded === "object" ? sp.expanded : {};
      p.treeOn = sp.treeOn !== false;
      p.treeW = typeof sp.treeW === "number" ? sp.treeW : TREE_DEFAULT_WIDTH;
      for (const [id, b] of Object.entries(sp.browser || {})) {
        p.browser[id] = { title: "\u65B0\u6807\u7B7E\u9875", url: null, input: "", proxy: false, hist: [], idx: -1, reload: 0, ...b };
      }
      for (const [id, c] of Object.entries(sp.chats || {})) {
        p.chats[id] = {
          route: c && c.route || null,
          model: c && c.model && c.model.provider && c.model.model ? { provider: c.model.provider, model: c.model.model } : null,
          messages: (c && Array.isArray(c.messages) ? c.messages : []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length).slice(-60)
        };
      }
      p.tabs = p.tabs.filter((t) => t.kind !== "browser" || p.browser[t.id]);
      p.tabs = p.tabs.filter((t) => t.kind !== "chat" || p.chats[t.id]);
      if (!p.tabs.some((t) => t.id === p.activeTabId)) {
        p.activeTabId = p.tabs.length ? p.tabs[p.tabs.length - 1].id : null;
      }
      for (const t of p.tabs) {
        const n = Number(String(t.id).slice(1)) || 0;
        if (t.kind === "file") seq.f = Math.max(seq.f, n);
        else if (t.kind === "chat") seq.c = Math.max(seq.c, n);
        else if (t.kind === "browser") seq.b = Math.max(seq.b, n);
      }
      panels[ws] = p;
    }
    currentWs = d.currentWs && panels[d.currentWs] ? d.currentWs : Object.keys(panels)[0] || null;
    return;
  }
  if (d && (Array.isArray(d.tabs) || d.chats || d.browser)) {
    const baseWs = typeof d.currentWs === "string" && d.currentWs || "@default";
    for (const t of d.tabs || []) {
      if (!t || !t.id || !t.kind || t.kind === "files") continue;
      const ws = t.kind === "file" && t.ws ? t.ws : baseWs;
      const p = panels[ws] || (panels[ws] = newPanel());
      if (t.kind === "file") {
        p.tabs = p.tabs.concat({ id: t.id, kind: "file", path: t.path });
        seq.f = Math.max(seq.f, Number(String(t.id).slice(1)) || 0);
      } else if (t.kind === "chat") {
        p.tabs = p.tabs.concat({ id: t.id, kind: "chat" });
        const c = d.chats && d.chats[t.id] || {};
        p.chats[t.id] = {
          route: c.route || null,
          model: c.model && c.model.provider && c.model.model ? { provider: c.model.provider, model: c.model.model } : null,
          messages: (c.messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length).slice(-60)
        };
        seq.c = Math.max(seq.c, Number(String(t.id).slice(1)) || 0);
      } else if (t.kind === "browser") {
        p.tabs = p.tabs.concat({ id: t.id, kind: "browser" });
        const b = d.browser && d.browser[t.id] || {};
        p.browser[t.id] = { title: "\u65B0\u6807\u7B7E\u9875", url: null, input: "", proxy: false, hist: [], idx: -1, reload: 0, ...b };
        seq.b = Math.max(seq.b, Number(String(t.id).slice(1)) || 0);
      }
    }
    currentWs = panels[baseWs] ? baseWs : Object.keys(panels)[0] || null;
    if (currentWs) {
      const p = panels[currentWs];
      p.activeTabId = d.activeTabId && p.tabs.some((t) => t.id === d.activeTabId) ? d.activeTabId : p.tabs.length ? p.tabs[p.tabs.length - 1].id : null;
    }
    if (Object.keys(panels).length) return;
  }
  currentWs = "@default";
  panels[currentWs] = newPanel();
}
function getActiveTab() {
  const p = P();
  return p ? p.tabs.find((t) => t.id === p.activeTabId) || null : null;
}
function activateTab(id) {
  const p = P();
  if (!p || !p.tabs.some((t) => t.id === id)) return;
  p.activeTabId = id;
  persistPanels();
  notifyTabs();
}
function closeTab(id) {
  const p = P();
  if (!p) return;
  const idx = p.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const closed = p.tabs[idx];
  p.tabs = p.tabs.filter((t) => t.id !== id);
  if (closed.kind === "browser") delete p.browser[id];
  if (closed.kind === "chat") delete p.chats[id];
  if (p.activeTabId === id) {
    const next = p.tabs[Math.min(idx, p.tabs.length - 1)];
    p.activeTabId = next ? next.id : null;
  }
  persistPanels();
  notifyTabs();
}
function ensureFilesTab() {
  ensureCurrentWs();
  const p = P();
  if (!p.tabs.some((t) => t.kind === "files")) p.tabs = [{ id: "files", kind: "files" }].concat(p.tabs);
  p.activeTabId = "files";
  persistPanels();
  notifyTabs();
}
function openFileTab(path) {
  ensureCurrentWs();
  const p = P();
  let t = p.tabs.find((t2) => t2.kind === "file" && t2.path === path);
  if (!t) {
    t = { id: mkId("f"), kind: "file", path };
    p.tabs.push(t);
  }
  p.activeTabId = t.id;
  persistPanels();
  notifyTabs();
}
function openHtmlInBrowser(path) {
  openPanelWithRoom();
  ensureCurrentWs();
  const p = P();
  const norm = String(path || "").replace(/\\/g, "/");
  let tab = p.tabs.find((t) => t.kind === "browser" && p.browser[t.id] && p.browser[t.id].htmlPath === norm);
  if (!tab) {
    const id = mkId("b");
    p.browser[id] = {
      title: baseName(norm),
      url: "/fsviewer-api/f" + norm,
      input: norm,
      proxy: false,
      hist: [],
      idx: -1,
      reload: 0,
      htmlPath: norm,
      internal: true
    };
    tab = { id, kind: "browser" };
    p.tabs = p.tabs.concat(tab);
  }
  p.activeTabId = tab.id;
  persistPanels();
  notifyTabs();
}
function replaceFilesTabWithFile(path) {
  ensureCurrentWs();
  const p = P();
  const idx = p.tabs.findIndex((t) => t.kind === "files");
  if (idx < 0) return openFileTab(path);
  const existing = p.tabs.find((t) => t.kind === "file" && t.path === path);
  p.tabs = p.tabs.filter((t) => t.kind !== "files");
  if (existing) {
    p.activeTabId = existing.id;
  } else {
    const tab = { id: mkId("f"), kind: "file", path };
    const at = Math.min(idx, p.tabs.length);
    p.tabs = p.tabs.slice(0, at).concat(tab, p.tabs.slice(at));
    p.activeTabId = tab.id;
  }
  persistPanels();
  notifyTabs();
}
function newBrowserTab() {
  ensureCurrentWs();
  const p = P();
  const id = mkId("b");
  p.browser[id] = { title: "\u65B0\u6807\u7B7E\u9875", url: null, input: "", proxy: false, hist: [], idx: -1, reload: 0 };
  p.tabs = p.tabs.concat({ id, kind: "browser" });
  p.activeTabId = id;
  persistPanels();
  notifyTabs();
}
function newChatTab() {
  ensureCurrentWs();
  const p = P();
  const id = mkId("c");
  p.chats[id] = { messages: [], route: null, model: null };
  p.tabs = p.tabs.concat({ id, kind: "chat" });
  p.activeTabId = id;
  persistPanels();
  notifyTabs();
}
function activateLatestChat() {
  ensureCurrentWs();
  const p = P();
  const t = [...p.tabs].reverse().find((t2) => t2.kind === "chat");
  if (t) activateTab(t.id);
  else newChatTab();
}
function updateBrowser(id, fn) {
  const p = P();
  if (!p || !p.browser[id]) return;
  p.browser[id] = fn(p.browser[id]);
  persistPanels();
  notifyTabs();
}
function setWorkspace(root) {
  hydratePanels();
  if (!root || root === currentWs) {
    currentWs = root || currentWs;
    return;
  }
  const prev = currentWs;
  if (prev && panels[prev]) panels[prev].panelOpen = panelOpen;
  currentWs = root;
  if (!panels[root]) panels[root] = newPanel();
  persistPanels();
  notifyTabs();
  const p = panels[root];
  if (p.panelOpen != null) {
    if (p.panelOpen) {
      openPanelWithRoom();
      setTimeout(() => {
        if (currentWs === root && p.panelOpen) openPanelWithRoom();
      }, 80);
    } else if (panelOpen) closePanel();
  }
}
function useActiveTab() {
  hydratePanels();
  const [, force] = React.useState();
  React.useEffect(() => subscribeTabs(() => force({})), []);
  return getActiveTab();
}
function usePanelSession() {
  hydratePanels();
  const [, force] = React.useState();
  React.useEffect(() => subscribeTabs(() => force({})), []);
  return P();
}
let currentFileCtx = null;
const fileCtxListeners = /* @__PURE__ */ new Set();
function setCurrentFileCtx(next) {
  const prev = currentFileCtx;
  if (prev === next) return;
  if (prev && next && prev.path === next.path && prev.content === next.content && prev.truncated === next.truncated) return;
  currentFileCtx = next;
  fileCtxListeners.forEach((l) => l());
}
function useCurrentFileCtx() {
  const [, force] = React.useState();
  React.useEffect(() => {
    fileCtxListeners.add(force);
    return () => fileCtxListeners.delete(force);
  }, []);
  return currentFileCtx;
}
const CHAT_QUOTE_CHARS = 32e3;
const chatAbort = {};
function getChat(id) {
  const p = P();
  return p.chats[id] || (p.chats[id] = { messages: [], route: null, model: null });
}
function updateChat(id, fn) {
  const p = P();
  const c = p.chats[id] || (p.chats[id] = { messages: [], route: null, model: null });
  fn(c);
  persistPanels();
  notifyTabs();
}
function lastAssistant(c) {
  const m = c.messages[c.messages.length - 1];
  return m && m.role === "assistant" ? m : null;
}
async function sendChat(chatId, text, fileCtx) {
  const trimmed = text.trim();
  const c = getChat(chatId);
  if (!trimmed || c.streaming) return;
  let content = trimmed;
  if (fileCtx && typeof fileCtx.content === "string") {
    const clip = fileCtx.content.slice(0, CHAT_QUOTE_CHARS);
    const more = fileCtx.content.length > CHAT_QUOTE_CHARS ? "\n\u2026\uFF08\u5DF2\u622A\u65AD\uFF09" : "";
    content += "\n\n---\n[\u5F15\u7528\u6587\u4EF6: " + fileCtx.path + (fileCtx.truncated ? "\uFF0C\u524D 1MB" : "") + "]\n```\n" + clip + more + "\n```";
  }
  updateChat(chatId, (cur) => {
    cur.messages = cur.messages.concat([
      { role: "user", content },
      { role: "assistant", content: "", streaming: true }
    ]);
    cur.streaming = true;
    return cur;
  });
  const ctrl = new AbortController();
  chatAbort[chatId] = ctrl;
  try {
    const cur = getChat(chatId);
    const body = { messages: cur.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) };
    if (cur.model && cur.model.provider && cur.model.model) {
      body.provider = cur.model.provider;
      body.model = cur.model.model;
    }
    const res = await fetch("/fsviewer-api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok || !res.body) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch {
      }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        let evt;
        try {
          evt = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }
        updateChat(chatId, (cur2) => {
          const m = lastAssistant(cur2);
          if (evt.meta && evt.meta.provider) cur2.route = evt.meta;
          else if (evt.delta && m) {
            if (typeof evt.delta.text === "string") m.content += evt.delta.text;
            else if (typeof evt.delta.reasoning === "string") m.reasoning = (m.reasoning || "") + evt.delta.reasoning;
          } else if (evt.error && m) m.error = evt.error;
          else if (evt.done && evt.done.finish === "max-tokens" && m) m.note = "\u56DE\u590D\u8FBE\u5230 token \u4E0A\u9650\uFF0C\u53EF\u80FD\u88AB\u622A\u65AD";
          return cur2;
        });
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) {
      updateChat(chatId, (cur) => {
        const m = lastAssistant(cur);
        if (m) m.error = humanError(e);
        return cur;
      });
    }
  } finally {
    updateChat(chatId, (cur) => {
      const m = lastAssistant(cur);
      if (m) delete m.streaming;
      cur.streaming = false;
      return cur;
    });
    delete chatAbort[chatId];
  }
}
function stopChat(chatId) {
  if (chatAbort[chatId]) chatAbort[chatId].abort();
}
let modelsCache = null;
let modelsPending = null;
function loadModels() {
  if (modelsCache) return Promise.resolve(modelsCache);
  if (!modelsPending) {
    modelsPending = fetchJson("/fsviewer-api/models").then((d) => {
      modelsCache = d;
      return d;
    }).finally(() => {
      modelsPending = null;
    });
  }
  return modelsPending;
}
const CENTER_MIN_PX = 640;
const DETAILS_MIN_PX = 300;
const SIDEBAR_RAIL_PX = 56;
function sidebarRenderedWidth() {
  const col = document.querySelector('[class*="detailsCol"]');
  const frame = col && col.parentElement;
  const inline = frame && frame.style.gridTemplateColumns;
  if (inline) {
    const first = parseFloat(inline.split(" ")[0]);
    if (!Number.isNaN(first)) return first;
  }
  return window.innerWidth > 1024 ? 280 : SIDEBAR_RAIL_PX;
}
function ensureRoomForDetails() {
  if (!layoutApi) return sidebarRenderedWidth();
  const sidebarW = sidebarRenderedWidth();
  if (sidebarW > SIDEBAR_RAIL_PX + 8 && window.innerWidth - sidebarW - CENTER_MIN_PX < DETAILS_MIN_PX) {
    layoutApi.toggleSidebar();
    return SIDEBAR_RAIL_PX;
  }
  return sidebarW;
}
let pinMode = null;
let panelResizeWatch = null;
function stopPanelResizeWatch() {
  if (panelResizeWatch) {
    window.removeEventListener("resize", panelResizeWatch);
    panelResizeWatch = null;
  }
}
function startPanelResizeWatch() {
  stopPanelResizeWatch();
  panelResizeWatch = () => {
    if (!panelOpen || pinMode === "wide") return;
    const nativeFits = window.innerWidth - sidebarRenderedWidth() - CENTER_MIN_PX >= DETAILS_MIN_PX;
    if (pinMode === "squeeze") {
      if (nativeFits) tryReleaseSqueeze();
      else applySqueezeIfNeeded(sidebarRenderedWidth());
    } else if (!nativeFits) {
      applySqueezeIfNeeded(sidebarRenderedWidth());
    }
  };
  window.addEventListener("resize", panelResizeWatch);
}
function tryReleaseSqueeze() {
  pinMode = null;
  setFramePin(null);
  setTimeout(() => {
    if (pinMode !== null || !panelOpen) return;
    const col = document.querySelector('[class*="detailsCol"]');
    const w = col ? col.getBoundingClientRect().width : 0;
    if (w < 280) applySqueezeIfNeeded(sidebarRenderedWidth());
  }, 300);
}
function applySqueezeIfNeeded(sidebarW) {
  const effW = window.innerWidth >= 1024 ? sidebarW : Math.min(sidebarW, SIDEBAR_RAIL_PX);
  const fitsNatively = window.innerWidth - effW - CENTER_MIN_PX >= DETAILS_MIN_PX;
  if (!fitsNatively) {
    if (pinMode === "wide") return;
    pinMode = "squeeze";
    setFramePin(Math.max(280, Math.min(360, window.innerWidth - effW - 360)));
  } else if (pinMode === "squeeze") {
    pinMode = null;
    setFramePin(null);
  }
}
function openPanelWithRoom() {
  setPanelOpen(true);
  const sidebarW = ensureRoomForDetails();
  if (layoutApi) layoutApi.openDetails();
  applySqueezeIfNeeded(sidebarW);
  startPanelResizeWatch();
}
function openFileInPanel(path) {
  if (isHtmlFile(baseName(path))) return openHtmlInBrowser(path);
  openPanelWithRoom();
  openFileTab(path);
}
function openDirInPanel(path) {
  openPanelWithRoom();
  ensureFilesTab();
  if (panelDirDispatch) panelDirDispatch(path);
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
  openPanelWithRoom();
}
function closePanel() {
  if (!panelOpen) return;
  setPanelOpen(false);
  wideOn = false;
  pinMode = null;
  stopPanelResizeWatch();
  setFramePin(null);
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
  tag.textContent = '.fsviewer-toggle{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.fsviewer-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.fsviewer-toggle--active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.fsviewer-iconbtn{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.fsviewer-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}.fsviewer-iconbtn--active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.fsviewer-row{display:flex;align-items:center;padding:2px 4px;cursor:pointer;font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;border-radius:3px}.fsviewer-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.fsviewer-badge{flex:0 0 auto;display:inline-flex;justify-content:center;align-items:center;width:20px;height:14px;border-radius:3px;font-size:8px;font-weight:700;margin-right:4px;color:#fff;mix-blend-mode:normal}.fsviewer-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;max-width:150px;padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap}.fsviewer-tab--active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}.fsv-expanded-frame{grid-template-columns:var(--fsv-grid, 280px minmax(0,1fr) 360px) !important}.fsv-expanded-frame [class*="handle"]{display:none !important}.fsviewer-tip{position:relative}.fsviewer-tip:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);right:0;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);font-size:12px;line-height:1;padding:6px 9px;border-radius:6px;white-space:nowrap;z-index:60;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.18)}.fsviewer-tab-divider{flex:0 0 auto;width:1px;height:14px;background:var(--dsw-alias-border-l1);margin:0 2px}.fsviewer-tab svg{flex:0 0 auto}.fsviewer-plus-menu{position:fixed;z-index:60;min-width:200px;padding:4px;border-radius:10px;border:1px solid ' + V.line + ";background:var(--dsw-specific-sidebar-fill);box-shadow:0 8px 24px rgba(0,0,0,.28)}.fsviewer-tab-path-tip{position:fixed;z-index:61;max-width:min(72vw,560px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);font-size:12px;line-height:1.4;padding:6px 10px;border-radius:6px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.18)}.fsviewer-plus-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:transparent;border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer;font-family:inherit}.fsviewer-plus-item:hover{background:var(--dsw-alias-interactive-bg-hover)}.fsviewer-plus-item svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}.fsviewer-plus-hint{color:var(--dsw-alias-label-secondary);font-size:11px}.fsviewer-tabstrip{scrollbar-width:none;-ms-overflow-style:none}.fsviewer-tabstrip::-webkit-scrollbar{display:none}.fsviewer-empty-item{display:flex;align-items:center;gap:12px;width:100%;padding:14px 18px;border:none;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer;font-family:inherit}.fsviewer-empty-item:hover{background:var(--dsw-alias-interactive-bg-active)}.fsviewer-empty-item svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}.fsviewer-chat-scroll{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-height:0}.fsviewer-chat-user{align-self:flex-end;max-width:88%;background:var(--dsw-alias-interactive-bg-hover);border-radius:12px;padding:8px 11px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}.fsviewer-chat-ai{align-self:stretch;min-width:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);word-break:break-word}.fsviewer-chat-quote{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:3px 8px;border-radius:999px;border:1px solid " + V.line + ";background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;overflow:hidden;white-space:nowrap}.fsviewer-chat-quote.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}";
  document.head.appendChild(tag);
}
const TREE_DEFAULT_WIDTH = 150;
let treeWidth = TREE_DEFAULT_WIDTH;
const Z_TRIGGER = 301;
const EXPAND_CLASS = "fsv-expanded-frame";
let wideOn = false;
let frameStyleObserver = null;
function setFramePin(px) {
  const col = document.querySelector('[class*="detailsCol"]');
  const frame = col && col.parentElement;
  if (!frame) return;
  if (px != null) {
    let last = "";
    const sync = () => {
      const inline = frame.style.gridTemplateColumns;
      if (!inline) return;
      const parts = inline.split(" ");
      if (parts.length < 3) return;
      parts[parts.length - 1] = px + "px";
      const next = parts.join(" ");
      if (next !== last) {
        last = next;
        frame.style.setProperty("--fsv-grid", next);
      }
    };
    sync();
    frame.classList.add(EXPAND_CLASS);
    if (frameStyleObserver) frameStyleObserver.disconnect();
    frameStyleObserver = new MutationObserver(sync);
    frameStyleObserver.observe(frame, { attributes: true, attributeFilter: ["style"] });
  } else {
    if (frameStyleObserver) {
      frameStyleObserver.disconnect();
      frameStyleObserver = null;
    }
    frame.classList.remove(EXPAND_CLASS);
    frame.style.removeProperty("--fsv-grid");
  }
}
const V = {
  fill: "var(--dsw-alias-bg-base, #fff)",
  fg: "var(--dsw-alias-label-primary)",
  muted: "var(--dsw-alias-label-secondary)",
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
function parentDir(p) {
  const s = String(p || "");
  const segs = s.split(/[\\/]+/).filter(Boolean);
  const winDrive = segs.length > 0 && /^[A-Za-z]:$/.test(segs[0]);
  if (segs.length <= (winDrive ? 1 : 0)) return winDrive ? segs[0] + "\\" : "/";
  segs.pop();
  if (winDrive) return segs[0] + "\\" + segs.slice(1).join("\\");
  return "/" + segs.join("/");
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
const isHtmlFile = (name) => /\.(html?|xhtml)$/i.test(name || "");
const PANEL_PATH = "M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z";
function SidebarRightIcon() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("g", { transform: "translate(16 0) scale(-1 1)" }, /* @__PURE__ */ React.createElement("path", { fillRule: "evenodd", clipRule: "evenodd", d: PANEL_PATH, fill: "currentColor" })));
}
function FsToggleButton() {
  const [open] = usePanelOpen();
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
    activePath: null,
    // 当前预览文件（null = 空状态）——由统一页签仓库派生同步
    files: {},
    // path -> { status:'loading'|'ok'|'err', content?, size?, truncated?, binary?, error? }
    sourceMode: false
    // md：false=渲染视图，true=源码
  };
}
function reducer(state, action) {
  switch (action.type) {
    case "setRoot":
      return { ...state, root: action.root };
    case "gotoRoot":
      return { ...state, root: action.root, nonce: state.nonce + 1 };
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
    case "setActive":
      return { ...state, activePath: action.path || null, sourceMode: false };
    case "fileLoading":
      return { ...state, files: { ...state.files, [action.path]: { status: "loading" } } };
    case "fileOk":
      return { ...state, files: { ...state.files, [action.path]: { status: "ok", content: action.content, size: action.size, truncated: action.truncated, binary: action.binary } } };
    case "fileErr":
      return { ...state, files: { ...state.files, [action.path]: { status: "err", error: action.error } } };
    case "toggleSource":
      return { ...state, sourceMode: !state.sourceMode };
    case "restoreTree":
      return { ...state, expanded: action.expanded || {} };
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
function FileRow({ entry, depth, active, tabKind, onActivate, onOpen }) {
  const badge = fileBadge(entry.name);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "fsviewer-row",
      style: { paddingLeft: 20 + depth * 14, ...active ? { backgroundColor: "var(--dsw-alias-interactive-bg-active)" } : null },
      onClick: tabKind === "file" ? onActivate : void 0,
      onDoubleClick: onOpen,
      title: tabKind === "files" ? "\u53CC\u51FB\u6253\u5F00 " + entry.name : entry.path
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
function IconMaximize() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M2.58875 12.3407L6.59167 8.33777L7.66296 9.40808L3.66003 13.411H7.99988V14.8065H3.05457C2.02633 14.8065 1.19324 13.9734 1.19324 12.9452V7.99988H2.58875V12.3407Z", fill: "currentColor" }), /* @__PURE__ */ React.createElement("path", { d: "M12.9452 1.19324C13.9734 1.19324 14.8065 2.02633 14.8065 3.05457V7.99988H13.411V3.66003L9.40808 7.66296L8.33777 6.59167L12.3407 2.58875H7.99988V1.19324H12.9452Z", fill: "currentColor" }));
}
function IconCopy() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("rect", { x: "5.5", y: "5.5", width: "8", height: "8", rx: "1.5", stroke: "currentColor" }), /* @__PURE__ */ React.createElement("path", { d: "M10.5 3.5h-6a1 1 0 0 0-1 1v6", stroke: "currentColor", strokeLinecap: "round" }));
}
function IconFolder() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z", stroke: "currentColor", strokeLinejoin: "round" }));
}
const FINDER_ICON_SRC = "data:image/png;base64,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";
function IconFinder() {
  return /* @__PURE__ */ React.createElement("img", { src: FINDER_ICON_SRC, width: 18, height: 18, alt: "", draggable: false, style: { display: "block", borderRadius: 4.5 } });
}
function IconChatBubble() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M8 1.8c3.6 0 6.5 2.5 6.5 5.6s-2.9 5.6-6.5 5.6c-.7 0-1.4-.1-2-.3l-3.2 1.2c-.4.1-.7-.2-.6-.6l.7-2.6C1.9 9.7 1.5 8.6 1.5 7.4c0-3.1 2.9-5.6 6.5-5.6z", stroke: "currentColor", strokeLinejoin: "round" }), /* @__PURE__ */ React.createElement("path", { d: "M5.2 7.5h.01M8 7.5h.01M10.8 7.5h.01", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }));
}
function IconChatPlus({ size = 40 }) {
  return /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M8 1.8c3.6 0 6.5 2.5 6.5 5.6s-2.9 5.6-6.5 5.6c-.7 0-1.4-.1-2-.3l-3.2 1.2c-.4.1-.7-.2-.6-.6l.7-2.6C1.9 9.7 1.5 8.6 1.5 7.4c0-3.1 2.9-5.6 6.5-5.6z", stroke: "currentColor", strokeWidth: "0.85", strokeLinejoin: "round" }), /* @__PURE__ */ React.createElement("path", { d: "M8 4.9v4.4M5.8 7.1h4.4", stroke: "currentColor", strokeWidth: "0.85", strokeLinecap: "round" }));
}
function IconArrowLeft() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M10 3.5 5.5 8l4.5 4.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }));
}
function IconArrowRight() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "m6 3.5 4.5 4.5L6 12.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }));
}
function IconReload() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M13.2 8a5.2 5.2 0 1 1-1.6-3.75M13.2 1.8v2.9h-2.9", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }));
}
function IconExternal() {
  return /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M7 3.5H4.1c-1 0-1.6.7-1.6 1.6v6.8c0 .9.7 1.6 1.6 1.6h6.8c.9 0 1.6-.7 1.6-1.6V9", stroke: "currentColor", strokeLinecap: "round" }), /* @__PURE__ */ React.createElement("path", { d: "M9.5 2.5h4v4M13.2 2.8 8 8", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }));
}
function IconGlobe() {
  return /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "6.2", stroke: "currentColor", strokeWidth: "1.2" }), /* @__PURE__ */ React.createElement("ellipse", { cx: "8", cy: "8", rx: "2.8", ry: "6.2", stroke: "currentColor", strokeWidth: "1.2" }), /* @__PURE__ */ React.createElement("path", { d: "M1.8 8h12.4", stroke: "currentColor", strokeWidth: "1.2" }));
}
function IconFileLine() {
  return /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M8.8 1.8H4.5c-.9 0-1.6.7-1.6 1.6v9.2c0 .9.7 1.6 1.6 1.6h7c.9 0 1.6-.7 1.6-1.6V6.1L8.8 1.8z", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }), /* @__PURE__ */ React.createElement("path", { d: "M8.6 2v4.2h4.3", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }));
}
function EmptyState() {
  return /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--dsw-alias-label-secondary)" } }, /* @__PURE__ */ React.createElement("svg", { width: "44", height: "44", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M1.5 4.2c0-.9.7-1.6 1.6-1.6h2.8l1.6 1.8h5.4c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6V4.2z", stroke: "currentColor", strokeLinejoin: "round" })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: V.fg } }, "\u6253\u5F00\u6587\u4EF6"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12 } }, "\u53CC\u51FB\u76EE\u5F55\u6811\u4E2D\u7684\u6587\u4EF6\u6253\u5F00"));
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
      className: "fsviewer-iconbtn"
    },
    /* @__PURE__ */ React.createElement(IconCopy, null)
  )), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", overflow: "auto", padding: "0 16px 14px", minWidth: 0 } }, file.status === "loading" ? /* @__PURE__ */ React.createElement("div", { style: { color: V.muted, textAlign: "center", padding: 12, fontSize: 12 } }, "\u23F3 \u52A0\u8F7D\u4E2D...") : file.status === "err" ? /* @__PURE__ */ React.createElement("div", { style: { color: "#e06c75", fontSize: 12 } }, "\u26A0 ", file.error) : file.binary ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: 24, color: V.muted, fontSize: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, marginBottom: 8 } }, "\u{1F5C2}"), "\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u4E0D\u652F\u6301\u9884\u89C8\uFF08", fmtSize(file.size), "\uFF09") : /* @__PURE__ */ React.createElement("div", null, file.truncated ? /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 8px", marginBottom: 8, borderRadius: 4, background: V.input, color: V.muted, fontSize: 11 } }, "\u6587\u4EF6\u8F83\u5927\uFF08", fmtSize(file.size), "\uFF09\uFF0C\u4EC5\u663E\u793A\u524D 1MB") : null, isMd && !state.sourceMode ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, wordBreak: "break-word" } }, /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.MarkdownText, { text: file.content })) : /* @__PURE__ */ React.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: V.mono, fontSize: 11, lineHeight: 1.5, color: V.fg } }, file.content))));
}
function TreeColumn({ workspaces, state, dispatch, width, onResizeStart, tabKind }) {
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
        const html = isHtmlFile(entry.name);
        return /* @__PURE__ */ React.createElement(
          FileRow,
          {
            key: entry.path,
            entry,
            depth,
            tabKind,
            active: !html && entry.path === state.activePath,
            onActivate: () => html ? openHtmlInBrowser(entry.path) : openFileTab(entry.path),
            onOpen: () => {
              if (html) return openHtmlInBrowser(entry.path);
              return tabKind === "files" ? replaceFilesTabWithFile(entry.path) : openFileTab(entry.path);
            }
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
function TabStrip() {
  const panel = usePanelSession();
  const [, force] = React.useState();
  React.useEffect(() => subscribeTabs(() => force({})), []);
  const [menu, setMenu] = React.useState(null);
  const [pathTip, setPathTip] = React.useState(null);
  const plusRef = React.useRef(null);
  const hidePathTip = () => setPathTip(null);
  const openMenu = () => {
    const r = plusRef.current.getBoundingClientRect();
    setMenu({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 210)) });
  };
  const showPathTip = (e, t) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPathTip({ id: t.id, text: t.path, left: Math.max(8, Math.min(r.left, window.innerWidth - 380)), top: r.bottom + 6 });
  };
  const firstBrowser = panel.tabs.find((t) => t.kind === "browser");
  if (pathTip && !panel.tabs.some((t) => t.id === pathTip.id)) setPathTip(null);
  const tabLabel = (t) => {
    if (t.kind === "file") {
      const ws = wsDisplayName(panel.ws);
      return ws ? ws + "/" + baseName(t.path) : baseName(t.path);
    }
    if (t.kind === "files") return "\u6253\u5F00\u6587\u4EF6";
    if (t.kind === "chat") return "\u4FA7\u8FB9\u804A\u5929";
    return panel.browser[t.id] && panel.browser[t.id].title || "\u65B0\u6807\u7B7E\u9875";
  };
  const tabIcon = (t) => {
    if (t.kind === "files") return /* @__PURE__ */ React.createElement(IconFileLine, null);
    if (t.kind === "chat") return /* @__PURE__ */ React.createElement(IconChatBubble, null);
    if (t.kind === "browser") return /* @__PURE__ */ React.createElement(IconGlobe, null);
    return null;
  };
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "fsviewer-tabstrip",
      style: { display: "flex", alignItems: "center", gap: 4, flex: "1 1 auto", minWidth: 0, overflowX: "auto", padding: "6px 0 6px 8px" },
      onMouseLeave: hidePathTip,
      onScroll: hidePathTip
    },
    panel.tabs.map((t) => {
      const active = t.id === panel.activeTabId;
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: t.id }, t.kind === "browser" && firstBrowser && firstBrowser.id === t.id && panel.tabs[0].kind !== "browser" ? /* @__PURE__ */ React.createElement("span", { className: "fsviewer-tab-divider" }) : null, /* @__PURE__ */ React.createElement(
        "span",
        {
          className: "fsviewer-tab" + (active ? " fsviewer-tab--active" : ""),
          onClick: () => activateTab(t.id),
          onMouseEnter: (e) => {
            if (t.kind === "file") showPathTip(e, t);
          },
          onMouseLeave: hidePathTip
        },
        tabIcon(t),
        /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, tabLabel(t)),
        active ? /* @__PURE__ */ React.createElement(
          "span",
          {
            onClick: (e) => {
              e.stopPropagation();
              closeTab(t.id);
            },
            title: "\u5173\u95ED\u9875\u7B7E",
            style: { opacity: 0.7, padding: "0 1px" }
          },
          "\xD7"
        ) : null
      ));
    }),
    panel.tabs.length > 0 ? /* @__PURE__ */ React.createElement(
      "span",
      {
        ref: plusRef,
        className: "fsviewer-tab",
        title: "\u65B0\u5EFA\u9875\u7B7E",
        onClick: () => menu ? setMenu(null) : openMenu()
      },
      "+"
    ) : null,
    pathTip ? /* @__PURE__ */ React.createElement("div", { className: "fsviewer-tab-path-tip", style: { left: pathTip.left, top: pathTip.top } }, pathTip.text) : null,
    menu ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 59 }, onClick: () => setMenu(null) }), /* @__PURE__ */ React.createElement("div", { className: "fsviewer-plus-menu", style: { top: menu.top, left: menu.left } }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "fsviewer-plus-item", onClick: () => {
      setMenu(null);
      openPanelWithRoom();
      newBrowserTab();
    } }, /* @__PURE__ */ React.createElement(IconGlobe, null), /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", textAlign: "left" } }, "\u6D4F\u89C8\u5668"), /* @__PURE__ */ React.createElement("span", { className: "fsviewer-plus-hint" }, "\u2325\u2318T")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "fsviewer-plus-item", onClick: () => {
      setMenu(null);
      openPanelWithRoom();
      ensureFilesTab();
    } }, /* @__PURE__ */ React.createElement(IconFileLine, null), /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", textAlign: "left" } }, "\u6587\u4EF6"), /* @__PURE__ */ React.createElement("span", { className: "fsviewer-plus-hint" }, "\u2318P")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "fsviewer-plus-item", onClick: () => {
      setMenu(null);
      openPanelWithRoom();
      newChatTab();
    } }, /* @__PURE__ */ React.createElement(IconChatBubble, null), /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", textAlign: "left" } }, "\u4FA7\u8FB9\u804A\u5929"), /* @__PURE__ */ React.createElement("span", { className: "fsviewer-plus-hint" }, "\u2325\u2318S")))) : null
  );
}
function FileTreePanel({ workspaces, sessions, sessionId }) {
  const [state, dispatch] = React.useReducer(reducer, void 0, initState);
  React.useEffect(() => {
    panelFileDispatch = (p) => openFileTab(p);
    panelDirDispatch = (p) => dispatch({ type: "gotoRoot", root: p });
    return () => {
      panelFileDispatch = null;
      panelDirDispatch = null;
    };
  }, [dispatch]);
  const activeTab = useActiveTab();
  React.useEffect(() => {
    const p = activeTab && activeTab.kind === "file" ? activeTab.path : null;
    if (p !== state.activePath) dispatch({ type: "setActive", path: p });
  }, [activeTab, state.activePath]);
  const [visible, setVisible] = React.useState(false);
  const [treeW, setTreeW] = React.useState(treeWidth);
  const [treeOn, setTreeOn] = React.useState(true);
  const panelOpen2 = usePanelOpen();
  React.useEffect(() => {
    const p = P();
    if (!p) return;
    if (p.panelOpen != null) {
      if (p.panelOpen) {
        openPanelWithRoom();
        setTimeout(() => {
          if (currentWs && P() === p && p.panelOpen) openPanelWithRoom();
        }, 80);
      } else if (panelOpen2) closePanel();
    }
    if (p.expanded) dispatch({ type: "restoreTree", expanded: p.expanded });
    if (p.treeOn != null) setTreeOn(p.treeOn);
    if (p.treeW != null) {
      treeWidth = p.treeW;
      setTreeW(p.treeW);
    }
  }, [currentWs]);
  React.useEffect(() => {
    const p = P();
    if (!p) return;
    p.panelOpen = panelOpen2;
    p.expanded = state.expanded;
    p.treeOn = treeOn;
    p.treeW = treeW;
    persistPanels();
  }, [currentWs, panelOpen2, state.expanded, treeOn, treeW]);
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
      const root = resolveDefaultRoot();
      if (disposed) return true;
      if (root !== null) {
        dispatch({ type: "setRoot", root });
        setWorkspace(root);
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
  const lastSession = React.useRef(null);
  React.useEffect(() => {
    window.__fsvSessEffect = (window.__fsvSessEffect || 0) + 1;
    window.__fsvSessId = sessionId;
    if (lastSession.current === null) {
      lastSession.current = sessionId;
      return;
    }
    if (lastSession.current === sessionId) return;
    lastSession.current = sessionId;
    let disposed = false;
    const unsubs = [];
    const tryApply = () => {
      const root = resolveDefaultRoot();
      if (disposed || root === null) return false;
      dispatch({ type: "gotoRoot", root });
      setWorkspace(root);
      return true;
    };
    if (tryApply()) return;
    const onChange = () => {
      if (tryApply() && unsubs.length) unsubs.forEach((u) => u());
    };
    try {
      unsubs.push(sessions.list.subscribe(onChange));
      unsubs.push(workspaces.list.subscribe(onChange));
    } catch (e) {
      console.error("[fsviewer] ws switch subscribe:", e);
    }
    let tries = 0;
    const timer = setInterval(() => {
      if (disposed || tryApply() || ++tries > 24) {
        clearInterval(timer);
        unsubs.forEach((u) => u());
      }
    }, 250);
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, [sessionId]);
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
    if (!path) return;
    const entry = state.files[path];
    if (entry && entry.status !== "loading") return;
    let alive = true;
    if (!entry) dispatch({ type: "fileLoading", path });
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
  React.useEffect(() => {
    const f = state.activePath ? state.files[state.activePath] : null;
    if (state.activePath && f && f.status === "ok" && !f.binary && typeof f.content === "string") {
      setCurrentFileCtx({ path: state.activePath, content: f.content, truncated: !!f.truncated });
    } else {
      setCurrentFileCtx(null);
    }
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
    if (wideOn) {
      pinMode = "wide";
      setFramePin(520);
      return;
    }
    pinMode = null;
    const sidebarW = sidebarRenderedWidth();
    if (window.innerWidth - sidebarW - CENTER_MIN_PX < DETAILS_MIN_PX) applySqueezeIfNeeded(sidebarW);
    else setFramePin(null);
  };
  const activeFile = state.activePath ? state.files[state.activePath] : null;
  const kind = activeTab ? activeTab.kind : "empty";
  const showSourceBtn = !!(state.activePath && isMdFile(baseName(state.activePath)) && activeFile && activeFile.status === "ok" && !activeFile.binary);
  const openFolderInSystem = () => {
    if (state.activePath && nativeOpenPath) nativeOpenPath(parentDir(state.activePath)).catch((e) => console.error("[fsviewer] openPath:", e));
  };
  const openFolderTip = /Mac/i.test(navigator.platform || navigator.userAgent) ? "\u5728 Finder \u4E2D\u6253\u5F00" : "\u5728\u6587\u4EF6\u5939\u4E2D\u6253\u5F00";
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
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", minHeight: 56, borderBottom: "1px solid " + V.line, flex: "0 0 auto", paddingRight: 6 } }, /* @__PURE__ */ React.createElement(TabStrip, null), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", marginLeft: "auto", flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: toggleWide,
      "data-tip": wide ? "\u6062\u590D\u9ED8\u8BA4\u5BBD\u5EA6" : "\u52A0\u5BBD\u9762\u677F\uFF08\u6700\u5927 520px\uFF09",
      "aria-label": "\u5207\u6362\u52A0\u5BBD",
      className: "fsviewer-iconbtn fsviewer-tip" + (wide ? " fsviewer-iconbtn--active" : "")
    },
    /* @__PURE__ */ React.createElement(IconMaximize, null)
  ))), kind === "chat" ? /* @__PURE__ */ React.createElement(ChatPanel, { chatId: activeTab.id }) : kind === "browser" ? /* @__PURE__ */ React.createElement(BrowserPane, { tabId: activeTab.id }) : kind === "empty" ? /* @__PURE__ */ React.createElement(EmptyTabsState, null) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 4px 10px", borderBottom: "1px solid " + V.line, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: V.muted } }, state.root ? baseName(state.root) : "\u2026", state.activePath ? /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { style: { color: V.edge } }, " \u203A "), /* @__PURE__ */ React.createElement("span", { style: { color: V.fg } }, baseName(state.activePath))) : null), showSourceBtn ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => dispatch({ type: "toggleSource" }),
      title: "\u5207\u6362\u6E32\u67D3/\u6E90\u7801\u89C6\u56FE",
      style: { cursor: "pointer", flex: "0 0 auto", height: 28, fontSize: 12, lineHeight: 1, padding: "0 10px", borderRadius: 6, border: "1px solid " + V.line, background: state.sourceMode ? V.input : "transparent", color: V.fg, display: "inline-flex", alignItems: "center" }
    },
    state.sourceMode ? "\u6E32\u67D3\u89C6\u56FE" : "\u67E5\u770B\u6E90\u4EE3\u7801"
  ) : null, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setTreeOn(!treeOn),
      "data-tip": treeOn ? "\u6536\u8D77\u6587\u4EF6\u6811" : "\u5C55\u5F00\u6587\u4EF6\u6811",
      "aria-label": "\u5207\u6362\u6587\u4EF6\u6811",
      className: "fsviewer-iconbtn fsviewer-tip" + (treeOn ? " fsviewer-iconbtn--active" : "")
    },
    /* @__PURE__ */ React.createElement(IconFolder, null)
  ), state.activePath ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: openFolderInSystem,
      "data-tip": openFolderTip,
      "aria-label": openFolderTip,
      className: "fsviewer-tip",
      style: { cursor: "pointer", flex: "0 0 auto", height: 28, fontSize: 12, lineHeight: 1, padding: "0 8px", borderRadius: 6, border: "1px solid " + V.line, background: "transparent", color: V.fg, display: "inline-flex", alignItems: "center", gap: 4 }
    },
    /* @__PURE__ */ React.createElement(IconFinder, null),
    "\u6253\u5F00"
  ) : null), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", minHeight: 0 } }, state.activePath ? /* @__PURE__ */ React.createElement(FilePreview, { state }) : /* @__PURE__ */ React.createElement(EmptyState, null), treeOn ? /* @__PURE__ */ React.createElement(TreeColumn, { workspaces, state, dispatch, width: treeW, onResizeStart: onTreeResizeStart, tabKind: kind }) : null)));
}
function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/i.test(s)) return "http://" + s;
  if (/^[a-z0-9][a-z0-9.-]*(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(s)) return "https://" + s;
  return "https://www.bing.com/search?q=" + encodeURIComponent(s);
}
function browserTitle(url) {
  if (!url) return "\u65B0\u6807\u7B7E\u9875";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
function BrowserPane({ tabId }) {
  const panel = usePanelSession();
  const [, force] = React.useState();
  React.useEffect(() => subscribeTabs(() => force({})), []);
  const active = panel.browser[tabId];
  if (!active) return null;
  const patch = (fn) => updateBrowser(tabId, fn);
  const navigate = (raw) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    patch((t) => {
      const hist = t.hist.slice(0, t.idx + 1).concat(url);
      return { ...t, url, input: url, title: browserTitle(url), hist, idx: hist.length - 1 };
    });
  };
  const go = (delta) => patch((t) => {
    const idx = t.idx + delta;
    if (idx < 0 || idx >= t.hist.length) return t;
    return { ...t, idx, url: t.hist[idx], input: t.hist[idx], title: browserTitle(t.hist[idx]) };
  });
  return /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4, padding: "4px 6px 4px 8px", borderBottom: "1px solid " + V.line, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => go(-1),
      disabled: active.idx <= 0,
      "data-tip": "\u540E\u9000",
      "aria-label": "\u540E\u9000",
      className: "fsviewer-iconbtn fsviewer-tip",
      style: { opacity: active.idx <= 0 ? 0.4 : 1 }
    },
    /* @__PURE__ */ React.createElement(IconArrowLeft, null)
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => go(1),
      disabled: active.idx >= active.hist.length - 1,
      "data-tip": "\u524D\u8FDB",
      "aria-label": "\u524D\u8FDB",
      className: "fsviewer-iconbtn fsviewer-tip",
      style: { opacity: active.idx >= active.hist.length - 1 ? 0.4 : 1 }
    },
    /* @__PURE__ */ React.createElement(IconArrowRight, null)
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => patch((t) => ({ ...t, reload: t.reload + 1 })),
      "data-tip": "\u91CD\u65B0\u52A0\u8F7D",
      "aria-label": "\u91CD\u65B0\u52A0\u8F7D",
      className: "fsviewer-iconbtn fsviewer-tip"
    },
    /* @__PURE__ */ React.createElement(IconReload, null)
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "\u8F93\u5165\u7F51\u5740\u6216\u641C\u7D22\u8BCD\uFF0C\u56DE\u8F66\u6253\u5F00",
      value: active.input,
      spellCheck: false,
      readOnly: !!active.internal,
      title: active.internal ? "\u672C\u5730\u6587\u4EF6\u9884\u89C8\uFF08" + active.url + "\uFF09" : void 0,
      onChange: (e) => patch((t) => ({ ...t, input: e.target.value })),
      onKeyDown: (e) => {
        if (e.key === "Enter") navigate(e.currentTarget.value);
      },
      style: { flex: "1 1 auto", minWidth: 0, boxSizing: "border-box", padding: "5px 8px", backgroundColor: V.input, border: "1px solid " + V.line, borderRadius: 6, color: active.internal ? V.muted : V.fg, fontSize: 12 }
    }
  ), !active.internal ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => patch((t) => ({ ...t, proxy: !t.proxy, reload: t.reload + 1 })),
      "data-tip": active.proxy ? "\u4EE3\u7406\u6A21\u5F0F\uFF1A\u7ECF\u4E3B\u673A\u540C\u6E90\u56DE\u6E90\uFF08\u7ED5\u8FC7 X-Frame-Options\uFF09" : "\u76F4\u8FDE\u6A21\u5F0F\uFF1A\u90E8\u5206\u7AD9\u70B9\u4F1A\u62D2\u7EDD\u88AB\u5D4C\u5165\uFF0C\u53EF\u5207\u4EE3\u7406",
      "aria-label": "\u5207\u6362\u4EE3\u7406\u6A21\u5F0F",
      className: active.proxy ? "fsviewer-chat-quote on" : "fsviewer-chat-quote"
    },
    active.proxy ? "\u4EE3\u7406" : "\u76F4\u8FDE"
  ) : null, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        if (!active.url) return;
        const abs = active.url.startsWith("/") ? window.location.origin + active.url : active.url;
        window.open(abs, "_blank", "noopener");
      },
      disabled: !active.url,
      "data-tip": "\u5728\u65B0\u7A97\u53E3\u6253\u5F00",
      "aria-label": "\u5728\u65B0\u7A97\u53E3\u6253\u5F00",
      className: "fsviewer-iconbtn fsviewer-tip",
      style: { opacity: active.url ? 1 : 0.4 }
    },
    /* @__PURE__ */ React.createElement(IconExternal, null)
  )), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", position: "relative", minHeight: 0 } }, panel.tabs.filter((t) => t.kind === "browser").map((t) => {
    const b = panel.browser[t.id];
    if (!b) return null;
    const sandboxed = b.proxy || b.internal;
    return /* @__PURE__ */ React.createElement(
      "iframe",
      {
        key: t.id + "#" + b.reload,
        src: b.url ? b.proxy && !b.internal ? "/fsviewer-api/p/" + b.url : b.url : "about:blank",
        title: b.title,
        sandbox: sandboxed ? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" : "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin",
        style: {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: "none",
          display: t.id === tabId ? "block" : "none",
          backgroundColor: "#fff"
        }
      }
    );
  })));
}
function EmptyTabsState() {
  const rows = [
    { key: "b", icon: /* @__PURE__ */ React.createElement(IconGlobe, null), label: "\u6D4F\u89C8\u5668", hint: "\u2325\u2318T", act: newBrowserTab },
    { key: "f", icon: /* @__PURE__ */ React.createElement(IconFileLine, null), label: "\u6587\u4EF6", hint: "\u2318P", act: ensureFilesTab },
    { key: "c", icon: /* @__PURE__ */ React.createElement(IconChatBubble, null), label: "\u4FA7\u8FB9\u804A\u5929", hint: "\u2325\u2318S", act: newChatTab }
  ];
  return /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, padding: "0 26px", minHeight: 0 } }, rows.map((r) => /* @__PURE__ */ React.createElement("button", { key: r.key, type: "button", className: "fsviewer-empty-item", onClick: r.act }, r.icon, /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", textAlign: "left" } }, r.label), /* @__PURE__ */ React.createElement("span", { className: "fsviewer-plus-hint" }, r.hint))));
}
function ChatMessage({ m }) {
  if (m.role === "user") return /* @__PURE__ */ React.createElement("div", { className: "fsviewer-chat-user" }, m.content);
  const waiting = m.streaming && !m.content && !m.error;
  return /* @__PURE__ */ React.createElement("div", { className: "fsviewer-chat-ai" }, waiting ? /* @__PURE__ */ React.createElement("span", { style: { color: V.muted, fontSize: 12 } }, m.reasoning ? "\u601D\u8003\u4E2D\u2026" : "\u2026") : m.content ? /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.MarkdownText, { text: m.content, streaming: !!m.streaming }) : null, m.note ? /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4, fontSize: 11, color: V.muted } }, "\u24D8 ", m.note) : null, m.error ? /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4, fontSize: 12, color: "#e06c75" } }, "\u26A0 ", m.error) : null);
}
function ChatPanel({ chatId }) {
  hydratePanels();
  const [, force] = React.useState();
  React.useEffect(() => subscribeTabs(() => force({})), []);
  const chat = getChat(chatId);
  const fileCtx = useCurrentFileCtx();
  const [quote, setQuote] = React.useState(false);
  const [text, setText] = React.useState("");
  const endRef = React.useRef(null);
  const modelBtnRef = React.useRef(null);
  const taRef = React.useRef(null);
  const [modelMenu, setModelMenu] = React.useState(null);
  const [models, setModels] = React.useState(modelsCache);
  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!text) {
      el.style.height = "";
      return;
    }
    autoGrow(el);
  }, [text]);
  const tail = chat.messages[chat.messages.length - 1];
  const tailLen = tail ? tail.content.length + (tail.reasoning ? tail.reasoning.length : 0) : 0;
  React.useEffect(() => {
    const el = endRef.current;
    if (el) el.scrollIntoView({ block: "end" });
  }, [chat.messages.length, tailLen, chat.streaming]);
  const effectiveModel = chat.model || modelsCache && modelsCache.default || null;
  const modelLabel = effectiveModel ? effectiveModel.model : "\u9ED8\u8BA4\u6A21\u578B";
  const toggleModelMenu = () => {
    if (modelMenu) return setModelMenu(null);
    const r = modelBtnRef.current.getBoundingClientRect();
    setModelMenu({ left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 260)), bottom: window.innerHeight - r.top + 6 });
    loadModels().then((d) => setModels(d)).catch(() => setModels({ providers: [], default: null }));
  };
  const pickModel = (m) => {
    updateChat(chatId, (cur) => {
      cur.model = m;
      return cur;
    });
    setModelMenu(null);
  };
  const submit = () => {
    const t = text;
    if (!t.trim() || chat.streaming) return;
    setText("");
    const quoted = quote && fileCtx && !fileCtx.binary ? { path: fileCtx.path, content: fileCtx.content, truncated: fileCtx.truncated } : null;
    if (quote) setQuote(false);
    sendChat(chatId, t, quoted);
  };
  return /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, fontFamily: V.font } }, /* @__PURE__ */ React.createElement("div", { className: "fsviewer-chat-scroll" }, chat.messages.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { margin: "auto", textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center", color: V.muted } }, /* @__PURE__ */ React.createElement(IconChatPlus, { size: 40 }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 600, color: V.fg } }, "\u4FA7\u8FB9\u804A\u5929"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13 } }, "\u4FA7\u8FB9\u804A\u5929\u662F\u4E34\u65F6\u804A\u5929\uFF0C\u5173\u95ED\u5E94\u7528\u540E\u4F1A\u6D88\u5931\u3002")) : chat.messages.map((m, i) => /* @__PURE__ */ React.createElement(ChatMessage, { key: i, m })), /* @__PURE__ */ React.createElement("div", { ref: endRef })), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 10px 10px", flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: {
    border: "1px solid var(--dsw-alias-border-l2-darkmode-thin)",
    borderRadius: 22,
    background: "var(--dsw-specific-input-major)",
    boxShadow: "var(--dsw-shadow-lv2)",
    padding: "2px 10px 6px"
  } }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      ref: taRef,
      value: text,
      rows: 1,
      placeholder: "\u8F93\u5165\u6D88\u606F\uFF0CEnter \u53D1\u9001\uFF0CShift+Enter \u6362\u884C",
      onChange: (e) => {
        setText(e.target.value);
        autoGrow(e.target);
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
      },
      style: { display: "block", width: "100%", boxSizing: "border-box", resize: "none", border: "none", outline: "none", background: "transparent", padding: "10px 6px 0", overflow: "hidden", color: V.fg, fontSize: 13.5, lineHeight: 1.45, fontFamily: V.font }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5, padding: "2px 2px 0" } }, fileCtx ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "fsviewer-chat-quote" + (quote ? " on" : ""),
      title: "\u5F15\u7528\u6587\u4EF6\u5185\u5BB9\u4F5C\u4E3A\u4E0A\u4E0B\u6587\uFF1A" + fileCtx.path,
      onClick: () => setQuote(!quote)
    },
    "\u{1F4CE} ",
    baseName(fileCtx.path)
  ) : null, /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto" } }), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      ref: modelBtnRef,
      onClick: toggleModelMenu,
      className: "fsviewer-chat-quote",
      title: "\u9009\u62E9\u6A21\u578B",
      style: { maxWidth: 170 }
    },
    /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, modelLabel),
    /* @__PURE__ */ React.createElement("svg", { width: "10", height: "10", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("path", { d: "m4 6 4 4 4-4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }))
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: chat.streaming ? () => stopChat(chatId) : submit,
      disabled: !chat.streaming && !text.trim(),
      title: chat.streaming ? "\u505C\u6B62\u751F\u6210" : "\u53D1\u9001",
      style: {
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: "none",
        flex: "0 0 auto",
        cursor: chat.streaming || text.trim() ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: chat.streaming ? "var(--dsw-alias-interactive-bg-active)" : text.trim() ? V.accent : "var(--dsw-alias-interactive-bg-hover)",
        color: chat.streaming || text.trim() ? "#fff" : "var(--dsw-alias-label-secondary)"
      }
    },
    chat.streaming ? /* @__PURE__ */ React.createElement("span", { style: { width: 9, height: 9, borderRadius: 2, background: "currentColor", display: "block" } }) : /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M8 13V3.5M8 3.5 3.8 7.7M8 3.5l4.2 4.2", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }))
  )))), modelMenu ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 59 }, onClick: () => setModelMenu(null) }), /* @__PURE__ */ React.createElement("div", { className: "fsviewer-plus-menu", style: { left: modelMenu.left, bottom: modelMenu.bottom, top: "auto", maxHeight: 340, overflowY: "auto", minWidth: 240 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 10px 4px", fontSize: 11, color: V.muted } }, "\u6A21\u578B"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "fsviewer-plus-item", onClick: () => pickModel(null) }, /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", textAlign: "left" } }, "\u9ED8\u8BA4\u6A21\u578B\uFF08\u8DDF\u968F dsh \u8BBE\u7F6E\uFF09"), !chat.model ? /* @__PURE__ */ React.createElement("span", { style: { color: V.accent } }, "\u2713") : null), (models ? models.providers : []).map((p) => /* @__PURE__ */ React.createElement(React.Fragment, { key: p.id }, /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 10px 2px", fontSize: 11, color: V.muted } }, p.name), p.models.length ? p.models.map((m) => {
    const on = chat.model && chat.model.provider === p.id && chat.model.model === m.id;
    return /* @__PURE__ */ React.createElement("button", { key: m.id, type: "button", className: "fsviewer-plus-item", onClick: () => pickModel({ provider: p.id, model: m.id }) }, /* @__PURE__ */ React.createElement("span", { style: { flex: "1 1 auto", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" } }, m.name), on ? /* @__PURE__ */ React.createElement("span", { style: { color: V.accent } }, "\u2713") : null);
  }) : /* @__PURE__ */ React.createElement("div", { style: { padding: "2px 10px 6px", fontSize: 11, color: V.muted } }, "\uFF08\u65E0\u53EF\u7528\u6A21\u578B\uFF09"))), models && !models.providers.length ? /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 10px 8px", fontSize: 12, color: V.muted } }, "\u672A\u53D1\u73B0\u53EF\u7528 provider\uFF0C\u8BF7\u5148\u5728 dsh \u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6A21\u578B") : null, !models ? /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 10px 8px", fontSize: 12, color: V.muted } }, "\u23F3 \u52A0\u8F7D\u6A21\u578B\u76EE\u5F55\u2026") : null)) : null);
}
function installShortcuts() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("keydown", (e) => {
    if (!e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.altKey && e.code === "KeyS") {
      e.preventDefault();
      openPanelWithRoom();
      activateLatestChat();
    } else if (e.altKey && e.code === "KeyT") {
      e.preventDefault();
      openPanelWithRoom();
      newBrowserTab();
    } else if (!e.altKey && e.code === "KeyP") {
      e.preventDefault();
      openPanelWithRoom();
      ensureFilesTab();
    }
  });
}
const inject = ["slots", "workspaces", "sessions", "layout"];
function apply(ctx) {
  injectToggleStyle();
  layoutApi = ctx.layout || null;
  if (typeof window !== "undefined") window.__fsvLayout = layoutApi;
  sessionsSvc = ctx.sessions || null;
  workspacesSvc = ctx.workspaces || null;
  if (ctx.workspaces && typeof ctx.workspaces.openPath === "function") {
    nativeOpenPath = ctx.workspaces.openPath.bind(ctx.workspaces);
    ctx.workspaces.openPath = (path) => {
      if (typeof path === "string" && path.length > 0 && !/[\\/]$/.test(path)) {
        fetchList(path).then(
          () => openDirInPanel(path),
          (e) => {
            if (e && e.message && e.message.includes("\u4E0D\u662F\u76EE\u5F55")) openFileInPanel(path);
            else if (nativeOpenPath) return nativeOpenPath(path);
          }
        );
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
      (props) => React.createElement(
        PanelErrorBoundary,
        null,
        React.createElement(FileTreePanel, { workspaces: ctx.workspaces, sessions: ctx.sessions, sessionId: props.sessionId })
      )
    )
  );
  installShortcuts();
  console.log("[fsviewer] Client plugin loaded (details takeover: unified tabs \u2014 files / browser tabs / side chat)");
}

		return module.exports;
	}
});
