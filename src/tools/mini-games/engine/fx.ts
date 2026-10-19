/**
 * 粒子系统与屏幕震动（后端无关的纯逻辑）。
 *
 * 关键点：这里不依赖 WebGL/DOM，可直接在 node:test 中做毫秒级断言
 * （爆发数量守恒、生命到期回收、阻力/重力积分、震幅衰减），把高频逻辑 bug 拦在浏览器 E2E 之前。
 * 运动积分使用帧率无关的指数阻力，保证不同刷新率（60/90/120Hz）观感一致。
 */
import type { BurstOptions, NeonParticle } from './types'

const TAU = Math.PI * 2

export class ParticleSystem {
  particles: NeonParticle[] = []
  cap: number

  constructor(cap: number) {
    this.cap = cap
  }

  setCap(cap: number): void {
    this.cap = cap
    if (this.particles.length > cap) this.particles.length = cap
  }

  get aliveCount(): number {
    return this.particles.length
  }

  clear(): void {
    this.particles.length = 0
  }

  /**
   * 在 (x,y) 处爆发一团粒子。实际生成数受剩余容量约束（满则不新增，绝不越界）。
   * @returns 实际加入的粒子数
   */
  burst(x: number, y: number, o: BurstOptions = {}, palette: number[] = [180]): number {
    const want = Math.max(0, Math.floor(o.count ?? 12))
    if (want === 0) return 0
    const room = this.cap - this.particles.length
    const n = Math.min(want, room)
    const power = o.power ?? 240
    const radial = o.radial !== false
    const baseDir = o.dir ?? 0
    const sizeScale = o.sizeScale ?? 1
    for (let i = 0; i < n; i++) {
      const angle = radial ? Math.random() * TAU : baseDir + (Math.random() - 0.5) * 0.6
      const speed = power * (0.35 + Math.random() * 0.75)
      const life = o.life ?? 0.45 + Math.random() * 0.7
      const paletteHue = palette[Math.floor(Math.random() * palette.length)] ?? 180
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: (2.2 + Math.random() * 3.2) * sizeScale,
        hue: o.hue ?? paletteHue,
        glow: 0.75 + Math.random() * 0.6
      })
    }
    return n
  }

  /** 推进一步（秒）。到期粒子用末尾交换删除，避免数组搬移。 */
  step(dt: number): void {
    if (dt <= 0) return
    // 帧率无关阻力：每秒速度衰减系数 e^-3.2 ≈ 0.04；轻微重力营造火花下落。
    const drag = Math.exp(-3.2 * dt)
    const gravity = 120 * dt
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      if (!p) continue
      p.life -= dt
      if (p.life <= 0) {
        const last = this.particles[this.particles.length - 1]
        if (last && i < this.particles.length - 1) this.particles[i] = last
        this.particles.pop()
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= drag
      p.vy = p.vy * drag + gravity
    }
  }
}

/** 屏幕震动：取较大震幅叠加、指数回落；offset() 每帧给出随机抖动向量。 */
export class ShakeState {
  mag = 0
  private maxMag: number

  constructor(maxMag = 18) {
    this.maxMag = maxMag
  }

  add(m: number): void {
    this.mag = Math.min(this.maxMag, this.mag + m)
  }

  update(dt: number): void {
    if (this.mag <= 0) return
    this.mag *= Math.exp(-7 * dt)
    if (this.mag < 0.12) this.mag = 0
  }

  offset(): { x: number; y: number } {
    if (this.mag <= 0) return { x: 0, y: 0 }
    return { x: (Math.random() * 2 - 1) * this.mag, y: (Math.random() * 2 - 1) * this.mag }
  }
}
