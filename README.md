# 文件管理器插件 (fsviewer)

在 dsh web 界面右侧展示工作区的**目录树**（仅目录，不含文件），支持展开/折叠、面包屑导航、
目录树过滤，并可用系统默认应用打开目录。

## 功能特性

- 🗗 **停靠式右侧边栏**（非弹窗）：顶部会话头的「右侧栏」按钮（位于 Session log 导出按钮
  右边）点击后，通过宿主布局服务 `ctx.layout` 撑开原生右栏把中间内容推开，文件树精确
  停靠在右栏区域上——观感即原生侧边栏
- 🌲 目录树懒加载（展开时才拉取子目录，首次点开才请求根目录，不拖慢启动）
- 🧭 面包屑导航 + 点击目录名进入子目录
- 🔍 过滤已加载的目录树（自动保留匹配项的上级路径）
- 📂 原生目录选择器切换根目录
- ⧉ 用系统默认应用打开目录
- 📱 面板宽度自适应窄屏（桌面 360px，与原生右栏默认宽度对齐；窄屏收缩到视口 85%）
- 🎨 配色走宿主主题变量（明暗主题自动适配），切换会话时自动收起

## 已知限制

- 底层接口 `workspaces.listDirectory` 只返回目录，因此**不显示普通文件**，也不支持文件内容预览。
- 文件树打开时会盖住原生「工具调用详情」面板——想查看工具详情先关闭文件树
  （文件树关闭时原生详情功能完全不受影响）。
- 过滤只作用于已加载（展开过）的部分；未展开的目录需先展开才会参与过滤。
- 依赖 host 的 **browse 目录能力**：本地 macOS/Windows 下 dsh 默认解析为 native
  后端（不支持目录列举），需在 profile 补丁层把 directory-picker 固定为 browse
  后端，配置方法见 [INSTALL.md](INSTALL.md) 第 3 步。

## 使用方法

1. 进入任一会话，点击顶部 **Session log 导出按钮右边**的「右侧栏」图标按钮展开面板
   （首次点开时才开始加载）
2. 点击 ▸ 箭头展开/收起目录
3. 点击目录名进入该目录（面包屑可回退）
4. 点击 ⧉ 在系统文件管理器中打开
5. 再次点击顶部按钮（或面板 ✕）收起；切换会话时自动收起

## 安装

本地开发安装：编辑 `~/.dsh/profiles/web/cordis.patch.yml` 加入

```yaml
- insert:
    - id: fsviewer
      name: 'fsviewer'
      path: '/绝对路径/plugin-fsviewer'
```

并在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 里加上
`"fsviewer": "link:/绝对路径/plugin-fsviewer"`，然后执行 `pnpm install`。
改动后需重启 `dsh web` 生效。完整步骤见 [INSTALL.md](INSTALL.md)。

## 开发与构建

- 源码只有一份：`src/client.js`（浏览器端 UI）+ `src/index.js`（Host 端空入口）。
- `lib/client.js` 是构建产物，由 `npm run build` 生成，**请勿手改**。
- 修改源码后：`npm run build` → 重启 `dsh web`。

**双入口说明**（避免困惑）：
- `src/index.js` 是 Host / Cordis 加载器入口（`package.json` 的 `main`）——本插件是纯客户端
  插件，Host 端无逻辑，此入口只为了让加载器有一个合法模块可加载。
- `lib/client.js` 才是浏览器端 UI 入口（`package.json` 的 `dsh.client` 声明让 dsh web 把它
  自动编入浏览器模块图，经 `window.__ModuleLoader__.load` 加载并调用其 `apply`）。

## 技术架构（纯前端）

- **数据层**：复用 dsh web 已有的 `ctx.workspaces`（client-runtime 提供）
  - `listDirectory` 懒加载目录层级（Host browse RPC，仅返回目录）
  - `pickDirectory` 原生目录选择 / `openPath` 系统打开
- **布局层**：复用 ui-layout 的 `ctx.layout`（`openDetails`/`closeDetails`）实现停靠式展开
- **Client**：React 组件（esbuild 编译为 `window.__ModuleLoader__.load` 模块）：
  - 顶部按钮注册到 `conversation.session.header.utilities` Slot（session 作用域，
    透传 `sessionId` 用于切换会话时自动收起）
  - 文件树面板注册到 `shell.overlay` Slot，视觉上精确覆盖原生右栏区域
- **Host**：无逻辑（纯客户端插件，不注册任何 RPC）
