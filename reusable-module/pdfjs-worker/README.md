# pdfjs-worker

pdfjs-dist 浏览器端 worker 统一初始化与错误归一化模块（2026-10-21 共性热修沉淀）。

## 背景

EdgeOne Pages 对 `.mjs` 静态资源下发 `Content-Type: application/octet-stream`（文件真实存在、非 404、非哈希错配）。pdfjs-dist 4.x worker 为 ESM：`new Worker(src, { type: 'module' })` 在华为系统 / WeLink WebView 因 MIME 非 JS 被拒；回退 fake worker 主线程 `import(src)` 又被 MIME 严格校验拒绝，裸抛 `Setting up fake worker failed: Failed to fetch dynamically imported module`。

## 方案

- worker 固化为同源稳定路径 `/pdfjs/pdf.worker.min.js`（EdgeOne 对 `.js` 实测返回 `application/javascript`；Worker 按 `type: 'module'` 判断、fake worker 只要求 JS 类 MIME）；稳定名同时消除未来发版哈希 404。
- 只初始化一次 `GlobalWorkerOptions.workerSrc`；统一包装 `getDocument`，把 worker/模块加载失败归一为中文可重试提示，不再把裸英文错误抛给用户。
- 禁止再各自 `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`。

## API

| 导出 | 说明 |
| --- | --- |
| `PDFJS_WORKER_PATH` | 稳定 worker 相对路径常量 `pdfjs/pdf.worker.min.js` |
| `resolveWorkerSrc(base?)` | 拼接稳定同源 worker URL（纯函数，可单测） |
| `isWorkerLoadFailure(err)` | 判断错误是否属于 worker/模块加载失败（纯函数） |
| `normalizePdfError(err)` | worker 失败转中文提示；其它错误原样保留 |
| `configurePdfjs()` | 幂等配置全局 workerSrc，返回 pdfjs 命名空间 |
| `openPdfDocument(data)` | 打开 PDF 文档；worker 失败抛中文可重试错误 |

## 使用示例

```ts
import { openPdfDocument, configurePdfjs } from '../../../../reusable-module/pdfjs-worker/pdfjs-worker'

configurePdfjs()
const pdf = await openPdfDocument(arrayBuffer)
const page = await pdf.getPage(1)
```

## 接入工具

- `src/tools/pdf-redact`（`lib/engine.ts`、`index.vue` 预览渲染）
- `src/tools/resume-jd-matcher`（`lib/parse-resume.ts` PDF 分支）

## 备注

- 不新增依赖，复用项目已装 `pdfjs-dist@4.10.38`。
- worker 二进制随 `public/pdfjs/pdf.worker.min.js` 纳入版本管理，内容与 `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` sha256 一致（仅文件名不同）。
