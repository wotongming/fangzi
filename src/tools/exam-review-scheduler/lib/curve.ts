/**
 * curve.ts —— 模考分数趋势曲线的几何计算（纯函数，手写 SVG 坐标换算）。
 * 统一换算为百分制（score/fullScore*100），目标分画水平虚线。
 */
import type { MockExam } from './models'

export interface CurveDatum {
  exam: MockExam
  percent: number
  x: number
  y: number
}

export interface CurveGeometry {
  W: number
  H: number
  pad: number
  points: CurveDatum[]
  /** polyline points 字符串 */
  line: string
  /** 目标分（百分制）对应的 y 坐标；无目标分时为 null */
  targetY: number | null
  /** 最近一次相对首次的百分制变化（>0 进步，<0 退步） */
  trend: number | null
  avg: number | null
}

export function examPercent(e: MockExam): number {
  if (!e.fullScore || e.fullScore <= 0) return 0
  return (e.score / e.fullScore) * 100
}

/**
 * @param exams 已按日期升序排列的模考记录
 * @param targetScore 百分制目标分（0~100）；<=0 表示不画参考线
 */
export function buildCurve(exams: MockExam[], targetScore: number, W = 800, H = 300): CurveGeometry {
  const pad = 36
  const sorted = [...exams].sort((a, b) => a.date.localeCompare(b.date))
  const percents = sorted.map(examPercent)
  const innerW = W - pad * 2
  const innerH = H - pad * 2

  const n = sorted.length
  const points: CurveDatum[] = sorted.map((exam, i) => {
    const percent = percents[i] ?? 0
    const x = n === 1 ? pad + innerW / 2 : pad + (i / (n - 1)) * innerW
    // y 轴固定 0~100 百分制，便于跨次比较
    const y = H - pad - Math.max(0, Math.min(100, percent)) / 100 * innerH
    return { exam, percent, x, y }
  })

  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const targetY =
    targetScore > 0 ? H - pad - Math.max(0, Math.min(100, targetScore)) / 100 * innerH : null

  const avg =
    percents.length > 0 ? percents.reduce((s, v) => s + v, 0) / percents.length : null
  const trend =
    percents.length >= 2 ? percents[percents.length - 1]! - percents[0]! : null

  return { W, H, pad, points, line, targetY, trend, avg }
}
