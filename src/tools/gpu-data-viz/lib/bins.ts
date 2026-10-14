/**
 * CPU 分桶（binning）聚合：WebGL2 / Canvas2D 后端与单元测试共用。
 *
 * 与 GPU compute shader 同一套数学定义：
 *  - 二维分桶：把视口内的数据点按 (gx, gy) 计数，用于散点密度 / 热力图。
 *  - 一维分桶：按 X 列计数并累计归一化 Y 之和，用于折线（每桶平均 Y）。
 */
import type { PointStats, View } from './types'

export interface Grid {
  w: number
  h: number
}

/** 二维密度分桶；返回长度 w*h 的计数数组，行优先（bin = gy * w + gx） */
export function bin2D(xy: Float32Array, pointCount: number, view: View, w: number, h: number): Uint32Array {
  const bins = new Uint32Array(w * h)
  const vw = view.x1 - view.x0
  const vh = view.y1 - view.y0
  for (let i = 0; i < pointCount; i++) {
    const x = xy[i * 2]!
    const y = xy[i * 2 + 1]!
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue
    let gx = ((x - view.x0) / vw) * w
    let gy = ((y - view.y0) / vh) * h
    if (gx < 0) gx = 0
    else if (gx >= w) gx = w - 1
    if (gy < 0) gy = 0
    else if (gy >= h) gy = h - 1
    bins[Math.floor(gy) * w + Math.floor(gx)]!++
  }
  return bins
}

export interface LineBins {
  count: Uint32Array
  /** 每个桶的平均归一化 Y；空桶为 NaN */
  avg: Float32Array
}

/** 一维折线分桶：按 X 列聚合平均 Y */
export function bin1D(xy: Float32Array, pointCount: number, view: View, w: number): LineBins {
  const count = new Uint32Array(w)
  const sum = new Float64Array(w)
  const vw = view.x1 - view.x0
  for (let i = 0; i < pointCount; i++) {
    const x = xy[i * 2]!
    if (x < view.x0 || x > view.x1) continue
    let gx = ((x - view.x0) / vw) * w
    if (gx < 0) gx = 0
    else if (gx >= w) gx = w - 1
    const k = Math.floor(gx)
    count[k]!++
    sum[k]! += xy[i * 2 + 1]!
  }
  const avg = new Float32Array(w)
  for (let i = 0; i < w; i++) avg[i] = count[i]! > 0 ? sum[i]! / count[i]! : NaN
  return { count, avg }
}

/** 最大桶计数（颜色归一化用） */
export function maxCount(bins: Uint32Array): number {
  let m = 0
  for (let i = 0; i < bins.length; i++) if (bins[i]! > m) m = bins[i]!
  return m
}

/** 归一化空间矩形选区（坐标均在 [0,1]，ny 向上） */
export interface NormRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 取出刷选矩形内的点索引（矩形坐标为全量归一化空间） */
export function brushIndices(xy: Float32Array, pointCount: number, r: NormRect): Uint32Array {
  const out: number[] = []
  for (let i = 0; i < pointCount; i++) {
    const x = xy[i * 2]!
    const y = xy[i * 2 + 1]!
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) out.push(i)
  }
  return Uint32Array.from(out)
}

/** 对选中点做 count/min/max/avg 统计（基于原始数值） */
export function selectionStats(rawX: Float64Array, rawY: Float64Array, idxs: Uint32Array): PointStats {
  const empty: PointStats = {
    count: 0,
    xMin: NaN,
    xMax: NaN,
    xAvg: NaN,
    yMin: NaN,
    yMax: NaN,
    yAvg: NaN
  }
  if (idxs.length === 0) return empty
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  let sx = 0
  let sy = 0
  for (let k = 0; k < idxs.length; k++) {
    const i = idxs[k]!
    const x = rawX[i]!
    const y = rawY[i]!
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
    sx += x
    sy += y
  }
  return {
    count: idxs.length,
    xMin,
    xMax,
    xAvg: sx / idxs.length,
    yMin,
    yMax,
    yAvg: sy / idxs.length
  }
}
