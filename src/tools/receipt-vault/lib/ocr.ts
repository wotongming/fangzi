/**
 * ocr.ts —— 本地 Tesseract OCR（全部资源自托管，不外链 CDN）。
 * langPath=/tessdata（.traineddata.gz 放 public/tessdata，首次加载后被 SW/HTTP 缓存离线可用）；
 * workerPath=/tesseract/worker.min.js；corePath 先试 SIMD wasm，不支持的安卓 WebView 自动降级 non-SIMD。
 */
import { createWorker, type Worker } from 'tesseract.js'

export type OcrProgress = { phase: 'download' | 'recognize'; percent?: number; message: string }

let workerPromise: Promise<Worker> | null = null
let usingNonSimd = false

const CORE_SIMD = '/tesseract/tesseract-core-simd-lstm.wasm.js'
const CORE_NON_SIMD = '/tesseract/tesseract-core-lstm.wasm.js'

function makeWorker(corePath: string, onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  return createWorker('chi_sim+eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath,
    langPath: '/tessdata',
    logger: (m: { status?: string; progress?: number }) => {
      if (!onProgress) return
      if (m.status === 'recognizing text') {
        onProgress({ phase: 'recognize', percent: (m.progress ?? 0) * 100, message: `识别中…${((m.progress ?? 0) * 100).toFixed(0)}%` })
      } else if (m.status && m.status.includes('language')) {
        onProgress({ phase: 'download', message: '正在加载语言包（首次较慢，请勿关闭）…' })
      }
    }
  })
}

async function getWorker(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  if (workerPromise) return workerPromise
  const core = usingNonSimd ? CORE_NON_SIMD : CORE_SIMD
  try {
    workerPromise = makeWorker(core, onProgress)
    await workerPromise
    return workerPromise
  } catch (err) {
    workerPromise = null
    if (!usingNonSimd) {
      // 老安卓 WebView 不支持 WASM SIMD → 降级 non-SIMD 核心重试一次
      usingNonSimd = true
      onProgress?.({ phase: 'recognize', message: '当前浏览器不支持加速，正在切换兼容核心…' })
      workerPromise = makeWorker(CORE_NON_SIMD, onProgress)
      await workerPromise
      return workerPromise
    }
    throw new Error('初始化识别引擎失败（可能是浏览器/系统 WebView 不支持 WebAssembly）：' + (err as Error).message)
  }
}

/** 识别整体超时（弱网+老设备兜底），超时 reject 并允许重试。 */
const OCR_TIMEOUT_MS = 60_000

export async function ocrImage(file: Blob, onProgress?: (p: OcrProgress) => void): Promise<{ text: string }> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const w = await getWorker(onProgress)
    const withTimeout = Promise.race([
      w.recognize(file),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('识别超时（60 秒），请检查图片是否过大/过清晰后重试')), OCR_TIMEOUT_MS)
      })
    ])
    const { data } = await withTimeout
    return { text: data.text ?? '' }
  } catch (err) {
    // 失败后丢弃 worker，下次重新初始化（兼容降级也会重试）
    workerPromise = null
    throw err instanceof Error ? err : new Error('识别失败')
  } finally {
    if (timer) clearTimeout(timer)
  }
}
