/**
 * 图表控制器：renderer 生命周期、DPR 自适应、rAF 合并渲染、指针/滚轮/触屏交互。
 * Vue 组件只负责数据与 UI；画布相关全部收敛在这里，便于三后端一致性测试。
 */
import { panBy, screenRectToNorm, screenToPlot, zoomAt, zoomLevel } from './interact'
import { Canvas2dRenderer } from './render/canvas'
import { computePlot } from './render/geometry'
import { drawHud } from './render/hud'
import { WebGL2Renderer } from './render/webgl'
import type { BackendKind, ChartType, Dataset, PlotRect, PointStats, View, VizRenderer } from './types'
import { brushIndices, selectionStats } from './bins'

export type InteractionMode = 'pan' | 'brush'

export interface ControllerEvents {
  onBackend?: (kind: BackendKind, error?: string) => void
  onViewChange?: (zoom: number) => void
  onHover?: (text: string) => void
  onBrush?: (stats: PointStats | null) => void
  onFps?: (fps: number) => void
}

export class VizController {
  private renderer: VizRenderer | null = null
  private hudCtx: CanvasRenderingContext2D
  private dataset: Dataset | null = null
  view: View = { x0: 0, y0: 0, x1: 1, y1: 1 }
  chart: ChartType = 'scatter'
  mode: InteractionMode = 'pan'
  brush: { x0: number; y0: number; x1: number; y1: number } | null = null
  private brushIdxs: Uint32Array = new Uint32Array(0)
  private plot: PlotRect
  private raf = 0
  private dirty = true
  private dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  private ro: ResizeObserver | null = null
  private dragging = false
  private lastX = 0
  private lastY = 0
  private brushStart: { x: number; y: number } | null = null
  private pinchDist = 0
  private frames = 0
  private fpsAt = 0

  constructor(
    private dataCanvas: HTMLCanvasElement,
    private hudCanvas: HTMLCanvasElement,
    private events: ControllerEvents = {}
  ) {
    const ctx = hudCanvas.getContext('2d')
    if (!ctx) throw new Error('Canvas2D 不可用')
    this.hudCtx = ctx
    this.plot = computePlot(dataCanvas.clientWidth || 800, dataCanvas.clientHeight || 460)
  }

  /** 按偏好初始化后端，自动降级；返回实际后端 */
  async init(prefer: BackendKind): Promise<BackendKind> {
    let error: string | undefined
    const order: BackendKind[] = prefer === 'webgpu' ? ['webgpu', 'webgl2', 'canvas2d'] : prefer === 'webgl2' ? ['webgl2', 'canvas2d'] : ['canvas2d']
    for (const kind of order) {
      try {
        let renderer: VizRenderer
        if (kind === 'webgpu') {
          // 软渲染 / 虚拟机里 device 申请可能永不返回，加超时后降级
          const mod = await import('./render/webgpu')
          renderer = await withTimeout(
            mod.WebGpuRenderer.create(this.dataCanvas),
            8000,
            'WebGPU 渲染器初始化超时，降级到兼容后端'
          )
        } else if (kind === 'webgl2') {
          renderer = new WebGL2Renderer(this.dataCanvas)
        } else {
          renderer = new Canvas2dRenderer(this.dataCanvas)
        }
        this.renderer = renderer
        if (this.dataset) this.renderer.setData(this.dataset.xy, this.dataset.rowCount)
        this.events.onBackend?.(kind, error)
        this.invalidate()
        return kind
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
        this.renderer = null
      }
    }
    // 理论不会到达（canvas2d 必然成功）
    throw new Error('无可用渲染后端：' + (error ?? ''))
  }

