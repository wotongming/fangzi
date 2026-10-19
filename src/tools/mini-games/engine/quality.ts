/**
 * 设备分级与运行时降档（纯函数，无 DOM 依赖，可在 node:test 直接断言）。
 *
 * 原则：保真降级而非缺功能——三后端都能玩，只是粒子规模 / DPR / 辉光趟数不同。
 * 帧率不达标时按 stepDown 逐级降级（先辉光 → 再 DPR → 再粒子数），且不回涨，避免抖动。
 */
import type { BackendKind, QualitySpec } from './types'

export interface DeviceSignals {
  backend: BackendKind
  /** navigator.hardwareConcurrency（取不到给 undefined） */
  cores?: number
  /** navigator.deviceMemory（取不到给 undefined） */
  memory?: number
  /** 初始设备像素比 */
  dpr: number
}

const MIN_CAP = 120

/** 依据后端与设备信号给出初始规格。 */
export function pickQuality(s: DeviceSignals): QualitySpec {
  if (s.backend === 'canvas2d') {
    // Canvas2D 保底：百级粒子 + 中等 DPR，靠 'lighter' 混合出光感，不做额外辉光趟数。
    return { backend: 'canvas2d', particleCap: 220, dprCap: Math.min(1.5, s.dpr || 1), bloomPasses: 0 }
  }
  if (s.backend === 'webgpu') {
    return { backend: 'webgpu', particleCap: 20000, dprCap: Math.min(2, s.dpr || 1), bloomPasses: 2 }
  }
  // WebGL2：按 CPU/内存分档。
  const cores = s.cores ?? 4
  const memory = s.memory ?? 4
  const dprCap = Math.min(s.dpr || 1, cores >= 8 ? 1.75 : 1.5)
  if (cores >= 8 && memory >= 8) {
    return { backend: 'webgl2', particleCap: 1400, dprCap, bloomPasses: 2 }
  }
  if (cores >= 4) {
    return { backend: 'webgl2', particleCap: 900, dprCap, bloomPasses: 1 }
  }
  return { backend: 'webgl2', particleCap: 500, dprCap: Math.min(1.25, s.dpr || 1), bloomPasses: 1 }
}

/**
 * 运行时降一级（无副作用）。返回同构的新规格；已到底则原样返回。
 * 顺序：辉光趟数 → DPR → 粒子上限，保证最先牺牲最“贵”、最不影响可玩性的部分。
 */
export function stepDown(q: QualitySpec): QualitySpec {
  if (q.bloomPasses > 0) return { ...q, bloomPasses: q.bloomPasses - 1 }
  if (q.dprCap > 1) {
    const next = Math.max(1, Math.round((q.dprCap - 0.25) * 100) / 100)
    return { ...q, dprCap: next }
  }
  if (q.particleCap > MIN_CAP) {
    return { ...q, particleCap: Math.max(MIN_CAP, Math.floor(q.particleCap / 2)) }
  }
  return q
}

/**
 * 应用用户手动选择的粒子规格（auto 不改变自动结果）。
 * high：在自动规格上放开上限；low：关闭辉光、锁 DPR=1、压低粒子数，优先省电与流畅。
 */
export function applyManual(q: QualitySpec, manual: 'auto' | 'high' | 'low'): QualitySpec {
  if (manual === 'low') {
    return { ...q, bloomPasses: 0, dprCap: 1, particleCap: Math.min(q.particleCap, 260) }
  }
  if (manual === 'high' && q.backend !== 'canvas2d') {
    return {
      ...q,
      bloomPasses: Math.max(q.bloomPasses, 2),
      dprCap: Math.max(q.dprCap, Math.min(2, 2)),
      particleCap: q.backend === 'webgpu' ? q.particleCap : Math.round(q.particleCap * 1.6)
    }
  }
  return q
}

/** 判断规格是否已降到最低（无法再 stepDown）。 */
export function isFloor(q: QualitySpec): boolean {
  return q.bloomPasses === 0 && q.dprCap <= 1 && q.particleCap <= MIN_CAP
}
