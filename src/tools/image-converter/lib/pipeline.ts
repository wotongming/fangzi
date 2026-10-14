/**
 * 工具链编排：把「压缩 / 裁剪 / 转换 / AI 增强」串成可复用步骤链。
 * 每一步输入输出为内存 Blob，支持中止、单步预览；全程不落盘、不上传。
 */
import type { AiModelId } from './ai/models'

export type StepId = 'convert' | 'crop' | 'upscale' | 'bgremove'

export interface ConvertParams {
  format: 'image/webp' | 'image/jpeg' | 'image/png'
  quality: number
  maxWidth: number
}

export interface CropParams {
  /** 裁剪目标（像素），0 表示不裁剪 */
  width: number
  height: number
  /** 裁剪模式：center / top / free */
  mode: 'center' | 'top' | 'free'
  /** mode=free 时的左上角起点 */
  x?: number
  y?: number
}

export interface StepDef {
  id: StepId
  label: string
  enabled: boolean
  params?: ConvertParams | CropParams | AiOp
}

export interface JobItem {
  id: string
  file: File
}

export interface JobResult {
  name: string
  blob: Blob
  ext: string
  ms: number
  stepLog: string[]
}

export interface StepRuntime {
  /** 单步处理：输入图片 Blob，输出处理后 Blob；fileName 用于命名推导 */
  run(step: StepDef, input: Blob, fileName: string, signal?: AbortSignal): Promise<Blob>
}

/** 根据源文件名与步骤链推导输出扩展名（AI 步骤输出 png 优先，其次按 convert 目标格式） */
export function deriveExt(steps: StepDef[], sourceName: string): string {
  // 去背景 / 超分输出透明或高保真 PNG，优先
  for (const s of steps) {
    if (s.enabled && (s.id === 'bgremove' || s.id === 'upscale')) return 'png'
  }
  for (const s of steps) {
    if (s.id === 'convert' && s.enabled) {
      const p = s.params as ConvertParams | undefined
      if (p) return { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[p.format] ?? 'png'
    }
  }
  const ext = sourceName.split('.').pop()?.toLowerCase()
  return ext && /^(png|jpe?g|webp|gif|bmp)$/.test(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'png'
}

/** 校验步骤链合法性：同一类步骤只能出现一次，且至少启用一步 */
export function validateChain(steps: StepDef[]): { ok: boolean; error?: string } {
  if (!steps.some((s) => s.enabled)) return { ok: false, error: '至少启用一个步骤' }
  const seen = new Set<string>()
  for (const s of steps) {
    if (s.enabled && seen.has(s.id)) return { ok: false, error: `步骤「${s.label}」重复，工具链不允许串联同一类步骤两次` }
    if (s.enabled) seen.add(s.id)
  }
  return { ok: true }
}

/** 顺序执行工具链：单张图片经过所有启用步骤，返回最终结果与每步耗时 */
export async function runChain(
  item: JobItem,
  steps: StepDef[],
  runtime: StepRuntime,
  onStep?: (step: StepDef, index: number, total: number) => void,
  signal?: AbortSignal
): Promise<JobResult> {
  const check = validateChain(steps)
  if (!check.ok) throw new Error(check.error ?? '工具链不合法')
  const enabled = steps.filter((s) => s.enabled)
  const started = performance.now()
  let input: Blob = item.file
  const stepLog: string[] = []
  for (let i = 0; i < enabled.length; i++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    onStep?.(enabled[i]!, i + 1, enabled.length)
    const t0 = performance.now()
    input = await runtime.run(enabled[i]!, input, item.file.name, signal)
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    stepLog.push(`${enabled[i]!.label} ${(performance.now() - t0).toFixed(0)}ms`)
  }
  const name = item.file.name.replace(/\.[^.]+$/, '')
  return { name, blob: input, ext: deriveExt(enabled, item.file.name), ms: performance.now() - started, stepLog }
}

export function stripExif(blob: Blob): Promise<Blob> {
  // 通过 canvas 重绘天然剥离 EXIF/GPS；返回 png（带透明）或按需 jpeg
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('无法创建画布上下文'))
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('重绘失败'))), 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解析失败'))
    }
    img.src = url
  })
}

export interface AiOp {
  model: AiModelId
}
