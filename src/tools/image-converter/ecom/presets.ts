/**
 * 电商平台规格预设（表驱动，平台尺寸变动时只改这里）+ 纯几何计算（可单测）。
 * 尺寸为各平台常见主图/商品图建议值，用户可在界面微调 longEdge / fit / targetBytes。
 */
import type { EcomSpec, EcomFit, EcomFormat } from './types'

export interface PresetSeed {
  key: string
  label: string
  ratio: number
  longEdge: number
  fit: EcomFit
  format: EcomFormat
  quality: number
  targetBytes: number
  bgColor: string
}

const WHITE = '#ffffff'

/** 内置主流平台规格（2026 常见值；以各平台最新规范为准，可在界面改） */
export const PLATFORM_PRESETS: PresetSeed[] = [
  { key: 'taobao-1x1-800', label: '淘宝/天猫 主图 1:1 · 800', ratio: 1, longEdge: 800, fit: 'contain', format: 'image/jpeg', quality: 0.88, targetBytes: 0, bgColor: WHITE },
  { key: 'taobao-1x1-1200', label: '淘宝/天猫 主图 1:1 · 1200（放大图）', ratio: 1, longEdge: 1200, fit: 'contain', format: 'image/jpeg', quality: 0.9, targetBytes: 0, bgColor: WHITE },
  { key: 'jd-1x1-800', label: '京东 主图 1:1 · 800（白底）', ratio: 1, longEdge: 800, fit: 'contain', format: 'image/jpeg', quality: 0.88, targetBytes: 0, bgColor: WHITE },
  { key: 'pdd-1x1-750', label: '拼多多 主图 1:1 · 750', ratio: 1, longEdge: 750, fit: 'cover', format: 'image/jpeg', quality: 0.86, targetBytes: 0, bgColor: WHITE },
  { key: 'douyin-1x1-800', label: '抖音商城 主图 1:1 · 800', ratio: 1, longEdge: 800, fit: 'cover', format: 'image/jpeg', quality: 0.88, targetBytes: 0, bgColor: WHITE },
  { key: 'xiaohongshu-3x4', label: '小红书 竖图 3:4 · 1080', ratio: 3 / 4, longEdge: 1080, fit: 'cover', format: 'image/jpeg', quality: 0.88, targetBytes: 0, bgColor: WHITE },
  { key: 'xianyu-3x4', label: '闲鱼 竖图 3:4 · 1080', ratio: 3 / 4, longEdge: 1080, fit: 'cover', format: 'image/jpeg', quality: 0.86, targetBytes: 0, bgColor: WHITE },
  { key: 'temku-1x1-900', label: 'Temu/Shopee 主图 1:1 · 900（白底）', ratio: 1, longEdge: 900, fit: 'contain', format: 'image/jpeg', quality: 0.88, targetBytes: 0, bgColor: WHITE },
  { key: 'amazon-1x1-1600', label: 'Amazon 主图 1:1 · 1600（白底·可缩放）', ratio: 1, longEdge: 1600, fit: 'contain', format: 'image/jpeg', quality: 0.9, targetBytes: 0, bgColor: WHITE }
]

export function seedToSpec(seed: PresetSeed): EcomSpec {
  return {
    key: seed.key,
    label: seed.label,
    ratio: seed.ratio,
    longEdge: seed.longEdge,
    fit: seed.fit,
    format: seed.format,
    quality: seed.quality,
    targetBytes: seed.targetBytes,
    bg: { mode: 'none', color: seed.bgColor }
  }
}

export function getSeed(key: string): PresetSeed | undefined {
  return PLATFORM_PRESETS.find((p) => p.key === key)
}

/** 由预设 + 全局覆盖 + 换底配置生成最终规格（纯函数） */
export function resolveSpec(
  seed: PresetSeed,
  override: {
    format?: EcomFormat
    quality?: number
    targetBytes?: number
    fit?: EcomFit
    bgMode?: EcomSpec['bg']['mode']
    bgColor?: string
    longEdge?: number
  } = {}
): EcomSpec {
  return {
    key: seed.key,
    label: seed.label,
    ratio: seed.ratio,
    longEdge: clampLongEdge(override.longEdge ?? seed.longEdge),
    fit: override.fit ?? seed.fit,
    format: override.format ?? seed.format,
    quality: clamp01(override.quality ?? seed.quality),
    targetBytes: Math.max(0, Math.round(override.targetBytes ?? seed.targetBytes)),
    bg: { mode: override.bgMode ?? 'none', color: override.bgColor ?? seed.bgColor }
  }
}

export function clamp01(v: number): number {
  return Math.max(0.3, Math.min(1, v))
}

export function clampLongEdge(v: number): number {
  return Math.max(120, Math.min(4096, Math.round(v)))
}

export interface Geometry {
  /** 输出画布尺寸 */
  cw: number
  ch: number
  /** 源图采样矩形 */
  sx: number
  sy: number
  sw: number
  sh: number
  /**绘制到画布的目标矩形（contain 时留白，cover 时铺满） */
  dx: number
  dy: number
  dw: number
  dh: number
}

/**
 * 计算 源图 → 规格画布 的几何关系（纯函数）。
 * - cover：先按目标比例居中裁剪源图，再铺满画布（无留白）。
 * - contain：完整保留源图，按比例缩放居中，空白区域由调用方用 spec.bg 底色填充。
 */
export function computeGeometry(srcW: number, srcH: number, ratio: number, longEdge: number, fit: EcomFit): Geometry {
  const r = ratio > 0 ? ratio : 1
  let cw: number
  let ch: number
  if (r >= 1) {
    cw = clampLongEdge(longEdge)
    ch = Math.max(1, Math.round(cw / r))
  } else {
    ch = clampLongEdge(longEdge)
    cw = Math.max(1, Math.round(ch * r))
  }

  if (fit === 'cover') {
    const srcRatio = srcW / srcH
    let sw = srcW
    let sh = srcH
    if (srcRatio > r) {
      // 源更宽：左右裁
      sw = srcH * r
    } else if (srcRatio < r) {
      // 源更高：上下裁
      sh = srcW / r
    }
    const sx = (srcW - sw) / 2
    const sy = (srcH - sh) / 2
    return { cw, ch, sx, sy, sw, sh, dx: 0, dy: 0, dw: cw, dh: ch }
  }

  // contain：完整源图，居中留白
  const scale = Math.min(cw / srcW, ch / srcH)
  const dw = Math.max(1, Math.round(srcW * scale))
  const dh = Math.max(1, Math.round(srcH * scale))
  const dx = Math.round((cw - dw) / 2)
  const dy = Math.round((ch - dh) / 2)
  return { cw, ch, sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh }
}

/** KB → 字节 */
export function kbToBytes(kb: number): number {
  return Math.max(0, Math.round(kb * 1024))
}
