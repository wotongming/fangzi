/**
 * NeonEngine —— 炫光游戏渲染核心装配层。
 *
 * 职责：后端选择与降级链、设备规格与运行时帧率自适应、RAF 主循环（切后台自动暂停）、
 * 粒子/震屏推进、DPR 与画布尺寸管理、WebGL 上下文丢失热重启。
 *
 * M1 后端链：WebGL2 → Canvas2D（WebGPU/WGSL 后端在 M2 提供；探测到 WebGPU 时 M1 先落 WebGL2，
 * 视觉已完整，M2 再在最前面接入 WebGPU）。任何一步失败/超时都自动降级，绝不把异常抛到 UI。
 */
import { detectGpu, withTimeout } from '../../../../reusable-module/gpu-detect/gpu-detect'
import type { BackendKind, BurstOptions, NeonParticle, QualitySpec, Renderer } from './types'
import { applyManual, isFloor, pickQuality, stepDown } from './quality'
import { ParticleSystem, ShakeState } from './fx'
import { WebGl2Renderer } from './backend-webgl2'
import { Canvas2dRenderer } from './backend-canvas2d'

const STEP_MAX = 0.05 // 单帧最大步长（秒），掉帧/切回时不出现粒子瞬移
const LOW_DT = 1000 / 45 // 低于约 45fps 视为卡顿，触发降档评估

export interface NeonOptions {
  /** 用户手动粒子规格 */
  manual?: 'auto' | 'high' | 'low'
  /** 节拍提供器（音频），返回 0..1；不给则用时间呼吸 */
  beat?: () => number
  /** 实际命中后端变化回调（用于界面提示/统计） */
  onBackend?: (kind: BackendKind) => void
}

export class NeonEngine {
  readonly particles = new ParticleSystem(1)
  readonly shake = new ShakeState()
  readonly canvas: HTMLCanvasElement
  backend: Renderer | null = null
  backendKind: BackendKind = 'canvas2d'
  quality: QualitySpec
  private opts: NeonOptions
  private raf = 0
  private running = false
  private last = 0
  private cssW = 1
  private cssH = 1
  private dpr = 1
  private palette: number[] = [180, 200, 280, 320, 45]
  private lowMsAccum = 0
  private stepCooldown = 0
  private startTime = 0
  private disposed = false
  private lostHandler: ((e: Event) => void) | null = null

  constructor(canvas: HTMLCanvasElement, opts: NeonOptions = {}) {
    this.canvas = canvas
    this.opts = opts
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    this.quality = applyManual(
      pickQuality({
        backend: 'webgl2',
        cores: nav?.hardwareConcurrency,
        // deviceMemory 非标准，类型上未必声明。
        memory: (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory,
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      }),
      opts.manual ?? 'auto'
    )
    this.particles.setCap(this.quality.particleCap)
  }

  async init(): Promise<void> {
    let preferred: BackendKind = 'webgl2'
    try {
      const cap = await withTimeout(detectGpu(4000), 4500, 'gpu-detect')
      // M1 尚未提供 WebGPU 后端：即使首选 webgpu，也先落 WebGL2（M2 在此接入 WebGpuRenderer）。
      preferred = cap.webgl2 || cap.preferred === 'webgpu' ? 'webgl2' : 'canvas2d'
    } catch {
      preferred = 'webgl2' // 探测失败也先尝试 WebGL2，由其初始化结果决定最终降级
    }

    this.backend = await this.createBackend(preferred)
    this.backendKind = this.backend.kind
    this.opts.onBackend?.(this.backendKind)

    this.resize()
    this.backend.setPalette(this.palette)

    // WebGL 上下文丢失（如系统回收 GPU）→ 热重启到 Canvas2D，保证不黑屏。
    if (this.backendKind === 'webgl2') {
      this.lostHandler = (e: Event) => {
        e.preventDefault()
        void this.fallbackToCanvas()
      }
      this.canvas.addEventListener('webglcontextlost', this.lostHandler)
    }
  }

  private async createBackend(kind: BackendKind): Promise<Renderer> {
    if (kind === 'webgl2') {
      try {
        const spec: QualitySpec = { ...this.quality, backend: 'webgl2' }
        const r = new WebGl2Renderer(spec)
        await withTimeout(r.init(this.canvas), 6000, 'webgl2-init')
        r.resize(this.cssW || this.canvas.clientWidth || 1, this.cssH || this.canvas.clientHeight || 1, this.dpr || 1)
        return r
      } catch {
        // 落 Canvas2D
      }
    }
    const spec: QualitySpec = { ...this.quality, backend: 'canvas2d', particleCap: 220, dprCap: Math.min(1.5, this.dpr || 1), bloomPasses: 0 }
    const r2d = new Canvas2dRenderer(spec)
    await r2d.init(this.canvas)
    r2d.resize(this.cssW || this.canvas.clientWidth || 1, this.cssH || this.canvas.clientHeight || 1, this.dpr || 1)
    return r2d
  }

  private async fallbackToCanvas(): Promise<void> {
    if (this.disposed) return
    try {
      this.backend?.dispose()
    } catch {
      /* ignore */
    }
    const r = new Canvas2dRenderer({ backend: 'canvas2d', particleCap: 220, dprCap: Math.min(1.5, this.dpr || 1), bloomPasses: 0 })
    await r.init(this.canvas)
    r.resize(this.cssW, this.cssH, Math.min(this.dpr, 1.5))
    r.setPalette(this.palette)
    this.backend = r
    this.backendKind = 'canvas2d'
    this.opts.onBackend?.('canvas2d')
  }

  setPalette(hues: number[]): void {
    if (hues.length) {
      this.palette = hues
      this.backend?.setPalette(hues)
    }
  }

  /** 运行时切换特效档位（设置菜单用），立即更新粒子上限/辉光/DPR。 */
  setManual(manual: 'auto' | 'high' | 'low'): void {
    const next = applyManual({ ...this.quality }, manual)
    this.quality = next
    this.particles.setCap(next.particleCap)
    this.backend?.setBloomPasses?.(next.bloomPasses)
    const targetDpr = Math.min(window.devicePixelRatio || 1, next.dprCap)
    if (Math.abs(targetDpr - this.dpr) > 0.01) this.resize()
  }

  burst(x: number, y: number, o?: BurstOptions): number {
    return this.particles.burst(x, y, o, this.palette)
  }

  setShake(mag: number): void {
    this.shake.add(mag)
  }

  resize(): void {
    const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1
    this.cssW = w
    this.cssH = h
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprCap)
    this.backend?.resize(w, h, this.dpr)
  }

