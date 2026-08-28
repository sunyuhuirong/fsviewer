# fsviewer 代码审查报告

> 审查对象：`/Users/xianshengzaiqiyue/Desktop/deepseek-harness/plugin-fsviewer`
> 审查历程：初版（zcode 修改前）→ 复查（zcode 修改后）

---

## 一、插件概述

`fsviewer` 是 dsh web 的一个**纯客户端**插件，在界面右侧以滑出面板展示当前工作区的**目录树**（仅目录，不含普通文件）。数据全部来自 dsh web 浏览器端已有的 `ctx.workspaces` 服务（`listDirectory` / `pickDirectory` / `openPath`），自身不注册任何 Host 端 RPC。UI 通过 `slots.inject('shell.overlay')` 挂载，构建产物为 `window.__ModuleLoader__.load` 浏览器模块格式。

---

## 二、初版审查发现（zcode 修改前）

### Critical
1. **Host 端死代码 + 两套矛盾实现**：`src/host.js` 注册 `fsviewer` RPC，但客户端从未调用；`lib/index.js`（声明的 `main` 入口）又是另一份手写旧版，所有方法返回空数据，与 `src/index.js` 完全不一致。
2. **构建链路断裂、源码与产物不同步**：`package.json` 的 `build` 指向不存在的 `build.js`，无法重建 `lib/`；`src/client.js` 是裸 JSX + 裸 `React.xxx`、无 `import React`，不能直接运行。
3. **文档与实现严重矛盾**：`INSTALL.md` 宣称「Host + fs Service ↔ Client 通过 JSON RPC」架构及「文件预览」功能；实际是纯前端且只显示目录、无文件预览。

### Major
4. `*.bak` 备份文件遗留（`lib/index.js.bak`）。
5. `lib/*.js` 文件权限为 `600`（-rw-------），异常。
6. `package.json` 缺 `files` 字段，发布会携带 `src/`、`.bak`、文档等无关文件。
7. 缺 `react` 依赖声明（`lib/client.js` 运行时 `require("react")` 仅靠 dsh 隐式注入）。
8. 安装文档硬编码机器专属绝对路径 `/Users/xianshengzaiqiyue/...`。
9. 仓库根目录残留试错脚本/文档（`file-tree-viewer.sh`、`install-fsviewer.sh`、`FILE_TREE_VISUAL.md` 等）。

### Minor
10. `host.js` 的 `scanDir` 缺少 `maxDepth<=0` 下限保护，深层目录可能爆栈。
11. `host.js` 中 `cache` 变量声明后从未使用。
12. 无 React 错误边界（error boundary）。
13. 面板 `position:fixed` + 高 `zIndex` 常驻，可能与其他 `shell.overlay` 插件冲突。
14. 搜索仅过滤当前目录层，非全局。
15. 零测试、零 lint 配置。

---

## 三、复查（zcode 修改后）

### 复查结论
**基本通过（有条件）。** 初版全部 Critical 与 5/6 的 Major 已解决，并新增了构建链路、冒烟测试与若干健壮性改进。剩余 1 项 Major（发布卫生）与若干 Minor；最关键的是一项**必须真机验证**的加载风险（N1），静态审查无法确认。

### 逐条核对（初版 → 现状）

| 初版问题 | 级别 | 现状 |
|---|---|---|
| C1 Host 死代码（host.js / lib/index.js / 两套矛盾实现） | Critical | ✅ 已修复：`src/host.js`、`lib/index.js`、`.bak` 全部删除；`src/index.js` 改为无副作用的空 Host 入口 |
| C2 构建断裂、src/lib 不同步、src 无 React import | Critical | ✅ 已修复：新增 `build.js`（esbuild 编译），`src/client.js` 已有 `import * as React from 'react'`；`lib/client.js` 经内容核对含最新源码标识符，已同步 |
| C3 文档与实现矛盾 | Critical | ✅ 已修复：`README` 明确“仅目录、不含文件、无预览”并单列“已知限制”；`INSTALL` 改为纯前端描述，路径用 `<插件路径>` 占位 |
| M4 `*.bak` 遗留 | Major | ✅ 已修复 |
| M5 `lib/*.js` 权限 600 | Major | ❌ **未修复**：`lib/client.js` 仍为 `-rw-------` |
| M6 缺 `react` 依赖声明 | Major | ✅ 已修复：`peerDependencies` 加入 `"react": "^18.2.0"` |
| M7 安装文档硬编码绝对路径 | Major | ✅ 已修复 |
| M8/M9 根目录残留试错脚本/文档 | Minor | ❌ **未修复** |
| m10 `scanDir` 无深度下限 | Minor | ✅ N/A（Host 已删） |
| m11 `cache` 未使用 | Minor | ✅ N/A |
| m12 无错误边界 | Minor | 🟡 部分修复：新增 `humanError` 翻译加载错误，但**仍无渲染级 error boundary** |
| m13 `fixed` + 高 `zIndex` 常驻 | Minor | ❌ 未修复 |
| m14 搜索仅当前层 | Minor | ✅ 已修复：升级为整棵已加载树的深层过滤 |
| m15 零测试 | Minor | ✅ 已修复：新增 `smoke.test.mjs` |

