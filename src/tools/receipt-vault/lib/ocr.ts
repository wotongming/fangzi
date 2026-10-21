/**
 * ocr.ts —— 本地 Tesseract OCR（全部资源自托管，不外链 CDN）。
 * langPath=/tessdata（.traineddata.gz 放 public/tessdata，首次加载后被 SW/HTTP 缓存离线可用）；
 * workerPath=/tesseract/worker.min.js；corePath=/tesseract/tesseract-core-simd-lstm.wasm.js。
 */
import { createWorker, type Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise
  workerPromise = createWorker('chi_sim+eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/tesseract-core-simd-lstm.wasm.js',
    langPath: '/tessdata',
    logger: () => {}
  })
  return workerPromise
}

export async function ocrImage(file: Blob): Promise<{ text: string }> {
  const w = await getWorker()
  const { data } = await w.recognize(file)
  return { text: data.text ?? '' }
}
