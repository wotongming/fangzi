/** 生成演示用大数据集（不读文件）：高斯散点簇 + 噪声时序，用于即时验证百万点渲染性能 */
import type { ColumnMeta, Dataset } from './types'

/** Box-Muller 正态随机数 */
function gauss(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** 简易可复现随机数（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成 n 个点：5 个高斯簇 + 8% 离群噪声（模拟 IoT 异常点）。
 * X/Y 直接在 [0,1] 归一化空间生成，原始值映射为可展示的物理量。
 */
export function makeSampleDataset(n: number, sourceName = '示例数据-传感器簇.csv'): Dataset {
  const rng = mulberry32(20261015)
  const centers = [
    [0.22, 0.72],
    [0.68, 0.78],
    [0.42, 0.45],
    [0.8, 0.3],
    [0.28, 0.24]
  ] as const
  const spreads = [0.07, 0.09, 0.06, 0.08, 0.07]
  const xy = new Float32Array(n * 2)
  const rawX = new Float64Array(n)
  const rawY = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let nx: number
    let ny: number
    if (rng() < 0.08) {
      // 均匀离群点（异常信号）
      nx = rng()
      ny = rng()
    } else {
      const c = Math.floor(rng() * centers.length)
      const s = spreads[c]!
      nx = centers[c]![0] + gauss(rng) * s
      ny = centers[c]![1] + gauss(rng) * s
    }
    nx = Math.min(1, Math.max(0, nx))
    ny = Math.min(1, Math.max(0, ny))
    xy[i * 2] = nx
    xy[i * 2 + 1] = ny
    // 物理量：X 0..3000 Hz 频段；Y -40..120 ℃ 传感器读数
    rawX[i] = nx * 3000
    rawY[i] = -40 + ny * 160
  }
  const xMeta: ColumnMeta = { name: '频率(Hz)', index: 0, type: 'number', min: 0, max: 3000 }
  const yMeta: ColumnMeta = { name: '温度(℃)', index: 1, type: 'number', min: -40, max: 120 }
  return {
    headers: ['频率(Hz)', '温度(℃)'],
    columns: [xMeta, yMeta],
    rowCount: n,
    totalRows: n,
    truncated: false,
    xy,
    rawX,
    rawY,
    xMeta,
    yMeta,
    sourceName
  }
}