### 新增改进（超出初版要求）
- 响应式面板宽度 `min(320px, 85vw)`。
- 首次点开面板才加载数据，不拖慢启动。
- 分支加载 `disposed` 标记防“数据串台”。
- `package.json` 补 `files` 字段；`dsh.client.inject` 加入 `@deepseek-ai/dsh-client-ui-slots`；`dsh.bundle.patch` 关联 `cordis.patch.yml`。
- 新增 `build.js` + `smoke.test.mjs` + `package-lock.json`。

### 仍存在的问题
1. **M5（Major，发布卫生）**：`lib/client.js` 权限 600。本地运行不受影响，但 `npm pack` 会保留该权限，导致其他用户/CI 无法读取。**建议：`chmod 644 lib/client.js`**，并在 `build.js` 写入后统一修正权限。
2. **m12 / m13（Minor）**：仍缺渲染级 error boundary；面板 `fixed` + 高 `zIndex` 常驻，可能与其它 `shell.overlay` 插件冲突。
3. **M8（Minor）**：仓库根目录试错文件未清理。

### 需真机验证（静态审查无法确认）
- **N1（关键）**：`package.json` 的 `main` / `exports["."]` 指向 `src/index.js`（空 `apply`），真正的 UI 挂载逻辑在 `lib/client.js`（`window.__ModuleLoader__.load` 浏览器模块）。需确认 dsh web 实际加载的是 **`lib/client.js`** 而非 `src/index.js`——否则插件在界面上完全不出现。建议在真实 `dsh web` 环境验证“出现 📁 按钮 + 控制台打印 `Client plugin loaded`”（即 `INSTALL.md` 的“验证安装”步骤）。
- **N2**：双入口语义（`src/index.js` = Host 空入口 / `lib/client.js` = 浏览器入口）建议在 README 用一两句写清，避免后续维护者困惑。
- **N3（可选）**：`smoke.test.mjs` 仅冒烟，未覆盖真实 `workspaces` 调用与组件渲染；可后续补更实质的测试。

---

## 四、建议后续（按优先级）
1. 真机跑一遍 `dsh web` 验证插件实际加载并渲染（N1）——这是上线前必须项。
2. `chmod 644 lib/client.js`，并在 `build.js` 末尾补权限修正（M5）。
3. 清理仓库根目录试错文件 `*.sh` / `FILE_TREE_VISUAL.md` / `MANUAL_INSTALL.md` / `PLUGIN_INSTALLATION_SUMMARY.md`（M8）。
4. 视情况补渲染级 error boundary、README 双入口说明（m12 / N2）。

---

## 五、终验记录（2026-08-28，真机测试）

### 遗留项处理
| 项 | 处理结果 |
|---|---|
| M5 权限 600 | ✅ `build.js` 写入后 `chmod 644`，产物已为 `-rw-r--r--` |
| m12 无错误边界 | ✅ 新增 `PanelErrorBoundary`（渲染崩溃只显示 ⚠ 角标，可点击复位，不拖垮宿主） |
| m13 zIndex 冲突 | ✅ 常量化并降为 300/301（低于宿主弹窗层，避开常见的 1000 撞值） |
| M8 根目录试错文件 | ✅ 5 个文件已删除（删除前逐一查验确认为早期试错产物） |
| N2 双入口说明 | ✅ README「开发与构建」一节补齐 |

### N1 真机验证过程中发现并修复的三个真实问题（静态审查不可见）
1. **profile `node_modules/fsviewer` 符号链接丢失**：loader 解析不到包，patch 插入静默失效，插件完全不加载。→ 重建链接。
2. **安装方式不规范**：手工 patch 插入不是 dsh 的标准装载方式。→ 改为 `dsh.profile.bundles` + 插件自带 `dsh.bundle.patch`（对齐 shl-session-history 的官方模式）。
3. **browse 能力缺失**：本地 macOS 下 `directory-picker-auto` 解析为 native 后端，`host.listDirectory` 直接报错。→ 按官方换装点在 profile 补丁层禁用 auto、插入 browse 后端两行（host + 浏览器半身）。

