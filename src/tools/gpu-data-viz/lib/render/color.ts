/**
 * 密度配色（viridis 近似），三后端共用同一套色带，保证 WebGPU / WebGL / Canvas 输出一致。
 * t∈[0,1] → [r,g,b]（0..255）。GLSL/WGSL 中以同名 ramp() 复刻此分段插值。
 */

// viridis 关键控制点（11 档）
const STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84],
  [72, 35, 116],
  [64, 67, 135],
  [52, 94, 141],
  [41, 120, 142],
  [32, 144, 140],
  [34, 167, 132],
  [68, 190, 112],
  [121, 209, 81],
  [189, 222, 38],
  [253, 231, 37]
]

export function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t))
  const pos = x * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(pos))
  const f = pos - i
  const a = STOPS[i]!
  const b = STOPS[i + 1]!
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ]
}

/** 密度归一化：用 log(1+k*count) 压缩，避免少数极热点压暗整体层次 */
export function densityT(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.log1p(6 * (count / max)) / Math.log1p(6)
}

/** CSS rgb 字符串（Canvas2D 使用） */
export function rampCss(t: number, alpha = 1): string {
  const [r, g, b] = ramp(t)
  return `rgba(${r},${g},${b},${alpha})`
}
