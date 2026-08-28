# fsviewer 安装指南

一个纯客户端插件：在 dsh web 界面右侧展示**目录树**。
注意：只显示目录（文件夹），**不显示普通文件，也不支持预览文件内容**。

## 前置条件

- 已安装 Node.js 18+ 与 dsh
- 本插件目录的绝对路径（下文用 `<插件路径>` 表示，例如 `/Users/你/Desktop/deepseek-harness/plugin-fsviewer`）

## 重要：本插件依赖 browse 目录能力

`fsviewer` 的目录数据来自 `host.listDirectory`（browse 能力）。dsh 默认的
`directory-picker-auto` 在**本地 macOS/Windows 启动**时会解析为 native 后端
（只弹系统选框，不支持目录列举），导致面板报错
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

1. 页面右侧中部出现蓝色 📁 按钮
2. 点开按钮，面板显示当前工作区的子目录列表（真实数据）
3. 点击目录名可进入，面包屑可回退
4. 服务端自检：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/plugins/fsviewer/client.js` 应返回 `200`

## 常见问题

| 现象 | 可能原因与处理 |
|------|----------------|
| 没有出现 📁 按钮 | `dsh.profile.bundles` 没加 `fsviewer`；`node_modules/fsviewer` 链接丢失（重新 `pnpm install` 或手工重建链接）；改完忘记重启 |
| 面板报 `needs the browse capability` | 第 3 步的 browse 后端配置缺失或写错 |
| 改了代码不生效 | 先在插件目录执行 `npm run build` 重新生成 `lib/client.js`，再重启 dsh web |

## 从源码构建

```sh
cd <插件路径>
npm install        # 首次需要，安装构建工具 esbuild
npm run build      # 生成 lib/client.js
npm run dev        # 或：监听 src/ 变化自动重建
npm test           # 冒烟测试（无需浏览器）
```

`lib/client.js` 是构建产物，请勿手改；所有改动请写在 `src/` 目录。
