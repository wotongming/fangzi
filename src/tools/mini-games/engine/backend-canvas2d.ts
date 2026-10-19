/**
 * Canvas2D 保底渲染后端：不支持/无法初始化 WebGL2 时仍可玩。
 * 预生成按色相缓存的 radial-gradient 发光精灵，配合 'lighter' 加法混合模拟霓虹辉光。
 * 粒子规模压到百级，保证极老设备与软件渲染环境也不掉帧、不白屏。
 */
import type { FrameInfo, NeonParticle, QualitySpec, Renderer } from './types'

const SPRITE_PX = 64

export class Canvas2dRenderer implements Renderer {
  readonly kind = 'canvas2d' as const
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private cssW = 1
  private cssH = 1
  private sprites = new Map<number, HTMLCanvasElement>()
  private bloomPasses: number

  constructor(spec: QualitySpec) {
    this.bloomPasses = spec.bloomPasses
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('canvas2d: 2d 上下文不可用')
    this.ctx = ctx
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW
    this.cssH = cssH
    if (!this.canvas || !this.ctx) return
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // 颜色取自每个粒子自带色相，后端按色相缓存精灵，无需单独保存调色板。
  setPalette(_hues: number[]): void {
    /* no-op：颜色随粒子下发 */
  }

  setBloomPasses(passes: number): void {
    this.bloomPasses = Math.max(0, Math.min(2, Math.round(passes)))
  }

  private spriteFor(hue: number): HTMLCanvasElement {
    const key = Math.round(hue)
    const cached = this.sprites.get(key)
    if (cached) return cached
    const c = document.createElement('canvas')
    c.width = SPRITE_PX
    c.height = SPRITE_PX
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createRadialGradient(
        SPRITE_PX / 2, SPRITE_PX / 2, 0,
        SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2
      )
      grad.addColorStop(0, `hsla(${key}, 100%, 78%, 0.95)`)
      grad.addColorStop(0.35, `hsla(${key}, 100%, 58%, 0.45)`)
      grad.addColorStop(1, `hsla(${key}, 100%, 55%, 0)`)
      g.fillStyle = grad
      g.fillRect(0, 0, SPRITE_PX, SPRITE_PX)
    }
    if (this.sprites.size > 64) this.sprites.clear() // 防止异常色相撑爆缓存
    this.sprites.set(key, c)
    return c
  }

  render(particles: readonly NeonParticle[], info: FrameInfo): void {
    const ctx = this.ctx
    if (!ctx) return
    const b = 0.015 + 0.018 * info.beat
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = `rgb(${Math.round(b * 255)}, ${Math.round((0.02 + 0.018 * info.beat) * 255)}, ${Math.round((0.035 + 0.03 * info.beat) * 255)})`
    ctx.fillRect(0, 0, this.cssW, this.cssH)

    if (!particles.length) return
    ctx.save()
    ctx.translate(info.shakeX, info.shakeY)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      if (!p) continue
      const fade = Math.max(0, Math.min(1, p.maxLife > 0 ? p.life / p.maxLife : 0))
      if (fade <= 0) continue
      const sprite = this.spriteFor(p.hue)
      const passes: Array<[number, number]> = this.bloomPasses >= 1 ? [[1, 0.9], [2, 0.28]] : [[1, 0.9]]
      for (const [mul, am] of passes) {
        const radius = p.size * mul
        ctx.globalAlpha = Math.min(1, fade * p.glow * am)
        ctx.drawImage(sprite, p.x - radius, p.y - radius, radius * 2, radius * 2)
      }
    }
    ctx.restore()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  dispose(): void {
    this.sprites.clear()
    this.ctx = null
    this.canvas = null
  }
}
