/**
 * 确定性伪随机（mulberry32）：同种子序列完全可复现，供关卡生成与单测。
 * 不依赖 DOM / three。
 */
export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [min,max) 浮点 */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** [min,max] 闭区间整数 */
export function intRange(rng: Rng, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1))
}

/** 以概率 p 取 true */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p
}
