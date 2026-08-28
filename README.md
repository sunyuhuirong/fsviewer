# 文件管理器插件 (fsviewer)

在 dsh web 界面的**原生右侧栏**中提供一个 Codex 式文件浏览器：左侧 Markdown 渲染
预览、右侧文件树（目录 + 文件，彩色类型徽章）同屏显示，支持页签、查看源代码、
目录过滤，并可用系统默认应用打开。

## 功能特性

- 🗗 **原生右栏接管**：顶部会话头的「右侧栏」按钮（位于 Session log 导出按钮右边）
  点击后经布局服务撑开原生右栏，文件面板直接渲染在右栏内——推挤、拖宽
  （300–520px，拖拽分隔条）、开合动画全部是原生行为
- 🖥 **Codex 式布局**：
  - 顶部页签栏（文件名 + ×，末尾 + 聚焦筛选框）
  - 第二栏：`根目录 › 文件名` 面包屑 + 「查看源代码」+ 文件夹图标（树栏收展）+ 「⧉ 打开」
  - 左侧预览区：文件大标题 + 复制按钮；未选文件时显示「打开文件」空状态
  - 右侧树栏（常显，150px 起可拖拽调宽）：筛选框 + 目录文件树
- 🌲 **目录 + 文件**混合树：懒加载，文件带彩色类型徽章（MD 绿 / JSON 黄 / JS·TS 蓝 /
  YAML 红 / SQL 紫……），激活文件高亮；点目录名展开/收起
- 📝 **Markdown 渲染预览**：复用官方聊天同款 `MarkdownText`（GFM 表格、代码高亮、
  数学公式），「查看源代码」一键切原始文本
- 🧭 面包屑导航；🔍 筛选文件（目录与文件名都匹配，自动保留匹配项的上级路径）
- 📂 原生目录选择器切换根目录；⧉ 用系统默认应用打开文件
- 🆕 面板可见时自动刷新目录树——会话中刚产生的文件立即可见
- 🎨 配色走宿主主题变量（明暗主题自动适配）；切换会话时右栏随原生行为收起

## 实现方式（原生右栏接管）

原生 `details` 右栏是 single 槽位且默认被会话插件的「工具调用详情」面板占用。
dsh 槽位系统原生支持**影子注册**：同槽位可用不同 `priority` 共存，**priority 最低者
渲染**。本插件以 `priority: -10` 注册文件面板接管右栏；**插件停用后原生工具详情
面板自动恢复**。代价：插件启用期间，点击聊天里的工具调用行不再显示工具详情
（右栏显示的是文件面板）。

## 已知限制

- 预览支持：`.md` 渲染 + 一切 UTF-8 文本文件的源码查看；二进制文件不预览
  （提示 + 系统打开入口）。读取上限 1MB，超出只显示前 1MB 并提示。
- 会话聊天消息里的文件引用点击暂不接入（在侧栏树里点击即可）。
- 文件面板打开时会盖住原生「工具调用详情」面板——想查看工具详情先关闭文件面板
  （关闭时原生功能完全不受影响）。
- 过滤只作用于已加载（展开过）的部分；未展开的目录需先展开才会参与过滤。
- 依赖 host 的 **browse 目录能力**：本地 macOS/Windows 下 dsh 默认解析为 native
  后端（不支持目录列举），需在 profile 补丁层把 directory-picker 固定为 browse
  后端，配置方法见 [INSTALL.md](INSTALL.md) 第 3 步。

## 使用方法

1. 进入任一会话，点击顶部 **Session log 导出按钮右边**的「右侧栏」图标按钮展开面板
   （默认根目录 = 当前会话的工作目录；面板可见时才加载数据）。
   展开时原生右栏**推挤聊天内容**；**再次点击同一按钮收起**
2. 右侧树栏点击 ▸ 展开目录、点击文件在左侧预览（.md 渲染排版，其他文本显示源码）
3. 顶部页签切换/关闭已打开文件；未打开文件时显示「打开文件」页签与空状态
4. 「查看源代码」切换渲染/源码；「⧉ 打开」用系统应用打开文件；
   **面包屑行的文件夹图标收起/展开右侧文件树**
5. 拖拽面板与聊天之间的**原生分隔条**调整右栏宽度（300–520px）

## 安装

本地开发安装：编辑 `~/.dsh/profiles/web/cordis.patch.yml` 加入

```yaml
- insert:
    - id: fsviewer
      name: 'fsviewer'
```

并在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 里加上
`"fsviewer": "link:/绝对路径/plugin-fsviewer"`，然后执行 `pnpm install`。
改动后需重启 `dsh web` 生效（本插件有主机半边，**必须重启**）。完整步骤见
[INSTALL.md](INSTALL.md)。

## 开发与构建

- 源码：`src/client.js`（浏览器端 UI）+ `src/index.js`（主机端 HTTP 路由）。
- `lib/client.js` 是浏览器端构建产物，由 `npm run build` 生成，**请勿手改**。
- 修改源码后：`npm run build` → **重启 `dsh web`**（主机半边变了必须重启；
  只改客户端时刷新页面即可）。

**双入口说明**（避免困惑）：
- `src/index.js` 是 Host / Cordis 加载器入口（`package.json` 的 `main`）——通过
  `ctx.webServer.register()` 注册 `/fsviewer-api` 路由（见下）。
- `lib/client.js` 是浏览器端 UI 入口（`package.json` 的 `dsh.client` 声明让 dsh web 把它
  自动编入浏览器模块图，经 `window.__ModuleLoader__.load` 加载并调用其 `apply`）。

## 技术架构

- **主机半边**（`src/index.js`，inject `webServer`）：
  - `GET /fsviewer-api/list?path=<绝对路径>` —— 列目录（目录+文件，含类型/隐藏标记、
    面包屑，1000 项截断）
  - `GET /fsviewer-api/file?path=<绝对路径>` —— 读文本（1MB 上限截断，
    严格 UTF-8 解码 + NUL 嗅探检测二进制，二进制不回传内容）
- **浏览器半边**（`src/client.js`，inject `slots/workspaces/sessions/layout`）：
  - 目录树数据来自上面的 `/fsviewer-api/list`；`workspaces.list` 与会话 `cwd`
    用于解析默认根目录；选择目录 / 系统打开继续用 `workspaces`
  - Markdown 用 `@deepseek-ai/dsh-client-ui-primitives` 导出的 `MarkdownText` 渲染
  - 顶部按钮注册到 `conversation.session.header.utilities` Slot（session 作用域），
    点击经 `ctx.layout` 开/收原生右栏
  - 文件面板以 `priority: -10` **影子注册接管原生 `details` 右栏**（原生推挤/拖宽/
    开合；插件停用后原生工具详情面板自动恢复）

## 安全说明

`/fsviewer-api` 路由**无鉴权**，可读取本机任意绝对路径的文件——与官方 browse
目录选择后端同一信任级别（browse 本就能列任意绝对路径，`openPath` 亦然）。
这是面向本机个人工具的设计，**请勿在多用户网络暴露环境下使用**。
