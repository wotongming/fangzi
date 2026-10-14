/**
 * GPU 能力探测与降级决策：WebGPU → WebGL2 → Canvas2D。
 *
 * - WebGPU：navigator.gpu 存在且能成功请求 adapter/device（compute pipeline 可用）。
 * - WebGL2：createContext('webgl2') 成功（桌面 2026 覆盖率接近 100%，是主力降级路径）。
 * - Canvas2D：最终兜底（小数据量直绘）。
 */
import type { BackendKind } from '../types'

export interface DetectResult {
  backend: BackendKind
  /** 探测到的能力说明（展示给用户） */
  label: string
  /** WebGPU 不可用的原因（可空） */
  webgpuError?: string
}

/** 快速、同步的初判（不申请 adapter），用于首屏提示 */
export function quickDetect(): BackendKind {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return 'webgpu'
  const c = document.createElement('canvas')
  if (c.getContext('webgl2')) return 'webgl2'
  return 'canvas2d'
}

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2'))
  } catch {
    return false
  }
}

/**
 * 给永不 settle 的 Promise 加超时（部分虚拟机 / 软渲染 / headless 环境下
 * `navigator.gpu.requestAdapter()` 会既不 resolve 也不 reject，必须主动放弃并降级）。
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

async function hasWebGPU(): Promise<{ ok: boolean; error?: string }> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<GPUAdapter | null> } }
  if (!nav.gpu) return { ok: false, error: '当前浏览器不支持 WebGPU' }
  // 探测只到 adapter：不要在这里 requestDevice 再 destroy——在部分 Dawn/软渲染环境里，
  // 提前销毁 device 会影响共享 instance，导致后续真正渲染用的 device 无法上屏。
  // device 的真实可用性交给渲染器创建阶段的 try/catch 降级链处理。
  try {
    const adapter = await withTimeout(
      nav.gpu.requestAdapter(),
      4000,
      'WebGPU 适配器请求超时（可能为虚拟机/软渲染环境）'
    )
    if (!adapter) return { ok: false, error: '未检测到可用的 GPU 适配器（可能为虚拟机/软渲染环境）' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'WebGPU 初始化失败' }
  }
}

/** 完整探测（异步，会真实申请 WebGPU device），返回最终使用的后端 */
export async function detectBackend(): Promise<DetectResult> {
  const gpu = await hasWebGPU()
  if (gpu.ok) return { backend: 'webgpu', label: 'WebGPU（GPU 计算加速）' }
  if (hasWebGL2()) {
    return { backend: 'webgl2', label: 'WebGL2（GPU 渲染，兼容模式）', webgpuError: gpu.error }
  }
  return { backend: 'canvas2d', label: 'Canvas2D（CPU 模式，建议数据量 < 10 万点）', webgpuError: gpu.error }
}

export const BACKEND_LIMITS: Record<BackendKind, number> = {
  // 各后端建议的流畅点数上限；超过仍可尝试但会给出提示
  webgpu: Number.MAX_SAFE_INTEGER,
  webgl2: 5_000_000,
  canvas2d: 100_000
}