### 真机验证结果（全部通过）
- 服务端：`/plugins/fsviewer/client.js` 与 browse 后端客户端均返回 200，启动日志无错误。
- 浏览器：📁 按钮出现；点开面板加载真实目录数据（deepseek-harness 工作区的
  docs / market-submission / plugin-fsviewer / plugin-shl）；点击目录名可进入，
  面包屑正确更新（`/ Desktop / deepseek-harness / plugin-fsviewer`）；截图确认
  深色面板、工具条、搜索框、目录列表渲染正常。
- 冒烟测试：`npm test` 通过（模块信封、inject/apply 契约、slot 挂载流程）。

### 结论
**通过。** 全部 Critical / Major / Minor 项已闭环，插件在本机 dsh web 真实可用。
安装依赖项（bundles 注册 + browse 后端固定）已写入 INSTALL.md。

---

## 六、第二轮改造记录（2026-08-28，停靠式右侧边栏）

### 背景
用户反馈 opencode 版本两个问题：按钮图标不显示、面板以浮层弹窗形式展开而非侧边栏。
要求改为真正的右侧边栏（内容被推开），按钮放顶部 Session log 导出按钮右边。

### 根因与改造
| 问题 | 根因 | 处理 |
|---|---|---|
| 图标不显示 | opencode 引用了 `IconFolderOpenOutline16`，primitives 包内无此导出（实际为 `IconFolderOpen16`/`IconFolderClose16`），渲染为空 | 改为内联 SVG「右侧栏」图标（用户指定图标的水平镜像：圆角方框 + 靠右竖线），`currentColor` 随主题着色，彻底移除 primitives 依赖 |
| 弹窗式展开 | `shell.overlay` 是浮层，`position:fixed` 盖在内容上 | 利用 ui-layout 的 `ctx.layout.openDetails()/closeDetails()`：打开时先 `closeDetails()` 再 `openDetails()` 归一到 360px 撑开原生右栏（内容被推开），面板浮层精确覆盖右栏区域（宽度对齐 `min(360px, 85vw)`）；关闭时两者一起收起 |
| 面板配色与宿主割裂 | 硬编码 VS Code 深色配色 | 全部改走宿主主题变量（`--dsw-specific-sidebar-fill`/`--dsw-alias-label-*`/`--dsw-alias-border-*`），明暗主题自动适配；去掉浮层大阴影，左边界框对齐原生右栏 |
| 切换会话面板残留 | 原生布局切会话会自动收右栏，浮层不知情 | 按钮组件注册时透传 props（session 作用域拿到 `sessionId`），检测变化自动 `closePanel()`；组件卸载兜底收起 |
| primitives 依赖残留 | package.json inject/peerDeps 含未安装包 | 已移除，inject 恢复为 runtime + ui-slots + ui-workspace，新增 `layout` 服务声明 |

### 已知取舍（明示）
- 文件树打开时盖住原生「工具调用详情」面板（`details` Slot 为 single 且被 conversation 占用，
  插件无法共存注册）——查看工具详情需先关闭文件树；文件树关闭时原生功能完全不受影响。
- 无会话的空白首页右栏机制不展开（`detailsSession` 为空时列宽恒 0），此时退化为浮动样式。
- 面板打开后顶部按钮随中栏左移，关闭靠再次点按钮或面板 ✕。

### 验证（真机，dsh web @ localhost:3080）
- `npm run build` + `npm test` 通过（inject 契约含 layout，slots 挂载流程正常）。
- 图标：按钮渲染于 Session log 右侧（x=1224，紧邻 111px 宽的导出按钮），SVG 竖线靠右（镜像正确）。
- 停靠：点开后 Session log 按钮 x 1160→783（内容被推开），面板 right=0、宽 360px；
  关闭后回到 1105（内容弹回），按钮 active 态正确切换。
- 会话切换：面板打开状态下切到另一会话，面板自动收起、内容弹回。
- 目录数据正常：面包屑 `/ Users / xianshengzaiqiyue / Desktop / deepseek-harness`，
  树列出 docs / market-submission / plugin-fsviewer / plugin-shl。

### 结论
**通过。** 停靠式右侧边栏按用户指定图标与位置落地，明暗主题适配，会话切换同步收起。
