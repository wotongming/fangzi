/** 绘图区布局：CSS 像素尺寸 → 去除坐标留白后的绘图矩形（三后端统一） */
import type { PlotRect } from '../types'

export const PAD = { left: 66, right: 18, top: 18, bottom: 42 }

export function computePlot(cssW: number, cssH: number): PlotRect {
  const w = Math.max(80, cssW - PAD.left - PAD.right)
  const h = Math.max(60, cssH - PAD.top - PAD.bottom)
  return { x: PAD.left, y: PAD.top, w, h }
}

/** 归一化数据坐标（0..1，y 向上）→ 绘图区 CSS 像素 */
export function normToPx(nx: number, ny: number, view: { x0: number; y0: number; x1: number; y1: number }, plot: PlotRect): [number, number] {
  return [
    plot.x + ((nx - view.x0) / (view.x1 - view.x0)) * plot.w,
    plot.y + (1 - (ny - view.y0) / (view.y1 - view.y0)) * plot.h
  ]
}
