/**
 * process.ts —— 单张照片处理管线（主线程便捷封装）。
 * 底层复用 reusable-module/image-redraw（重绘即剥离全部元数据），叠加区域打码。
 */
import { redrawImage, supportsWebp, type OutMime } from '../../../../reusable-module/image-redraw/image-redraw'
import { applyMasks, type Mask, type RedactMode } from './redact'

export type { OutMime }

export interface ProcessOptions {
  outType: OutMime
  /** 0..1 */
  quality: number
  /** 最长边像素，0/不传为原尺寸 */
  maxEdge?: number
  masks: Mask[]
  redactMode: RedactMode
}

export interface ProcessResult {
  blob: Blob
  width: number
  height: number
}

export { supportsWebp }

/** 处理一张：输出文件不含任何元数据；返回编码后的 Blob */
export async function processImage(file: Blob, o: ProcessOptions): Promise<ProcessResult> {
  return redrawImage(file, {
    outType: o.outType,
    quality: o.quality,
    maxEdge: o.maxEdge,
    paint: (ctx, w, h) => {
      if (o.masks.length) applyMasks(ctx, w, h, o.masks, o.redactMode)
    }
  })
}

/** 选择输出格式：用户选 auto/webp 但环境不支持时回退 jpeg */
export function resolveOutType(want: 'auto' | OutMime): OutMime {
  if (want === 'image/webp' && !supportsWebp()) return 'image/jpeg'
  if (want === 'auto') return supportsWebp() ? 'image/jpeg' : 'image/jpeg' // 默认广泛兼容的 jpeg
  return want
}
