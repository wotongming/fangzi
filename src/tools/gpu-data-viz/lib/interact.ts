/**
 * 视口交互状态机（纯函数，便于单测）：以归一化数据空间 [0,1]² 描述可见窗口。
 * - zoomAt：滚轮 / 双指缩放，保持焦点下的数据点不动。
 * - panBy：拖拽平移，参数为相对当前窗口宽高的比例位移。
 * - screenToNorm：CSS 像素坐标 → 全量归一化数据坐标（Y 轴翻转）。
 */
import { FULL_VIEW, type PlotRect, type View } from './types'

const MIN_SPAN = 1e-6

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 把窗口夹回 [0,1] 空间并保证跨度合法 */
function normalize(v: View): View {
  let { x0, x1, y0, y1 } = v
  if (x1 - x0 < MIN_SPAN) x1 = x0 + MIN_SPAN
  if (y1 - y0 < MIN_SPAN) y1 = y0 + MIN_SPAN
  if (x1 - x0 > 1) {
    x0 = 0
    x1 = 1
  }
  if (y1 - y0 > 1) {
    y0 = 0
    y1 = 1
  }
  if (x0 < 0) {
    x1 -= x0
    x0 = 0
  }
  if (x1 > 1) {
    x0 -= x1 - 1
    x1 = 1
  }
  if (y0 < 0) {
    y1 -= y0
    y0 = 0
  }
  if (y1 > 1) {
    y0 -= y1 - 1
    y1 = 1
  }
  return { x0: clamp(x0, 0, 1), y0: clamp(y0, 0, 1), x1: clamp(x1, 0, 1), y1: clamp(y1, 0, 1) }
}

/**
 * 以焦点缩放。
 * @param fx/fy 焦点在绘图区中的比例位置 0..1
 * @param factor 窗口跨度乘数（<1 放大，>1 缩小）
 */
export function zoomAt(view: View, fx: number, fy: number, factor: number): View {
  const fxc = clamp(fx, 0, 1)
  const fyc = clamp(fy, 0, 1)
  const vx = view.x0 + fxc * (view.x1 - view.x0)
  const vy = view.y0 + fyc * (view.y1 - view.y0)
  const w = Math.max(MIN_SPAN, (view.x1 - view.x0) * factor)
  const h = Math.max(MIN_SPAN, (view.y1 - view.y0) * factor)
  return normalize({ x0: vx - fxc * w, x1: vx + (1 - fxc) * w, y0: vy - fyc * h, y1: vy + (1 - fyc) * h })
}

/**
 * 平移。dx/dy 为拖拽距离相对窗口宽高的比例；
 * 拖拽方向与内容移动方向一致（向右拖 → 看到更左侧数据）。
 */
export function panBy(view: View, dxRatio: number, dyRatio: number): View {
  return normalize({
    x0: view.x0 - dxRatio * (view.x1 - view.x0),
    x1: view.x1 - dxRatio * (view.x1 - view.x0),
    y0: view.y0 + dyRatio * (view.y1 - view.y0),
    y1: view.y1 + dyRatio * (view.y1 - view.y0)
  })
}

export function resetView(): View {
  return { ...FULL_VIEW }
}

/** 当前窗口相对全量数据的缩放倍数（用于 UI 展示） */
export function zoomLevel(view: View): number {
  return 1 / ((view.x1 - view.x0 + view.y1 - view.y0) / 2)
}

/** CSS 像素 → 绘图区比例位置 0..1（Y 已翻转） */
export function screenToPlot(cssX: number, cssY: number, plot: PlotRect): { fx: number; fy: number } {
  return {
    fx: (cssX - plot.x) / plot.w,
    fy: 1 - (cssY - plot.y) / plot.h
  }
}

/** CSS 像素矩形（y 向下）→ 全量归一化数据空间矩形（y 向上） */
export function screenRectToNorm(
  px0: number,
  py0: number,
  px1: number,
  py1: number,
  plot: PlotRect,
  view: View
): { x0: number; y0: number; x1: number; y1: number } {
  const a = screenToPlot(px0, py1, plot) // 左下
  const b = screenToPlot(px1, py0, plot) // 右上
  return {
    x0: view.x0 + Math.min(a.fx, b.fx) * (view.x1 - view.x0),
    x1: view.x0 + Math.max(a.fx, b.fx) * (view.x1 - view.x0),
    y0: view.y0 + Math.min(a.fy, b.fy) * (view.y1 - view.y0),
    y1: view.y0 + Math.max(a.fy, b.fy) * (view.y1 - view.y0)
  }
}

/** 判断点（CSS 像素）是否落在绘图区内 */
export function inPlot(cssX: number, cssY: number, plot: PlotRect): boolean {
  return cssX >= plot.x && cssX <= plot.x + plot.w && cssY >= plot.y && cssY <= plot.y + plot.h
}