  attach(): void {
    const el = this.hudCanvas
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('touchstart', this.onTouchStart, { passive: false })
    el.addEventListener('touchmove', this.onTouchMove, { passive: false })
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => this.resize())
      this.ro.observe(el)
    }
    this.resize()
    const loop = (t: number) => {
      if (this.dirty) {
        this.draw()
        this.dirty = false
      }
      this.frames++
      if (t - this.fpsAt >= 1000) {
        this.events.onFps?.(Math.round((this.frames * 1000) / (t - this.fpsAt)))
        this.frames = 0
        this.fpsAt = t
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.fpsAt = performance.now()
    this.raf = requestAnimationFrame(loop)
  }

  setDataset(ds: Dataset): void {
    this.dataset = ds
    this.view = { x0: 0, y0: 0, x1: 1, y1: 1 }
    this.brush = null
    this.brushIdxs = new Uint32Array(0)
    this.events.onBrush?.(null)
    this.renderer?.setData(ds.xy, ds.rowCount)
    this.invalidate()
  }

  setChart(c: ChartType): void {
    this.chart = c
    this.invalidate()
  }

  setMode(m: InteractionMode): void {
    this.mode = m
    this.hudCanvas.style.cursor = m === 'brush' ? 'crosshair' : 'grab'
  }

  resetView(): void {
    this.view = { x0: 0, y0: 0, x1: 1, y1: 1 }
    this.invalidate()
    this.events.onViewChange?.(1)
  }

  zoom(factor: number): void {
    this.view = zoomAt(this.view, 0.5, 0.5, factor)
    this.afterView()
  }

  invalidate(): void {
    this.dirty = true
  }

  private resize(): void {
    const w = this.hudCanvas.clientWidth
    const h = this.hudCanvas.clientHeight
    if (w === 0 || h === 0) return
    this.plot = computePlot(w, h)
    for (const c of [this.dataCanvas, this.hudCanvas]) {
      const pw = Math.round(w * this.dpr)
      const ph = Math.round(h * this.dpr)
      if (c.width !== pw || c.height !== ph) {
        c.width = pw
        c.height = ph
      }
    }
    this.invalidate()
  }

  private afterView(): void {
    this.invalidate()
    this.events.onViewChange?.(zoomLevel(this.view))
  }

  private draw(): void {
    if (!this.dataset) return
    this.renderer?.render({ chart: this.chart, view: this.view, plot: this.plot, dpr: this.dpr })
    drawHud({
      ctx: this.hudCtx,
      cssW: this.hudCanvas.clientWidth,
      cssH: this.hudCanvas.clientHeight,
      plot: this.plot,
      view: this.view,
      xMeta: this.dataset.xMeta,
      yMeta: this.dataset.yMeta,
      brush: this.brush
    })
  }

  // ---------- 指针交互 ----------
  private localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.hudCanvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private onDown = (e: PointerEvent): void => {
    const p = this.localPoint(e)
    this.dragging = true
    this.lastX = p.x
    this.lastY = p.y
    if (this.mode === 'brush') {
      this.brushStart = p
      this.brush = null
    }
    this.hudCanvas.setPointerCapture?.(e.pointerId)
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.localPoint(e)
    if (!this.dragging) {
      this.emitHover(p.x, p.y)
      return
    }
    if (this.mode === 'brush' && this.brushStart) {
      const r = screenRectToNorm(this.brushStart.x, this.brushStart.y, p.x, p.y, this.plot, this.view)
      this.brush = r
      this.invalidate()
    } else {
      const dx = (p.x - this.lastX) / this.plot.w
      const dy = (p.y - this.lastY) / this.plot.h
      this.view = panBy(this.view, dx, dy)
      this.lastX = p.x
      this.lastY = p.y
      this.afterView()
    }
  }

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    if (this.mode === 'brush' && this.brush && this.dataset) {
      const r = this.brush
      // 极小拖动视为点击：清除刷选
      if (Math.abs(r.x1 - r.x0) < 0.001 && Math.abs(r.y1 - r.y0) < 0.001) {
        this.brush = null
        this.brushIdxs = new Uint32Array(0)
        this.events.onBrush?.(null)
      } else {
        this.brushIdxs = brushIndices(this.dataset.xy, this.dataset.rowCount, r)
        this.events.onBrush?.(selectionStats(this.dataset.rawX, this.dataset.rawY, this.brushIdxs))
      }
      this.invalidate()
    }
    void e
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const p = this.localPoint(e)
    const { fx, fy } = screenToPlot(p.x, p.y, this.plot)
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    this.view = zoomAt(this.view, fx, fy, factor)
    this.afterView()
  }

  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      e.preventDefault()
      this.pinchDist = touchDist(e.touches)
    }
  }

  private onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const d = touchDist(e.touches)
      if (this.pinchDist > 0) this.view = zoomAt(this.view, 0.5, 0.5, this.pinchDist / d)
      this.pinchDist = d
      this.afterView()
    }
  }

  private emitHover(px: number, py: number): void {
    if (!this.dataset) return
    const { fx, fy } = screenToPlot(px, py, this.plot)
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return
    const ds = this.dataset
    const xVal = ds.xMeta.min + (this.view.x0 + fx * (this.view.x1 - this.view.x0)) * (ds.xMeta.max - ds.xMeta.min)
    const yVal = ds.yMeta.min + (this.view.y0 + fy * (this.view.y1 - this.view.y0)) * (ds.yMeta.max - ds.yMeta.min)
    this.events.onHover?.(`${ds.xMeta.name}: ${this.fmt(xVal, ds.xMeta.type)}　${ds.yMeta.name}: ${this.fmt(yVal, ds.yMeta.type)}`)
  }

  private fmt(v: number, t: 'number' | 'date' | 'string'): string {
    // 避免引入循环：轻量内联格式化
    if (t === 'date') {
      const d = new Date(v)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }
    return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
  }

  getSelection(): Uint32Array {
    return this.brushIdxs
  }

  /** 清除刷选框与选区，回到平移模式 */
  clearBrush(): void {
    this.brush = null
    this.brushIdxs = new Uint32Array(0)
    this.mode = 'pan'
    this.hudCanvas.style.cursor = 'grab'
    this.events.onBrush?.(null)
    this.invalidate()
  }

  getDataCanvas(): HTMLCanvasElement {
    return this.dataCanvas
  }

  getHudCanvas(): HTMLCanvasElement {
    return this.hudCanvas
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    const el = this.hudCanvas
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('touchstart', this.onTouchStart)
    el.removeEventListener('touchmove', this.onTouchMove)
    this.renderer?.destroy()
    this.renderer = null
  }
}

function touchDist(touches: TouchList): number {
  const a = touches[0]!
  const b = touches[1]!
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/** 为可能永不 settle 的异步初始化加超时，触发降级链 */
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
