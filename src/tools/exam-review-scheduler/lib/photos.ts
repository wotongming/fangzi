/**
 * photos.ts —— 错题拍照附件：本地压缩（Canvas 重绘，去 EXIF，长边 1600）。
 * 行为与 reusable-module/image-redraw 一致；这里仅用 HTMLCanvasElement 内联，
 * 避免与其它工具共享模块时触发 TS 对 canvas getContext 联合重载的解析差异。
 */
export const PHOTO_MAX_EDGE = 1600
export const PHOTO_QUALITY = 0.72

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

/** 压缩一张图片文件为 JPEG Blob（Canvas 重绘天然去除 EXIF/GPS 等元数据）。 */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  const src = await decode(file)
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
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(src, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), 'image/jpeg', PHOTO_QUALITY)
  })
  return { blob, mime: 'image/jpeg', width, height, bytes: blob.size }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
