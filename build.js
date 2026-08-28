/**
 * fsviewer 构建脚本
 *
 * 把 src/client.js（JSX 源码）编译成浏览器模块加载器格式的 lib/client.js，
 * 产物格式与官方 client 插件一致：
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ...CommonJS... } })
 *
 * 用法：
 *   npm run build       一次性构建
 *   npm run dev         监听 src/ 变化自动重建
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const srcPath = path.join(root, 'src/client.js')
const outPath = path.join(root, 'lib/client.js')

async function build() {
  const src = fs.readFileSync(srcPath, 'utf8')
  const result = await transform(src, {
    loader: 'jsx',                      // 源码含 JSX 语法
    format: 'cjs',                       // ESM -> CommonJS，挂到 envelope 的 module/exports 上
    target: 'es2020',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    sourcemap: false,
  })

  const code = [
    '/**',
    ' * fsviewer 客户端构建产物 — 由 build.js 从 src/client.js 生成，请勿手改。',
    ' * 重新构建：npm run build',
    ' */',
    'window.__ModuleLoader__.load({',
    '\tid: "fsviewer",',
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    result.code,
    '\t\treturn module.exports;',
    '\t}',
    '});',
    ''
  ].join('\n')

  fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
  fs.writeFileSync(outPath, code)
  // 统一权限为 644：避免 600 的产物进入发布包后其他用户/CI 无法读取
  fs.chmodSync(outPath, 0o644)
  console.log(`[fsviewer] built lib/client.js (${code.length} bytes)`)
}

const watch = process.argv.includes('--watch')

if (watch) {
  await build()
  console.log('[fsviewer] watching src/ for changes...')
  let timer = null
  fs.watch(path.join(root, 'src'), () => {
    clearTimeout(timer)
    timer = setTimeout(build, 100)
  })
} else {
  await build()
}
