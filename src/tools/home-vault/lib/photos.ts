/**
 * photos.ts —— 凭证照片本地压缩（Canvas 重绘，天然剥离 EXIF/GPS）。
 *
 * 内联实现而非复用 reusable-module/image-redraw：与 exam-review-scheduler 同款取舍，
 * 避免共享模块在 vue-tsc 联合重载解析上对其它工具产生无关报错。
 * 长边 1600、JPEG q0.82；超出 300KB 时阶梯降质量重试，直到底线。
 */
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_QUALITY } from './models'

export interface CompressedPhoto {
  blob: Blob
  mime: string
  width: number
  height: number
  bytes: number
}

async function decode(file: Blob): Promise<HTMLImageElement | ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const url = URL.createObjectURL(file)
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('图片解码失败'))
        el.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

async function encode(src: HTMLImageElement | ImageBitmap, quality: number): Promise<CompressedPhoto> {
  const sw = src.width
  const sh = src.height
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(sw, sh))
  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))
  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  // JPEG 无透明通道：先铺白底，避免透明区域变黑
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(src, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), 'image/jpeg', quality)
  })
  return { blob, mime: 'image/jpeg', width, height, bytes: blob.size }
}

/** 压缩一张图片为 JPEG Blob；超 300KB 时逐级降质量（0.82 → 0.72 → 0.62 → 0.5）。 */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  const src = await decode(file)
  const steps = [PHOTO_QUALITY, 0.72, 0.62, 0.5]
  let last: CompressedPhoto | null = null
  for (const q of steps) {
    const out = await encode(src, q)
    last = out
    if (out.bytes <= PHOTO_MAX_BYTES) return out
  }
  return last!
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
