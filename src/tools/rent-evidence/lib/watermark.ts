/**
 * watermark.ts —— 拍照压缩 + 时间戳水印（DOM 能力，薄壳）。
 * 把拍摄时刻（传入，不可事后改）以白字黑条烧进照片底部，作为证据留痕。
 */
import { formatStamp } from './model'

export async function watermarkPhoto(
  file: Blob,
  atIso: string,
  note: string
): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片读取失败'))
      el.src = url
    })
    const maxSide = 960
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const w = Math.round(img.width * scale)
    const h = Math.round(img.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 不可用')
    ctx.drawImage(img, 0, 0, w, h)
    // 底部水印条
    const barH = Math.max(34, Math.round(h * 0.07))
    ctx.fillStyle = 'rgba(0,0,0,0.72)'
    ctx.fillRect(0, h - barH, w, barH)
    ctx.fillStyle = '#fff'
    ctx.font = `${Math.round(barH * 0.42)}px system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    const stamp = formatStamp(atIso)
    ctx.fillText(stamp, 10, h - barH / 2)
    if (note) {
      const maxW = w - 20 - ctx.measureText(stamp).width - 24
      let text = note
      while (text.length > 1 && ctx.measureText(text).width > maxW) text = text.slice(0, -1)
      ctx.fillText(text, w - 10, h - barH / 2, maxW)
    }
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}
