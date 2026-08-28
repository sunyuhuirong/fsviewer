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

---

## 七、第三轮改造记录（2026-08-28，文件列表 + Markdown 预览）

### 需求
用户展示参考截图：文件浏览器带文件类型徽章 + 点击 .md 文件右侧渲染预览 + 空状态。
要求插件从「仅目录树」升级为「文件浏览器 + Markdown 预览」。

### 关键技术决策（探索结论）
1. **浏览器读文件的正解 = 插件自挂 HTTP 路由**：apiproxy 的 /api 方法表是编译期固定的
   （RpcMethodMap key 覆盖编译器强制），插件不可扩展；`harness.handle`/`host.call`
   仅限 cordis_define 动态包。唯一官方通道是 dsh-host-webserver 的
   `ctx.webServer.register()` 路由注册服务（frontend-static 即用此模式挂 fallback）。
2. **Markdown 渲染 = 复用官方 `MarkdownText`**（@deepseek-ai/dsh-client-ui-primitives
   导出，conversation 聊天同款：GFM/Shiki/KaTeX）。此前图标失败是导出名不存在，
   不是模块解析问题——该包本就在浏览器模块图里。
3. **默认根目录 = 当前会话 cwd**：sessions.list 快照 byId[current].cwd（比 workspaces
   列表更贴切——直接是用户正在聊天的项目；workspaces 列表是惰性装载，可能永远为空）。

### 改动
| 文件 | 内容 |
|---|---|
| `src/index.js` | 主机半边从空入口变为真实现：`inject=['webServer']`，注册 `/fsviewer-api` 前缀路由（list：目录+文件、readdir withFileTypes、目录前文件后排序、1000 截断；file：1MB 上限、严格 UTF-8 + NUL 嗅探二进制检测、二进制不回传）。node:fs/promises 直读，与 browse 后端同信任级别（无鉴权，README 明示） |
| `src/client.js` | 树新增文件行（彩色 monogram 徽章 20+ 类型映射）；两态视图 tree⇄file；文件页签（打开/切换/关闭）；MarkdownText 渲染 + 源码切换；二进制/超限/错误态 + 系统打开；打开面板自动刷新树；默认根 = 会话 cwd → workspaces 列表（两级订阅等待就绪） |
| `smoke.test.mjs` | 新增主机半边校验：import src/index.js + 模拟 webServer.register + 真实调 handler 验证 list（含 src 目录与 package.json 文件行）/file（读自身含 SMOKE 标记）/目录 400 |
| `package.json` | inject 加回 dsh-client-ui-primitives（MarkdownText） |

### 真机验证过程发现并修复的两个问题
1. **面板首开「未检测到 workspace 根目录」**：workspaces.list 是惰性快照存储
   （服务重启后可能始终为空且无人触发更新）。→ 默认根改为会话 cwd 优先 +
   sessions/workspaces 双存储订阅等待就绪。
2. **会话恢复期间面板被误关**：session-scoped 按钮的 sessionId 从 undefined → 真实值
   被误判为「切换会话」触发 closePanel。→ ref 哨兵（null=未记录）跳过首帧赋值。

### 验证结果（全部通过）
- 构建 + 冒烟测试通过（含主机路由功能级校验）。
- curl 直测 /fsviewer-api/list（目录+文件+面包屑）与 /file（UTF-8 内容）均 200。
- 浏览器实测：树显示目录+文件（.DS_Store FILE 徽章、svg IMG 徽章）；
  点击 README.md 渲染成功（标题/粗体/行内代码/列表，官方聊天样式）；
  「源码」切换显示原始文本且按钮变「渲染」；README + INSTALL 双页签打开、
  切换正常；停靠推开内容、会话 cwd 默认根、✕/←/⧉ 均正常。截图存档。

### 已知取舍（明示）
- /fsviewer-api 无鉴权（localhost 个人工具；与 browse/openPath 同信任级别）。
- 读取上限 1MB；二进制不预览。
- 聊天消息内文件引用点击未接入（树内点击已覆盖）。

### 结论
**通过。** 插件已升级为文件浏览器 + Markdown 预览，与用户参考截图交互一致
（徽章文件树 + 点击预览 + 页签 + 源码切换）。

### 补充修复（同日）：拖拽分隔条后原生「详情」面板露边
- **现象**：用户拖动分隔条把右栏拖宽（300-520 合同区间）后，原生「详情」面板从文件
  管理器后面露出一条（面板固定 360px，盖不住更宽的原生列）。
- **修复**：新增 `useDockWidth`——ResizeObserver 监听原生 detailsCol 列宽，面板宽度
  实时跟随（拖分隔条 = 拖文件管理器宽度），任何宽度下完全盖住原生面板。
