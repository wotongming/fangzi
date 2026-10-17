/**
 * ort-wasm-loader —— 解决静态托管（如腾讯云 EdgeOne Pages）把 onnxruntime-web 的
 * 胶水脚本 `ort-wasm-simd-threaded.mjs` 以 `Content-Type: application/octet-stream`
 * 下发，导致浏览器原生 `import()` 因严格 MIME 校验失败的问题：
 *
 *   TypeError: Failed to fetch dynamically imported module: https://.../onnx/ort-wasm-simd-threaded.mjs
 *   no available backend found
 *
 * 做法：`fetch()` 取脚本不受 MIME 限制 → 读出文本 → 以 `text/javascript` 生成
 * blob: URL；配合 ORT/Transformers 的对象形式 wasmPaths：
 *   { mjs: blobUrl, wasm: '同源 .wasm 直链' }
 * 浏览器对 blob: 模块按 JS 解析；.wasm 本身由 EdgeOne 正确下发为 application/wasm。
 *
 * 适用环境：无 COOP/COEP（非 crossOriginIsolated）→ ORT 强制 numThreads=1，
 * 胶水在主线程运行，blob 模块没有 Worker 派生问题。若页面显式开启跨域隔离
 * （sharedArrayBuffer 可用，通常 MIME 也已正确配置），直接返回同源直链对象。
 *
 * 零依赖；MIT（fangzi 内部模块），沉淀自 2026-10-18 本地知识库语义后端热修（003）。
 */

export interface OrtWasmPathOptions {
  /** wasm 所在目录，需以 / 结尾；默认 `${BASE_URL}onnx/`（onnxruntime-web 1.30） */
  dir?: string
  /** 胶水脚本文件名 */
  mjsName?: string
  /** wasm 二进制文件名 */
  wasmName?: string
}

export type OrtWasmPaths = string | { mjs: string; wasm: string }

const MJS_DEFAULT = 'ort-wasm-simd-threaded.mjs'
const WASM_DEFAULT = 'ort-wasm-simd-threaded.wasm'

/** key -> blob URL，同一目录只创建一次 blob；会话期内不回收（InferenceSession 生命周期内都要用） */
const blobUrlCache = new Map<string, string>()

function appBase(): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  return base.endsWith('/') ? base : base + '/'
}

function isCrossOriginIsolated(): boolean {
  return typeof self !== 'undefined' && (self as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
}

/** 取到的内容若是 SPA 回退返回的 HTML，不应被当成 JS 胶水 */
function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html[\s>])/i.test(text.slice(0, 200))
}

/**
 * 计算应赋给 ort.env.wasm.wasmPaths（或 transformers env.backends.onnx.wasm.wasmPaths）的值。
 * 优先 blob: 规避 MIME；失败逐级回退到“同源直链对象”再到“目录字符串”。
 */
export async function resolveOrtWasmPaths(opts: OrtWasmPathOptions = {}): Promise<OrtWasmPaths> {
  const dir = opts.dir ?? `${appBase()}onnx/`
  const mjsName = opts.mjsName ?? MJS_DEFAULT
  const wasmName = opts.wasmName ?? WASM_DEFAULT
  const mjsUrl = `${dir}${mjsName}`
  const wasmUrl = `${dir}${wasmName}`
  const direct: OrtWasmPaths = { mjs: mjsUrl, wasm: wasmUrl }

  // 跨域隔离环境下可能使用多线程 Worker（blob 模块进 Worker 有额外限制），
  // 这类部署通常也已正确配置 .mjs MIME，直接用同源直链。
  if (isCrossOriginIsolated()) return direct

  const cacheKey = mjsUrl
  const cached = blobUrlCache.get(cacheKey)
  if (cached) return { mjs: cached, wasm: wasmUrl }

  try {
    const res = await fetch(mjsUrl, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (looksLikeHtml(text)) throw new Error('返回内容是 HTML（疑似 SPA 回退），不是 wasm 胶水脚本')
    const blob = new Blob([text], { type: 'text/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    blobUrlCache.set(cacheKey, blobUrl)
    return { mjs: blobUrl, wasm: wasmUrl }
  } catch {
    // fetch/blob 失败（如 CSP 禁止 blob: 脚本）：退回同源直链对象（MIME 正确的环境仍可用）
    return direct
  }
}

/**
 * 便捷方法：直接给 onnxruntime-web 命名空间（或其 wasm 子入口）配置好 wasmPaths。
 * 返回同一个 ort 引用，便于 `await configureOrtWasm(await import('onnxruntime-web/wasm'))`。
 */
export async function configureOrtWasm<T extends object>(ort: T, opts: OrtWasmPathOptions = {}): Promise<T> {
  const wasmEnv = (ort as { env?: { wasm?: { wasmPaths?: unknown } } }).env?.wasm
  if (wasmEnv) wasmEnv.wasmPaths = await resolveOrtWasmPaths(opts)
  return ort
}
