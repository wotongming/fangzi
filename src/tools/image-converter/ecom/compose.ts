/**
 * 电商模式画布合成（依赖 DOM Canvas，浏览器/无头 Chromium 中运行）：
 * 换底（复用 MODNet 透明结果）→ 规格几何(裁剪/留白) → 水印 → 目标体积编码。
 * 几何与命名等纯逻辑在 presets.ts / pack.ts，可在 Node 单测；本文件只做像素处理。
 */
import { removeBackground } from '../lib/ai/enhance'
import { computeGeometry } from './presets'
import { drawTextWatermark, drawLogoWatermark } from './watermark'
import type { EcomSpec, EcomWatermarkConf } from './types'

export interface EcomRuntimeOpts {
  /** 自定义底图（bg.mode=image 时），仅运行期内存 */
  bgImage?: HTMLImageElement | null
  /** logo 水印位图与原始尺寸 */
  logo?: HTMLImageElement | null
  onAiProgress?: (p: number) => void
}

export interface EcomOutput {
  blob: Blob
  ext: 'jpg' | 'png' | 'webp'
  width: number
  height: number
  usedAi: boolean
}

const OPAQUE = new Set(['image/jpeg'])

export function extOfFormat(format: EcomSpec['format']): 'jpg' | 'png' | 'webp' {
  return format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg'
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解析失败'))
    }
    img.src = url
  })
}

function coverDraw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void {
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * r
  const dh = img.naturalHeight * r
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('编码失败'))),
      mime,
      quality
    )
  })
}

/**
 * 目标体积编码：jpeg/webp 在 [0.3,0.95] 内二分质量逼近 targetBytes；
 * png 无损不承诺体积。返回不超过目标的最佳结果，达不到则返回最小质量结果。
 */
async function encodeToSize(canvas: HTMLCanvasElement, spec: EcomSpec): Promise<Blob> {
  if (spec.format === 'image/png' || !spec.targetBytes) {
    return canvasToBlob(canvas, spec.format, spec.format === 'image/png' ? undefined : spec.quality)
  }
  let lo = 0.3
  let hi = 0.95
  let best: Blob | null = null
  let smallest: Blob | null = null
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2
    const b = await canvasToBlob(canvas, spec.format, mid)
    if (b.size <= spec.targetBytes) {
      best = b
      lo = mid // 还能尝试更高质量
    } else {
      hi = mid
      smallest = !smallest || b.size < smallest.size ? b : smallest
    }
    if (hi - lo < 0.03) break
  }
  if (best) return best
  // 无法压到目标：返回一次最低质量结果并交由上层提示
  return smallest ?? canvasToBlob(canvas, spec.format, 0.3)
}

/**
 * 处理单张原图 → 单个平台规格输出。
 * 说明：AI 换底复用现有 MODNet（主线程推理），批量并发由上层限制为 1。
 */
export async function processEcomImage(
  source: Blob,
  spec: EcomSpec,
  wm: EcomWatermarkConf,
  opts: EcomRuntimeOpts = {}
): Promise<EcomOutput> {
  const replaceBg = spec.bg.mode === 'color' || spec.bg.mode === 'image'
  let subject: HTMLImageElement
  let usedAi = false
  if (replaceBg) {
    const matte = await removeBackground(source, opts.onAiProgress)
    subject = await loadImage(matte.blob)
    usedAi = true
  } else {
    subject = await loadImage(source)
  }

  const geom = computeGeometry(subject.naturalWidth, subject.naturalHeight, spec.ratio, spec.longEdge, spec.fit)
  const canvas = document.createElement('canvas')
  canvas.width = geom.cw
  canvas.height = geom.ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')

  // —— 背景层 ——
  if (spec.bg.mode === 'color') {
    ctx.fillStyle = spec.bg.color
    ctx.fillRect(0, 0, geom.cw, geom.ch)
  } else if (spec.bg.mode === 'image' && opts.bgImage) {
    coverDraw(ctx, opts.bgImage, geom.cw, geom.ch)
  } else if (spec.fit === 'contain' && OPAQUE.has(spec.format)) {
    // 未换底但留白且输出不支持透明：留白填白，避免 jpeg 变黑
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, geom.cw, geom.ch)
  }

  // —— 主体（抠图结果或原图），按几何 9 参数绘制 ——
  ctx.drawImage(subject, geom.sx, geom.sy, geom.sw, geom.sh, geom.dx, geom.dy, geom.dw, geom.dh)

  // —— 水印 ——
  if (wm.enabled) {
    drawTextWatermark(ctx, geom.cw, geom.ch, wm)
    if (opts.logo) {
      drawLogoWatermark(ctx, geom.cw, geom.ch, opts.logo, opts.logo.naturalWidth, opts.logo.naturalHeight, wm.position, wm.opacity)
    }
  }

  const blob = await encodeToSize(canvas, spec)
  return { blob, ext: extOfFormat(spec.format), width: geom.cw, height: geom.ch, usedAi }
}