- **验证**：改原生列宽 360→460，面板 styleWidth 同步变 460px、左边缘与原生列左边缘
  齐平（flush）。真机合成拖拽事件在 IAB 面临时失效，改以直接改网格列宽验证（等效路径：
  ResizeObserver 监听的是同一元素的尺寸变化）。

### 补充重构（同日）：Codex 式面板布局
- **需求**：用户提供 Codex 文件面板截图，要求左预览右树同屏、UI 细节照抄
  （页签/面包屑/查看源代码/打开按钮/控制簇/尺寸缩放/空状态）。
- **改动**（`src/client.js` 主体重构）：
  - 布局：360px 单列两态 → 720px 左右分栏（左预览 + 右树栏 300px 常显），
    无激活文件时预览区显示「打开文件 / 从工作区目录树中选择文件」空状态
  - 顶部行1：文件页签（×）+「+」聚焦筛选 + 控制簇 ⤢ 全宽切换 / ◨ 树栏收展 / ✕ 关闭
  - 顶部行2：`根目录 › 文件名` 面包屑 + 查看源代码（仅 md）+ 所在文件夹 + ⧉打开（主色）
  - 预览区：文件大标题 + 复制按钮（新增复制到剪贴板）
  - 树栏：筛选框（移入树栏顶部）+ 刷新/选根目录小图标；目录整行点击展开
    （去掉「进入」概念与逐行 ⧉）；激活文件高亮
  - 宽度：左缘拖拽调宽（560px 下限，模块级记忆跨开合）+ ⤢ 全宽（94vw）切换；
    去掉原生列宽跟随（面板 ≥560 恒 ≥ 原生列上限 520，天然完全盖住原生「详情」）
- **验证**：构建 + 冒烟通过；真机确认空状态/分栏预览/页签激活/面包屑/
  ⤢(721→1204→721)/◨(23→0→23 行) 全部生效；截图与 Codex 参考图布局一致。

### 补充调整（同日）：交互修正四项（用户反馈）
1. **顶部按钮位置固定**：展开面板不再调用 `layout.openDetails()` 推挤布局（按钮会随
   头部左移），改为面板从会话头标题行下方滑入（运行时测量 `titleRow` 底部定位），
   按钮原地不动、始终可见可点。实测按钮坐标展开前后均为 (1224,14)。
2. **再次点击顶部按钮收起面板**：按钮不被面板遮挡后自然满足，实测开→合往返正常。
3. **文件夹图标 = 树栏开关**：面包屑行的文件夹按钮改为收起/展开右侧文件树（带激活
   态底色），控制簇里原 ◨ 按钮移除避免重复；「打开所在文件夹」入口随之移除。
   实测树行 7→0→7。
4. **空状态伪页签**：无打开文件时页签栏显示「打开文件 ×」（× 关闭面板）+「+」，
   同 Codex 空状态 UI。实测空状态文案、伪页签、面板 top=44px（头部下方）均正确。
- inject 移除 layout 服务（不再使用）。

### 补充调整（同日，第二轮用户反馈）
1. **恢复原生右栏推挤**：面板展开重新调用 `layout.closeDetails()+openDetails()`
   （归一 360px）推挤聊天内容；实测 Session log 1105→781。
2. **顶部按钮仍钉在原位**：未展开时持续采样按钮视口坐标（btnHome），展开推挤后以
   fixed 定位钉回原坐标、z 高于面板——实测三态坐标均为 (1224,14)（closed/static →
   open/fixed → re-closed/static）。钉住后视觉上成为面板右上角常驻开关（同 Codex
   角落图标），再次点击收起，实测往返正常。
3. **移除面板内 ✕ 按钮**（用户要求）：关闭入口 = 顶部钉住图标 + 空状态伪页签 ×。
   行1 右侧预留 40→64px，实测 ⤢ 右缘 1216 与钉住按钮左缘 1224 无重叠。

### 补充调整（同日，第三轮用户反馈）
1. **修复图标位置漂移**：收起面板时原生列开合带 ~0.3s CSS 过渡，原采样会把过渡中的
   中间坐标存为「原位」，多次开合累积漂移。改为 rAF 连续帧稳定性检测（连续 3 帧位置
   不变才记录 btnHome）。实测连续 5 轮开合，按钮坐标均为 (1224,14) 零漂移。
