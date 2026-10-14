/**
 * 批量解码/转换加速 Worker（可选加速层）：
 * - 使用 createImageBitmap + OffscreenCanvas 在 Worker 中完成「解码 → 缩放 → 编码」
 * - 仅用于纯转换步骤；AI 步骤仍走主线程（transformers/ort 主线程是官方推荐路径）
 * - 创建失败或浏览器不支持时返回 null，调用方回退主线程，不影响功能
 */

export interface WorkerConvertParams {
  maxWidth: number
  format: 'image/webp' | 'image/jpeg' | 'image/png'
  quality: number
}

// 注意：此处为纯 JavaScript（Worker 内无 TS 编译），禁止使用类型注解
const WORKER_SOURCE = `
let canvas = null
let ctx = null
self.onmessage = function (e) {
  var id = e.data.id, file = e.data.file, params = e.data.params
  try {
    createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, params.maxWidth / bitmap.width)
      var w = Math.max(1, Math.round(bitmap.width * scale))
      var h = Math.max(1, Math.round(bitmap.height * scale))
      if (!canvas) { canvas = new OffscreenCanvas(w, h) } else { canvas.width = w; canvas.height = h }
      ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no ctx')
      if (params.format === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) }
      ctx.drawImage(bitmap, 0, 0, w, h)
      var quality = params.format === 'image/png' ? undefined : params.quality
      canvas.convertToBlob({ type: params.format, quality: quality }).then(function (blob) {
        self.postMessage({ id: id, blob: blob })
      }, function (err) {
        self.postMessage({ id: id, error: String(err) })
      })
    }, function (err) {
      self.postMessage({ id: id, error: String(err) })
    })
  } catch (err) {
    self.postMessage({ id: id, error: String(err) })
  }
}
`

let worker: Worker | null = null
let seq = 0

/** 尝试在 Worker 中完成纯转换；失败返回 null（调用方回退主线程） */
export async function convertInWorker(
  file: File,
  params: WorkerConvertParams
): Promise<Blob | null> {
  try {
    if (!('OffscreenCanvas' in globalThis) || !('createImageBitmap' in globalThis)) return null
    if (!worker) {
      const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
      worker = new Worker(blobUrl)
      URL.revokeObjectURL(blobUrl)
    }
    const id = ++seq
    return await new Promise<Blob | null>((resolve) => {
      let settled = false
      const settle = (v: Blob | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker?.removeEventListener('message', onMsg)
        worker?.removeEventListener('error', onErr)
        resolve(v)
      }
      const timer = setTimeout(() => settle(null), 30000)
      function onMsg(e: MessageEvent) {
        if (e.data.id !== id) return
        settle(e.data.blob ?? null)
      }
      function onErr() {
        settle(null)
      }
      worker?.addEventListener('message', onMsg)
      worker?.addEventListener('error', onErr)
      worker?.postMessage({ id, file, params })
    })
  } catch {
    return null
  }
}
