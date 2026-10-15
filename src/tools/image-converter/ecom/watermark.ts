/**
 * 水印：文字（九宫格 / 对角平铺）。
 * 定位计算为纯函数（computeAnchors，可单测）；绘制依赖 CanvasRenderingContext2D。
 * logo 水印由 compose 层在调用处叠加（logo Image 仅运行期持有），此处只处理文字。
 */
import type { EcomWatermarkConf } from './types'

export interface Anchor {
  x: number
  y: number
}

/** 九宫格单点定位（x,y 为文字绘制点，margin 内缩） */
export function anchorOf(position: EcomWatermarkConf['position'], w: number, h: number, margin: number): Anchor {
  const cx = w / 2
  const cy = h / 2
  const left = margin
  const right = w - margin
  const top = margin
  const bottom = h - margin
  switch (position) {
    case 'tl': return { x: left, y: top }
    case 'tc': return { x: cx, y: top }
    case 'tr': return { x: right, y: top }
    case 'ml': return { x: left, y: cy }
    case 'mc': return { x: cx, y: cy }
    case 'mr': return { x: right, y: cy }
    case 'bl': return { x: left, y: bottom }
    case 'bc': return { x: cx, y: bottom }
    case 'br': return { x: right, y: bottom }
  }
}

/**
 * 计算水印绘制锚点：
 * - 单点：九宫格一个点。
 * - 平铺：按对角方向在整幅画布上均匀排布，行列由 tileGap（占短边比例）决定。
 */
export function computeAnchors(conf: EcomWatermarkConf, w: number, h: number): Anchor[] {
  const short = Math.min(w, h)
  const margin = Math.round(short * 0.04)
  if (!conf.tile) {
    return [anchorOf(conf.position, w, h, margin)]
  }
  const gap = Math.max(short * Math.max(0.18, conf.tileGap), 60)
  const anchors: Anchor[] = []
  // 交错对角网格
  let row = 0
  for (let y = margin; y <= h - margin; y += gap) {
    const offset = row % 2 === 0 ? 0 : gap / 2
    for (let x = margin + offset; x <= w - margin; x += gap) {
      anchors.push({ x, y })
    }
    row++
  }
  return anchors.length ? anchors : [anchorOf('mc', w, h, margin)]
}

function alignOf(position: EcomWatermarkConf['position']): CanvasTextAlign {
  if (position.endsWith('l')) return 'left'
  if (position.endsWith('r')) return 'right'
  return 'center'
}

function baselineOf(position: EcomWatermarkConf['position']): CanvasTextBaseline {
  if (position.startsWith('t')) return 'top'
  if (position.startsWith('b')) return 'bottom'
  return 'middle'
}

/** 在已绘制好的画布上下文上叠加文字水印（就地绘制） */
export function drawTextWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, conf: EcomWatermarkConf): void {
  if (!conf.enabled || !conf.text) return
  const short = Math.min(w, h)
  const fontSize = Math.max(10, Math.round(short * Math.min(0.12, Math.max(0.01, conf.fontScale))))
  ctx.save()
  ctx.globalAlpha = Math.max(0.05, Math.min(1, conf.opacity))
  ctx.fillStyle = conf.color || '#ffffff'
  ctx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  const align = conf.tile ? 'center' : alignOf(conf.position)
  const baseline = conf.tile ? 'middle' : baselineOf(conf.position)
  ctx.textAlign = align as CanvasTextAlign
  ctx.textBaseline = baseline as CanvasTextBaseline
  const anchors = computeAnchors(conf, w, h)
  for (const a of anchors) {
    ctx.save()
    ctx.translate(a.x, a.y)
    ctx.rotate((conf.rotateDeg * Math.PI) / 180)
    ctx.fillText(conf.text, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}

/** 叠加 logo 图片水印（就地绘制），logo 为已解码位图；logoW/logoH 为其原始像素尺寸 */
export function drawLogoWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logo: CanvasImageSource,
  logoW: number,
  logoH: number,
  position: EcomWatermarkConf['position'],
  opacity: number
): void {
  const short = Math.min(w, h)
  const targetW = Math.round(short * 0.16)
  const scale = targetW / Math.max(1, logoW)
  const dw = Math.round(logoW * scale)
  const dh = Math.round(logoH * scale)
  const margin = Math.round(short * 0.04)
  const a = anchorOf(position, w, h, margin)
  let dx = a.x
  let dy = a.y
  if (position.endsWith('r')) dx -= dw
  if (position.startsWith('b')) dy -= dh
  if (position === 'mc' || position === 'tc' || position === 'bc') dx -= dw / 2
  if (position === 'ml' || position === 'mr' || position === 'mc') dy -= dh / 2
  ctx.save()
  ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity))
  ctx.drawImage(logo, Math.round(dx), Math.round(dy), dw, dh)
  ctx.restore()
}