  start(): void {
    if (this.running || this.disposed) return
    this.running = true
    this.startTime = performance.now()
    this.last = performance.now()
    const loop = (now: number) => {
      if (!this.running) return
      this.frame(now)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private onVisibility = (): void => {
    // 回到前台时重置计时基准，避免把后台耗时计入造成一次大步长。
    if (!document.hidden) this.last = performance.now()
  }

  private frame(now: number): void {
    const rawDt = (now - this.last) / 1000
    this.last = now
    const hidden = typeof document !== 'undefined' && document.hidden
    const dt = hidden ? 0 : Math.min(rawDt, STEP_MAX)

    this.stepCooldown -= dt
    if (!hidden && dt > 0) {
      this.particles.step(dt)
      this.shake.update(dt)
      this.maybeDownshift(rawDt * 1000, dt)
    }

    const beat = this.opts.beat
      ? this.opts.beat()
      : (1 + Math.sin((now - this.startTime) / 1000) * 1.6) * 0.5 // 无音频时的缓慢呼吸
    const off = this.shake.offset()
    this.backend?.render(this.particles.particles, {
      dt,
      beat: Math.max(0, Math.min(1, beat)),
      shakeX: off.x,
      shakeY: off.y
    })
  }

  /** 连续卡顿则降一档（辉光→DPR→粒子），带冷却且不回涨。 */
  private maybeDownshift(frameMs: number, dt: number): void {
    if (isFloor(this.quality) || this.stepCooldown > 0) {
      if (frameMs < LOW_DT) this.lowMsAccum = 0
      return
    }
    if (frameMs > LOW_DT) {
      this.lowMsAccum += dt
      if (this.lowMsAccum >= 1.1) {
        const next = stepDown(this.quality)
        if (next !== this.quality) {
          this.quality = next
          this.particles.setCap(next.particleCap)
          this.backend?.setBloomPasses?.(next.bloomPasses)
          if (next.dprCap !== this.dpr || Math.abs(Math.min(window.devicePixelRatio || 1, next.dprCap) - this.dpr) > 0.01) {
            this.resize()
          }
        }
        this.lowMsAccum = 0
        this.stepCooldown = 1.2
      }
    } else {
      this.lowMsAccum = Math.max(0, this.lowMsAccum - dt)
    }
  }

  stop(): void {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    if (this.lostHandler) this.canvas.removeEventListener('webglcontextlost', this.lostHandler)
    this.particles.clear()
    this.backend?.dispose()
    this.backend = null
  }
}

/** 供测试/外部只读访问粒子类型。 */
export type { NeonParticle }
