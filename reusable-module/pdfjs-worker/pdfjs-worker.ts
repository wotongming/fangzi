/**
 * pdfjs-worker —— pdfjs-dist 浏览器端 worker 统一初始化与错误归一化（2026-10-21 共性热修沉淀）。
 *
 * 背景：EdgeOne Pages 对 `.mjs` 静态资源下发 `Content-Type: application/octet-stream`
 * （不是 404、不是哈希错配，文件真实存在）。pdfjs-dist 4.x worker 为 ESM：
 * `new Worker(src,{type:'module'})` 在华为系统 / WeLink WebView 因 MIME 非 JS 被拒；
 * 回退 fake worker 主线程 `import(src)` 又被 MIME 严格校验拒绝，裸抛
 * "Setting up fake worker failed: Failed to fetch dynamically imported module"。
 *
 * 本模块方案：
 *  - 把 `pdf.worker.min.mjs` 固化为同源稳定路径 `/pdfjs/pdf.worker.min.js`（EdgeOne 对 `.js`
 *    实测返回 `application/javascript`；Worker 按 `type:'module'` 判断、fake worker 只要求 JS 类 MIME）；
 *  - 只初始化一次 workerSrc；统一包装 `getDocument`，把 worker/模块加载失败归一为中文可重试提示，
 *    不再把裸英文 "Setting up fake worker failed" 抛给用户；
 *  - 旧代码禁止再各自 `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`。
 *
 * 零新增依赖（复用项目已装 pdfjs-dist 4.10）；MIT（fangzi 内部模块）。
 */
import * as pdfjsLib from 'pdfjs-dist'

export const PDFJS_WORKER_PATH = 'pdfjs/pdf.worker.min.js'

function baseUrl(): string {
  return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
}

/** 拼接稳定同源 worker URL（纯函数，便于单测）。 */
export function resolveWorkerSrc(base: string = baseUrl()): string {
  const b = base.endsWith('/') ? base : `${base}/`
  return `${b}${PDFJS_WORKER_PATH}`
}

/** worker / 模块加载失败的识别特征（不覆盖"文件不是 PDF"等业务错误）。 */
const WORKER_FAIL_PATTERNS = [
  'fake worker',
  'dynamically imported module',
  'Setting up fake worker',
  'Failed to fetch',
  'Could not load worker',
  'Worker was terminated'
]

export const WORKER_FRIENDLY_MESSAGE =
  'PDF 解析组件加载失败，可重试；若在内置浏览器（微信 / WeLink / QQ / 微博等）中，请点右上角用系统 Chrome / Edge 打开后再试。'

/** 判断错误是否属于 worker/模块加载失败（纯函数，便于单测）。 */
export function isWorkerLoadFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return WORKER_FAIL_PATTERNS.some((p) => msg.includes(p))
}

/** 把 worker 加载失败归一为中文错误；其它错误原样抛出。 */
export function normalizePdfError(err: unknown): Error {
  if (isWorkerLoadFailure(err)) return new Error(WORKER_FRIENDLY_MESSAGE, { cause: err })
  return err instanceof Error ? err : new Error(String(err ?? 'PDF 解析失败，请重试。'))
}

let configured = false

/** 配置全局 workerSrc（幂等），返回 pdfjs 命名空间供渲染/取文本复用。 */
export function configurePdfjs(): typeof pdfjsLib {
  if (!configured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = resolveWorkerSrc()
    configured = true
  }
  return pdfjsLib
}

/** 打开 PDF 文档；worker 加载失败抛中文可重试错误，不泄露裸英文栈信息。 */
export async function openPdfDocument(data: ArrayBuffer) {
  const lib = configurePdfjs()
  try {
    return await lib.getDocument({ data: data.slice(0) }).promise
  } catch (err) {
    throw normalizePdfError(err)
  }
}

export { pdfjsLib }