2. **树栏筛选框旁两个图标（刷新/选根目录）移除**：筛选行只留输入框。
3. **空状态不再显示「⧉ 打开」按钮**：仅在选中文件时渲染。
4. **「代码块标题头被挤压」排查结论：非插件问题**。dsh 应用自身把 markdown 代码块
   头部（yaml/复制 栏）写为 `position: sticky; top: 0`（滚动时吸附在滚动容器顶部、
   正文从其下方滑过——用户截图即此原生表现）。对照实验：移除插件注入的全部样式后
   逐像素复测，吸附行为完全一致（bannerTop 80 / 容器顶 76 / 间隙 4 前后相同），
   且插件注入的样式全部为 .fsviewer-* 前缀作用域，不触及应用类名。

### 补充重构（2026-08-29）：原生右栏接管（用户确认方案）
- **背景**：用户问「插件能直接就用原生右栏，是否可行？」。排查 slots 运行时
  （dsh-client-ui-slots）确认：single 槽位**同优先级注册才冲突**，不同优先级可共存
  影子（`lowest renders`），conversation 的 details 注册未传 priority（=0）。
- **方案**：文件面板以 `priority: -10` 影子注册接管原生 `details` 右栏——原生推挤、
  原生拖宽（300-520 把手）、原生开合动画；删除全部浮层 hack（shell.overlay 注册、
  钉按钮+btnHome 采样、snapNativeColumnTo 合成拖拽、面板左缘把手、⤢ 全宽、z-index）。
- **代价（用户知情确认）**：插件启用期间 details 栏显示文件面板，点击聊天工具调用
  不再显示工具详情；插件停用后原生工具详情自动恢复（影子机制天然支持）。
- **配套改动**：面板组件改为列内布局（width/height 100%，无 fixed/z-index/过渡）；
  可见性跟踪（ResizeObserver 监听 detailsCol，列宽>80 才解析根目录/加载数据——
  原生列收起时组件仍挂载但宽度为 0）；树栏 150px 起可拖拽调宽（120-320）；⤢/✕ 移除。
- **验证**：构建 + 冒烟通过（details 注册 priority=-10 断言）；真机：原生列 360 推挤
  （Session log→745）、面板渲染于列内、README 渲染、树栏同屏、开→合（列宽 360→0）
  →开（页签与预览状态保持）。截图存档。

### 补充（2026-08-29）：⤢ 加宽按钮 + 默认宽度调整（用户反馈）
1. **面板/树栏默认宽度**：面板默认宽 = 原生右栏宽度（300–520，用户可拖），树栏初始
   150px、左缘可拖拽调宽（120–320）。
2. **对齐修正**：面板行1 设 minHeight 56，页签/+/-⤢ 中心线落在 28px（会话标题行中心、
   钉住按钮中心同线，Codex 对齐方式）；行2 右侧内缩 20px。
3. **⤢ 加宽按钮**：原生布局 store 将右栏宽度硬编码 clamp 在 300–520 且布局服务只暴露
   open/close，无展开动作；合成 pointer 拖拽原生把手实测无效（事件与处理器均触发，
   但内部宽度写入不生效——有内部保护）。最终实现：CSS !important 覆盖 AppFrame
   网格列（`--fsv-grid` 变量，末段置 520px）+ 隐藏原生把手；还原 = 移除覆盖类恢复
   原生内联样式。实测 360→520→360 往返正常。
4. **收起联动**：面板收起（顶部按钮/伪页签 ×/切会话）时自动解除展开覆盖。

### 补充修复（2026-08-29，第二轮用户反馈）
1. **⤢ 展开后顶部按钮无法收起**：根因是 togglePanel 的收起分支未解除 ⤢ 的 CSS 覆盖
   （closePanel 才解除）。重构为 togglePanel 收起路径统一走 closePanel（解除覆盖 +
   closeDetails）。实测展开 520 → 点顶部按钮 → 列宽 0 收起 ✓。
2. **树栏目录行 Codex 风格**：去掉 📂 emoji，改用内联 SVG 细箭头（展开旋转 90° 过渡），
   行结构 = 箭头 + 名称；文件行保持彩色徽章。实测无 emoji 残留、箭头 4 个 ✓。
3. **会话内点击文件引用改道插件预览**：包装 `workspaces.openPath`（同实例方法替换，
   所有调用方均经过）——非目录路径改道 `openFileInPanel`（展开右栏 + 页签预览），
   目录（尾斜杠）与插件未就绪时保持原生系统打开；面板内 ⧉ 按钮使用保存的原生引用
   不受影响。
4. **选择器冲突修复**：⤢ 按钮复用 `.fsviewer-toggle` 类导致「收起后按钮仍显示激活」
   的假象（querySelector 命中了 ⤢ 的激活态）。⤢ 改用独立 `.fsviewer-iconbtn` 类。
