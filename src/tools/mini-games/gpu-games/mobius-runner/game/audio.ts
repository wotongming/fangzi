/**
 * 程序化音效（Web Audio 合成，零素材）。首次用户手势内 resume()。
 * 缺失/被禁音频环境时全部静默降级，绝不抛错。
 */
export class MobiusAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = false

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return null
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.35
        this.master.connect(this.ctx.destination)
      }
      return this.ctx
    } catch {
      return null
    }
  }

  /** 必须在点击手势内调用以解锁音频（移动端策略） */
  resume(): void {
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.35, this.ctx.currentTime, 0.01)
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
    delay = 0
  ): void {
    const ctx = this.ensure()
    if (!ctx || !this.master || this.muted) return
    try {
      const t0 = ctx.currentTime + delay
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t0)
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(g)
      g.connect(this.master)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
    } catch {
      /* 静默降级 */
    }
  }

  private noise(dur: number, gain: number, hp = 800): void {
    const ctx = this.ensure()
    if (!ctx || !this.master || this.muted) return
    try {
      const t0 = ctx.currentTime
      const n = Math.floor(ctx.sampleRate * dur)
      const buf = ctx.createBuffer(1, n, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n)
      const src = ctx.createBufferSource()
      src.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = hp
      const g = ctx.createGain()
      g.gain.setValueAtTime(gain, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      src.connect(filter)
      filter.connect(g)
      g.connect(this.master)
      src.start(t0)
    } catch {
      /* 静默降级 */
    }
  }

  flip(): void {
    this.tone(320, 0.09, 'triangle', 0.18, 520)
  }

  gate(): void {
    this.tone(440, 0.07, 'sine', 0.12)
  }

  near(): void {
    this.tone(660, 0.12, 'sine', 0.2, 990)
    this.noise(0.12, 0.05, 1400)
  }

  perfect(comboLevel: number): void {
    const base = 520 + Math.min(comboLevel, 12) * 40
    this.tone(base, 0.1, 'triangle', 0.22, base * 1.5)
    this.tone(base * 1.5, 0.12, 'sine', 0.16, undefined, 0.06)
  }

  collect(): void {
    this.tone(880, 0.06, 'sine', 0.1, 1320)
  }

  twist(): void {
    this.tone(220, 0.5, 'sawtooth', 0.08, 660)
  }

  death(): void {
    this.tone(300, 0.5, 'sawtooth', 0.25, 60)
    this.noise(0.4, 0.12, 300)
  }
}

export function vibrate(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    /* 不支持则忽略 */
  }
}
