# fsviewer 安装指南

一个「主机 + 浏览器」双半边插件：在 dsh web 界面右侧停靠**文件浏览器**——
目录树（目录 + 文件，带彩色类型徽章）、**Markdown 渲染预览**（可切源码）、
文件页签、面包屑导航与目录过滤。

## 前置条件

- 已安装 Node.js 18+ 与 dsh
- 本插件目录的绝对路径（下文用 `<插件路径>` 表示，例如 `/Users/你/Desktop/deepseek-harness/plugin-fsviewer`）

## 重要 1：必须重启 dsh web

本插件有**主机半边**（通过 `ctx.webServer` 注册 `/fsviewer-api` 文件读取路由），
主机半边只在 `dsh web` 启动时加载。改完安装配置或重新构建后，**必须重启 dsh web**；
只改浏览器端代码（src/client.js → npm run build）时刷新页面即可。

## 重要 2：本插件依赖 browse 目录能力

`fsviewer` 的「选择目录 / 系统打开」来自 `host.listDirectory` 等 browse 能力。dsh 默认的
`directory-picker-auto` 在**本地 macOS/Windows 启动**时会解析为 native 后端
（只弹系统选框，不支持目录列举），导致相关功能报错
`host.listDirectory needs the browse capability`。

因此安装时需按官方换装点把目录选择器固定为 browse 后端（见下面第 3 步）。
副作用：全应用的「选择目录」交互会从系统弹窗变为应用内对话框。

## 安装步骤

### 1. 把插件链接进 profile

编辑 `~/.dsh/profiles/web/package.json`：

- 在 `dependencies` 中加入（把 `<插件路径>` 换成真实绝对路径）：

  ```json
  "fsviewer": "link:<插件路径>"
  ```

- 在 `dsh.profile.bundles` 数组末尾加入 `"fsviewer"`（与 dshmarket、
  shl-session-history 等插件并列）：

  ```json
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "fsviewer"]
    }
  }
  ```

然后安装依赖（该 profile 使用 pnpm）：

```sh
cd ~/.dsh/profiles/web && pnpm install
```

> 注意：`pnpm install` 后请确认 `node_modules/fsviewer` 符号链接存在
> （`ls node_modules/fsviewer`）。已发生过链接被清掉导致插件静默失效的情况。

### 2. 确认插件自带的 bundle 补丁

插件根目录的 `cordis.patch.yml` 内容应如下（已随插件提供，无需修改）：

```yaml
- insert:
    - id: fsviewer
      name: 'fsviewer'
```

### 3. 在 profile 补丁层固定 browse 目录后端

编辑 `~/.dsh/profiles/web/cordis.patch.yml`（顶层是 YAML 数组）：

```yaml
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-surface
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

> 提示：手动编辑 YAML 时用两个空格缩进，不要用 Tab；改坏了删掉刚加的几行即可恢复。

### 4. 重启 dsh web

```sh
dsh web
```

## 验证安装

浏览器打开 dsh web 后：

1. 顶部 Session log 导出按钮右边出现「右侧栏」图标按钮；`dsh web` 启动日志含
   `[fsviewer] Host routes ready`
2. 点开按钮，面板显示当前会话工作目录的**目录 + 文件**列表（文件带彩色徽章）
3. 点击 `.md` 文件直接渲染预览（「源码」按钮可切原始文本）；点击目录名可进入，面包屑可回退
4. 接口自检：
   `curl -s 'http://127.0.0.1:3080/fsviewer-api/list?path=/tmp'` 应返回 JSON（entries 数组）

## 常见问题

| 现象 | 可能原因与处理 |
|------|----------------|
| 没有出现「右侧栏」按钮 | `dsh.profile.bundles` 没加 `fsviewer`；`node_modules/fsviewer` 链接丢失（重新 `pnpm install` 或手工重建链接）；改完忘记重启；当前在空白首页（需先进入一个会话） |
| 面板显示「未检测到 workspace 根目录」 | 稍等片刻（列表异步装载）或用「📂 选择目录」手动指定根目录 |
| 点击文件预览报网络异常 | 主机半边未加载：确认 `dsh web` 启动日志有 `[fsviewer] Host routes ready`；没有则重启 dsh web |
| 「选择目录/打开」报 `needs the browse capability` | browse 后端配置（第 3 步）缺失或写错 |
| 改了代码不生效 | `npm run build` 后：只改了 src/client.js 刷新页面即可；动过 src/index.js 必须重启 dsh web |

## 从源码构建

```sh
cd <插件路径>
npm install        # 首次需要，安装构建工具 esbuild
npm run build      # 生成 lib/client.js
npm run dev        # 或：监听 src/ 变化自动重建
npm test           # 冒烟测试（无需浏览器）
```

`lib/client.js` 是构建产物，请勿手改；所有改动请写在 `src/` 目录。
