/**
 * redact.ts —— 区域脱敏（马赛克 / 高斯模糊 / 纯色遮罩），纯函数作用于 canvas。
 *
 * 区域坐标一律用「相对原图宽高的归一化 0..1」存储，界面缩放不影响打码精度，
 * 真正绘制时再换算到目标画布像素。不做人脸自动识别（由用户手选）。
 */

export type Any2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type RedactMode = 'mosaic' | 'blur' | 'solid'
export type MaskShape = 'rect' | 'path'

export interface Mask {
  id: string
  shape: MaskShape
  /** rect: [x0,y0,x1,y1]；path: 若干 [x,y]（归一化），取其包围盒填充 */
  coords: number[]
}

/** 归一化坐标 -> 像素整数矩形，裁剪到画布范围内 */
function normRect(mask: Mask, W: number, H: number): { x: number; y: number; w: number; h: number } | null {
  let x0: number, y0: number, x1: number, y1: number
  if (mask.shape === 'rect' && mask.coords.length >= 4) {
    x0 = mask.coords[0]!
    y0 = mask.coords[1]!
    x1 = mask.coords[2]!
    y1 = mask.coords[3]!
  } else {
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i + 1 < mask.coords.length; i += 2) {
      xs.push(mask.coords[i]!)
      ys.push(mask.coords[i + 1]!)
    }
    if (!xs.length) return null
    x0 = Math.min(...xs)
    x1 = Math.max(...xs)
    y0 = Math.min(...ys)
    y1 = Math.max(...ys)
  }
  const x = Math.max(0, Math.round(Math.min(x0, x1) * W))
  const y = Math.max(0, Math.round(Math.min(y0, y1) * H))
  const rx = Math.min(W, Math.round(Math.max(x0, x1) * W))
  const ry = Math.min(H, Math.round(Math.max(y0, y1) * H))
  const w = rx - x
  const h = ry - y
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

/** ctx.filter 是否可用（个别老浏览器不支持 canvas filter） */
export function supportsFilter(ctx: Any2d): boolean {
  return typeof ctx.filter === 'string'
}

function mosaic(ctx: Any2d, r: { x: number; y: number; w: number; h: number }): void {
  const block = Math.max(6, Math.round(Math.min(r.w, r.h) / 28))
  for (let yy = r.y; yy < r.y + r.h; yy += block) {
    for (let xx = r.x; xx < r.x + r.w; xx += block) {
      const pw = Math.min(block, r.x + r.w - xx)
      const ph = Math.min(block, r.y + r.h - yy)
      // 取块左上角像素色，整块填充（像素化）
      const d = ctx.getImageData(xx, yy, 1, 1).data
      ctx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`
      ctx.fillRect(xx, yy, pw, ph)
    }
  }
}

/** 创建临时画布：主线程用 HTMLCanvasElement，Worker（无 document）用 OffscreenCanvas */
function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return new OffscreenCanvas(w, h)
}

/** 不支持 ctx.filter 时的盒式模糊近似（缩小再放大，强模糊且开销低） */
function boxBlur(ctx: Any2d, r: { x: number; y: number; w: number; h: number }): void {
  const pad = 6
  const sx = Math.max(0, r.x - pad)
  const sy = Math.max(0, r.y - pad)
  const sw = Math.min(ctx.canvas.width - sx, r.w + pad * 2)
  const sh = Math.min(ctx.canvas.height - sy, r.h + pad * 2)
  const tmp = makeCanvas(Math.max(1, Math.round(sw / 8)), Math.max(1, Math.round(sh / 8)))
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, sx, sy, sw, sh)
}

function blur(ctx: Any2d, r: { x: number; y: number; w: number; h: number }): void {
  if (supportsFilter(ctx)) {
    ctx.save()
    ctx.filter = 'blur(14px)'
    // 略微外扩，避免边缘露出
    const pad = 8
    const sx = Math.max(0, r.x - pad)
    const sy = Math.max(0, r.y - pad)
    ctx.drawImage(
      ctx.canvas,
      sx,
      sy,
      Math.min(ctx.canvas.width - sx, r.w + pad * 2),
      Math.min(ctx.canvas.height - sy, r.h + pad * 2),
      sx,
      sy,
      Math.min(ctx.canvas.width - sx, r.w + pad * 2),
      Math.min(ctx.canvas.height - sy, r.h + pad * 2)
    )
    ctx.restore()
  } else {
    boxBlur(ctx, r)
  }
}

function solid(ctx: Any2d, r: { x: number; y: number; w: number; h: number }): void {
  ctx.save()
  ctx.fillStyle = '#111111'
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.restore()
}

/** 在已绘制好图像的 ctx 上，按归一化遮罩就地打码。区域外像素保持不变。 */
export function applyMasks(
  ctx: Any2d,
  width: number,
  height: number,
  masks: Mask[],
  mode: RedactMode
): void {
  for (const mask of masks) {
    const r = normRect(mask, width, height)
    if (!r) continue
    if (mode === 'mosaic') mosaic(ctx, r)
    else if (mode === 'blur') blur(ctx, r)
    else solid(ctx, r)
  }
}

/** 供单测：把归一化矩形换算为像素矩形 */
export function rectToPixels(mask: Mask, W: number, H: number) {
  return normRect(mask, W, H)
}
