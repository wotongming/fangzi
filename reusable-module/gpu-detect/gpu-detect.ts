/**
 * gpu-detect —— 浏览器 GPU 能力探测与降级决策（通用、零依赖）。
 *
 * 关键经验（pipeline 002 踩坑沉淀，务必遵守）：
 *   探测 WebGPU 时**只请求到 adapter，绝不要 requestDevice() 后立即 device.destroy()**。
 *   在部分 Dawn / 软件渲染（SwiftShader）/ headless 环境里，提前申请并销毁 device
 *   会影响共享 instance，导致后续真正用于渲染的 device 的 canvas 上屏失效
 * （compute/离屏正常，唯独 present 报 “A valid external Instance reference no longer exists”）。
 *   device 的真实可用性应交给渲染器创建阶段的 try/catch + 超时降级链处理。
 *
 * 授权：MIT（fangzi 内部模块），沉淀自 pipeline 002 GPU 大数据可视化面板。
 */

export interface GpuCapability {
  /** WebGPU 可用（navigator.gpu 存在且在超时内成功 requestAdapter） */
  webgpu: boolean
  /** WebGL2 上下文可创建（主力兼容降级路径） */
  webgl2: boolean
  /** WebGPU 不可用/超时时的原因，可用于 UI 提示 */
  webgpuError?: string
  /** 推荐使用的后端 */
  preferred: 'webgpu' | 'webgl2' | 'canvas2d'
}

/**
 * 给永不 settle 的 Promise 加超时。
 * 部分虚拟机/软渲染/headless 环境下 requestAdapter() 会既不 resolve 也不 reject，必须主动放弃。
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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

/** 同步探测 WebGL2 上下文是否可创建（失败不抛错） */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('experimental-webgl2'))
  } catch {
    return false
  }
}

/**
 * 探测 WebGPU：只到 requestAdapter（带超时），不申请/销毁 device。
 * @param adapterTimeoutMs 适配器请求超时，默认 4000ms
 */
export async function probeWebGPU(
  adapterTimeoutMs = 4000
): Promise<{ ok: boolean; adapter?: GPUAdapter; error?: string }> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<GPUAdapter | null> } }
  if (!nav.gpu) return { ok: false, error: '当前浏览器不支持 WebGPU' }
  try {
    const adapter = await withTimeout(
      nav.gpu.requestAdapter(),
      adapterTimeoutMs,
      'WebGPU 适配器请求超时（可能为虚拟机/软渲染环境）'
    )
    if (!adapter) return { ok: false, error: '未检测到可用的 GPU 适配器（可能为虚拟机/软渲染环境）' }
    return { ok: true, adapter }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'WebGPU 初始化失败' }
  }
}

/**
 * 完整能力探测，返回能力位与推荐后端。
 * 注意：拿到 `preferred='webgpu'` 后，渲染器创建 device 时仍需自己 try/catch + 超时，
 * 失败则降级 WebGL2 / Canvas2D。
 */
export async function detectGpu(adapterTimeoutMs = 4000): Promise<GpuCapability> {
  const gpu = await probeWebGPU(adapterTimeoutMs)
  if (gpu.ok) return { webgpu: true, webgl2: hasWebGL2(), preferred: 'webgpu' }
  if (hasWebGL2()) {
    return { webgpu: false, webgl2: true, preferred: 'webgl2', webgpuError: gpu.error }
  }
  return { webgpu: false, webgl2: false, preferred: 'canvas2d', webgpuError: gpu.error }
}

/** 同步、零副作用的首屏快速初判（不申请 adapter，仅看特性与 WebGL2 上下文） */
export function quickGpuGuess(): 'webgpu' | 'webgl2' | 'canvas2d' {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return 'webgpu'
  if (hasWebGL2()) return 'webgl2'
  return 'canvas2d'
}
