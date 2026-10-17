/**
 * image-redraw —— 通用「安全解码 + 按尺寸重绘 + 编码」纯函数。
 *
 * 通过 Canvas 重绘输出的图片天然不含 EXIF/XMP/IPTC 等一切元数据，
 * 是最稳妥的“隐私剥离”方式，同时顺带完成缩放、方向校正与格式/质量控制。
 *
 * 零依赖；createImageBitmap 不可用时回退 HTMLImageElement。
 * 授权：MIT（fangzi 内部模块），沉淀自 pipeline 006 照片隐私清理。
 */

export type OutMime = 'image/jpeg' | 'image/webp' | 'image/png'

export interface RedrawOptions {
  outType: OutMime
  /** 0..1，png 时忽略 */
  quality?: number
  /** 最长边像素；不传或为 0 表示保持原尺寸 */
  maxEdge?: number
  /** 在缩放后的画布上额外绘制（如打码）；尺寸为最终画布宽高 */
  paint?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
}

export interface RedrawResult {
  blob: Blob
  width: number
  height: number
}

export function supportsWebp(): boolean {
  try {
    const c = document.createElement('canvas')
    return c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: OutMime, quality?: number): Promise<Blob> {
  const q = type === 'image/png' ? undefined : quality
  if (typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
    return (canvas as OffscreenCanvas).convertToBlob({ type, quality: q })
  }
  return new Promise((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), type, q)
  })
}

interface Decoded {
  width: number
  height: number
  draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number) => void
}

async function decode(file: Blob): Promise<Decoded> {
  // 首选 createImageBitmap：自动按 EXIF 定向（from-image），且可在 Worker 中使用
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h)
    }
  } catch {
    // 回退：HTMLImageElement（部分浏览器会自动定向；不能时由调用方另行处理 orientation）
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('图片解码失败'))
        el.src = url
      })
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h)
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/**
 * 解码 → 缩放 → 自定义绘制（打码）→ 编码。输出 Blob 不含任何元数据。
 * 可接收 HTMLCanvasElement 或 OffscreenCanvas（批量 Worker 场景）。
 */
export async function redrawImage(
  file: Blob,
  opts: RedrawOptions,
  canvas?: HTMLCanvasElement | OffscreenCanvas
): Promise<RedrawResult> {
  const src = await decode(file)
  const scale = opts.maxEdge && opts.maxEdge > 0 ? Math.min(1, opts.maxEdge / Math.max(src.width, src.height)) : 1
  const width = Math.max(1, Math.round(src.width * scale))
  const height = Math.max(1, Math.round(src.height * scale))

  const cv = canvas ?? document.createElement('canvas')
  cv.width = width
  cv.height = height
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('无法创建画布上下文')

  // 转 JPEG 无透明通道：先铺白底，避免透明区域变黑
  if (opts.outType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  src.draw(ctx, width, height)
  opts.paint?.(ctx as CanvasRenderingContext2D, width, height)

  const blob = await canvasToBlob(cv, opts.outType, opts.quality)
  return { blob, width, height }
}
