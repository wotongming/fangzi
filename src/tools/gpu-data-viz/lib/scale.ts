/** 坐标轴「漂亮刻度」：在 [min,max] 内生成约 count 个 1/2/5 × 10^n 刻度 */
export interface Tick {
  value: number
  /** 在归一化区间 [loNorm,hiNorm] 中的比例位置 0..1（由调用方映射） */
  pos: number
}

export function niceTicks(min: number, max: number, count = 6, loNorm = 0, hiNorm = 1): Tick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [{ value: min, pos: (loNorm + hiNorm) / 2 }]
  }
  const span = max - min
  const rawStep = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normStep = rawStep / mag
  const step = (normStep < 1.5 ? 1 : normStep < 3 ? 2 : normStep < 7 ? 5 : 10) * mag
  const start = Math.ceil(min / step) * step
  const ticks: Tick[] = []
  const range = hiNorm - loNorm
  for (let v = start; v <= max + step * 1e-6; v += step) {
    if (v < min - step * 1e-6 || v > max + step * 1e-6) continue
    ticks.push({ value: v, pos: loNorm + ((v - min) / span) * range })
  }
  return ticks
}
