/**
 * Canvas2D 兜底后端：无 WebGL 环境（旧浏览器 / 部分远程桌面）使用。
 * - line：CPU 一维分桶后折线路径；
 * - scatter：≤10 万点逐点半透明绘制，超量降级为二维密度网格；
 * - heatmap：CPU 二维分桶 → ImageData → 离屏画布平滑放大。
 * 接口与 WebGPU/WebGL 后端完全一致，交互层无感知。
 */
import { bin1D, bin2D, maxCount } from '../bins'
import type { ChartType, PlotRect, RenderOptions, VizRenderer } from '../types'
import { densityT, ramp } from './color'
import { normToPx } from './geometry'

const THEME_GREEN = 'rgba(63,125,94,0.32)'

export class Canvas2dRenderer implements VizRenderer {
  readonly kind = 'canvas2d' as const
  private xy: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(0))
  private count = 0

  constructor(private canvas: HTMLCanvasElement) {}

  setData(xy: Float32Array<ArrayBuffer>, pointCount: number): void {
    this.xy = xy
    this.count = pointCount
  }

  private ensureContext(o: RenderOptions): CanvasRenderingContext2D {
    const cssW = this.canvas.clientWidth
    const cssH = this.canvas.clientHeight
    const pw = Math.max(1, Math.round(cssW * o.dpr))
    const ph = Math.max(1, Math.round(cssH * o.dpr))
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
    }
    const ctx = this.canvas.getContext('2d')!
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    return ctx
  }

  render(o: RenderOptions): void {
    const ctx = this.ensureContext(o)
    if (this.count === 0) return
    if (o.chart === 'line') this.drawLine(ctx, o)
    else this.drawDensity(ctx, o, o.chart === 'heatmap')
  }

  private drawLine(ctx: CanvasRenderingContext2D, o: RenderOptions): void {
    const { plot, view } = o
    const { avg } = bin1D(this.xy, this.count, view, Math.max(2, Math.round(plot.w)))
    ctx.save()
    ctx.beginPath()
    ctx.rect(plot.x, plot.y, plot.w, plot.h)
    ctx.clip()
    ctx.strokeStyle = '#2f6f51'
    ctx.lineWidth = 1.8
    ctx.lineJoin = 'round'
    let started = false
    for (let gx = 0; gx < avg.length; gx++) {
      const y = avg[gx]!
      if (Number.isNaN(y)) {
        started = false
        continue
      }
      const px = plot.x + (gx + 0.5) * (plot.w / avg.length)
      const py = plot.y + (1 - (y - view.y0) / (view.y1 - view.y0)) * plot.h
      if (!started) {
        ctx.moveTo(px, py)
        started = true
      } else {
        ctx.lineTo(px, py)
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  private drawDensity(ctx: CanvasRenderingContext2D, o: RenderOptions, smooth: boolean): void {
    const { plot, view } = o
    ctx.save()
    ctx.beginPath()
    ctx.rect(plot.x, plot.y, plot.w, plot.h)
    ctx.clip()

    if (!smooth && this.count <= 100_000) {
      // 小数据量：逐点真实绘制
      ctx.fillStyle = THEME_GREEN
      for (let i = 0; i < this.count; i++) {
        const [px, py] = normToPx(this.xy[i * 2]!, this.xy[i * 2 + 1]!, view, plot)
        ctx.fillRect(px - 0.5, py - 0.5, 2, 2)
      }
      ctx.restore()
      return
    }

    // 大数据量：分桶 → 离屏像素 → 放大
    const gw = Math.max(2, Math.round(plot.w * 0.5))
    const gh = Math.max(2, Math.round(plot.h * 0.5))
    const bins = bin2D(this.xy, this.count, view, gw, gh)
    const m = maxCount(bins)
    const img = ctx.createImageData(gw, gh)
    for (let k = 0; k < bins.length; k++) {
      const c = bins[k]!
      if (c === 0) continue
      const [r, g, b] = ramp(densityT(c, m))
      const p = k * 4
      img.data[p] = r
      img.data[p + 1] = g
      img.data[p + 2] = b
      img.data[p + 3] = 255
    }
    const off = document.createElement('canvas')
    off.width = gw
    off.height = gh
    off.getContext('2d')!.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = smooth
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(off, plot.x, plot.y, plot.w, plot.h)
    ctx.restore()
  }

  destroy(): void {
    this.xy = new Float32Array(0)
    const ctx = this.canvas.getContext('2d')
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
}

export function isLargeForCanvas(chart: ChartType, n: number, plot: PlotRect): boolean {
  void plot
  return chart !== 'line' && n > 100_000
}
