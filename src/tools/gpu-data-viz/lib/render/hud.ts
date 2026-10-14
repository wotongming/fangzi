/**
 * HUD 层（Canvas2D）：三后端共用的坐标网格、漂亮刻度、轴标签、边框。
 * 数据由下层 data canvas（WebGPU/WebGL/Canvas2D）绘制，HUD 只画半透明网格与文字。
 */
import { formatValue } from '../format'
import { niceTicks } from '../scale'
import type { ColumnMeta, PlotRect, View } from '../types'
import { normToPx } from './geometry'

export interface HudInput {
  ctx: CanvasRenderingContext2D
  cssW: number
  cssH: number
  plot: PlotRect
  view: View
  xMeta: ColumnMeta
  yMeta: ColumnMeta
  /** 刷选矩形（归一化），存在时画虚线框与四点高亮 */
  brush?: { x0: number; y0: number; x1: number; y1: number } | null
}

export function drawHud(i: HudInput): void {
  const { ctx, cssW, cssH, plot, view, xMeta, yMeta } = i
  ctx.clearRect(0, 0, cssW, cssH)
  ctx.save()
  ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textBaseline = 'middle'

  // 可见窗口对应的原始范围
  const xVis0 = xMeta.min + view.x0 * (xMeta.max - xMeta.min)
  const xVis1 = xMeta.min + view.x1 * (xMeta.max - xMeta.min)
  const yVis0 = yMeta.min + view.y0 * (yMeta.max - yMeta.min)
  const yVis1 = yMeta.min + view.y1 * (yMeta.max - yMeta.min)

  const xTicks = niceTicks(xVis0, xVis1, Math.max(3, Math.floor(plot.w / 96)))
  const yTicks = niceTicks(yVis0, yVis1, Math.max(3, Math.floor(plot.h / 46)))

  // 网格 + X 轴标签
  ctx.strokeStyle = 'rgba(60,70,64,0.12)'
  ctx.lineWidth = 1
  ctx.fillStyle = '#5b6560'
  ctx.textAlign = 'center'
  for (const t of xTicks) {
    const normX = (t.value - xMeta.min) / (xMeta.max - xMeta.min || 1)
    const [px] = normToPx(normX, 0, view, plot)
    if (px < plot.x - 1 || px > plot.x + plot.w + 1) continue
    ctx.beginPath()
    ctx.moveTo(px, plot.y)
    ctx.lineTo(px, plot.y + plot.h)
    ctx.stroke()
    ctx.fillText(formatValue(t.value, xMeta.type), Math.min(px, plot.x + plot.w - 4), plot.y + plot.h + 18, 84)
  }

  // Y 轴标签 + 横向网格
  ctx.textAlign = 'right'
  for (const t of yTicks) {
    const normY = (t.value - yMeta.min) / (yMeta.max - yMeta.min || 1)
    const [, py] = normToPx(0, normY, view, plot)
    if (py < plot.y - 1 || py > plot.y + plot.h + 1) continue
    ctx.beginPath()
    ctx.moveTo(plot.x, py)
    ctx.lineTo(plot.x + plot.w, py)
    ctx.stroke()
    ctx.fillText(formatValue(t.value, yMeta.type), plot.x - 8, py, 56)
  }

  // 轴标题
  ctx.fillStyle = '#3a4440'
  ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(xMeta.name, plot.x + plot.w / 2, cssH - 10)
  ctx.save()
  ctx.translate(14, plot.y + plot.h / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(yMeta.name, 0, 0)
  ctx.restore()

  // 绘图区边框
  ctx.strokeStyle = 'rgba(50,60,55,0.55)'
  ctx.lineWidth = 1
  ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1)

  // 刷选框
  if (i.brush) {
    const [bx0, by1] = normToPx(i.brush.x0, i.brush.y1, view, plot)
    const [bx1, by0] = normToPx(i.brush.x1, i.brush.y0, view, plot)
    ctx.fillStyle = 'rgba(63,125,94,0.10)'
    ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0)
    ctx.strokeStyle = 'rgba(63,125,94,0.9)'
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.5
    ctx.strokeRect(bx0 + 0.5, by0 + 0.5, bx1 - bx0, by1 - by0)
    ctx.setLineDash([])
  }
  ctx.restore()
}
