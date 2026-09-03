# fsviewer

dsh web 的右侧文件管理器：目录树 + 文件预览（Markdown 渲染 / 源码），接管原生 details 右栏。

![License: MIT](https://img.shields.io/badge/license-MIT-green)

> **⚠️ 安全提示：** 这是本机个人工具。host 半边通过 `/fsviewer-api` 路由直接用 Node `fs` 读取本机**任意绝对路径**，无任何鉴权（与 dsh 原生 browse 目录后端同级）。**请勿在多用户或网络暴露的环境中使用。**

## 目录

- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [功能特性](#功能特性)
- [架构](#架构)
- [已知限制](#已知限制)
- [许可证](#许可证)

## 环境要求

- Node.js 18+
- 已安装并配置 `web` profile 的 dsh（DeepSeek Harness）
- 该 profile 以 pnpm 管理依赖

## 安装

1. 获取插件源码（任选其一）：
   - 克隆本仓库：
     ```bash
     git clone https://github.com/sunyuhuirong/fsviewer.git YOUR_PLUGIN_PATH
     ```
   - 或直接使用本地插件目录路径。
2. 把插件链接进 dsh 的 web profile。编辑 `~/.dsh/profiles/web/package.json`：
   ```json
   {
     "dependencies": {
       "fsviewer": "link:YOUR_PLUGIN_PATH"
     },
     "dsh": {
       "profile": {
         "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "fsviewer"]
       }
     }
   }
   ```
3. 安装依赖（web profile 使用 pnpm）：
   ```bash
   cd ~/.dsh/profiles/web && pnpm install
   ```
   > 安装后请确认 `node_modules/fsviewer` 符号链接存在：`ls node_modules/fsviewer`
4. 重启 `dsh web`：
   ```bash
   dsh web
   ```

插件自带的 `cordis.patch.yml` 会经 `dsh.bundle.patch` 自动并入 profile 加载层，无需手动改动；更完整的安装与 browse 后端说明见 [INSTALL.md](INSTALL.md)。

## 使用

1. 进入任一会话，点击顶部 **Session log 导出按钮右边**的「右侧栏」图标按钮，面板接管原生右侧 `details` 栏并滑入。
2. 右侧文件树栏：点击 ▸ 展开目录、点击目录名进入；筛选框按名称过滤；拖拽左缘调整树栏宽度（120–320px），点文件夹图标可收起/展开树栏。
3. 点击文件：左侧预览区渲染内容。Markdown 文件可切「查看源代码 / 渲染视图」；文本文件显示源码；二进制或超大文件给出提示并提供「⧉ 打开」用系统应用打开。
4. 顶部「⧉ 打开」按钮用系统默认应用打开当前文件；「⤢」按钮在默认宽度（360px）与加宽（520px）间切换。
5. 会话中点击文件引用（如工具产出的路径）会改道到本面板预览，而非弹出系统选择框。
6. 再次点击顶部按钮（或面板内「打开文件」伪页签的 ×）收起面板；切换会话时自动收起。

## 功能特性

- 🗜 **接管原生右栏**：渲染在 dsh 原生 `details` 列内（priority -10 影子注册），与布局/主题一致；插件停用后原生工具详情自动恢复。
- 🌲 **目录树 + 文件列表**：host 路由真实列举目录与文件（含类型徽章、隐藏项标记），懒加载、名称筛选。
- 👁 **文件预览**：Markdown 用官方 `MarkdownText` 渲染并支持源码切换；文本显示源码；二进制 / 超大文件给出提示并提供系统打开。
- 📑 **多文件页签**：已打开文件以页签呈现，可切换 / 关闭。
- 📋 **复制内容**：预览区一键复制文件全文。
- 🧭 **面包屑 + 智能默认根**：默认根优先取当前会话工作目录（cwd），回退到最近 workspace；面包屑可回退。
- 🗂 **按工作区彻底隔离**：页签 / 文件树展开 / 树栏开关与宽度 / 浏览器页签 / 侧边聊天（含历史）均按 `workspaceId` 独立存储；切换工作区（侧边栏换会话、工作区选择器、存储装载）整体切换面板，原地恢复各自状态。
- 🖱 **会话文件引用改道**：拦截 `workspaces.openPath`，会话内点击文件直接在本面板预览。
- 🎨 **明暗主题自适应**：配色全部走 dsh 主题变量。

## 架构

插件由**浏览器端（client）**与 **host 端（Node）**两部分组成：

- **Client（`src/client.js`，经 `npm run build` 生成 `lib/client.js`）**：由 dsh 浏览器模块图加载，注册顶部按钮与 `details` 面板；目录 / 文件数据通过同源 `fetch` 调用 host 路由。
- **Host（`src/index.js`，Cordis 插件入口）**：通过官方 `ctx.webServer.register` 注册前缀路由 `/fsviewer-api`：
  - `GET /fsviewer-api/list?path=<绝对路径>` —— 列目录（目录 + 文件，含 `type` / `hidden` 标记，单目录最多 1000 项）
  - `GET /fsviewer-api/file?path=<绝对路径>` —— 读文本文件（1MB 上限，前 8KB 含 NUL 判为二进制，超大文件截断并返回 `truncated`）

数据读取由 host 直接用 Node `fs` 完成，**不依赖 dsh 的 browse 目录能力**；仅「选择目录 / 系统打开」复用 dsh 的 `workspaces` 服务。

## 已知限制

- host 路由无鉴权，可读取本机任意绝对路径（见上方安全提示）。
- 单目录最多列举 1000 项，超出截断。
- 文件预览上限 1MB；超出部分截断显示，不返回二进制内容。
- 「选择目录」走 dsh 原生目录选择器，其行为受 profile 的 directory-picker 后端配置影响（详见 [INSTALL.md](INSTALL.md)）。

## 许可证

[MIT](LICENSE)
