/**
 * 程序化音效（Web Audio API，零音频文件）。
 *
 * - 必须在用户手势内首次调用 ensure() 以创建/恢复 AudioContext（满足浏览器自动播放策略）；
 * - 消除音用 C 大调五声音阶随连击升高，爆炸用噪声 + 低通 + 指数衰减包络；
 * - pulse() 触发一个会衰减的“节拍能量”，beat() 供渲染层做背景/光效反应；
 * - 静音/失败都静默处理，绝不影响游戏可玩性。
 */

// C 大调五声音阶（C D E G A），跨两个八度，明亮不刺耳。
const PENTA = [
  523.25, 587.33, 659.25, 783.99, 880.0,
  1046.5, 1174.66, 1318.51, 1567.98, 1760.0
]

export class NeonAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private muted = false
  private beatValue = 0
  private lastBeatAt = 0

  /** 在用户手势（点击/touchstart/pointerdown）内调用，幂等。 */
  ensure(): void {
    if (this.muted) return
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.5
        this.master.connect(this.ctx.destination)
        // 预生成 1s 白噪声供爆炸复用。
        const len = this.ctx.sampleRate
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        this.noiseBuf = buf
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (m) {
      try {
        this.master?.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.01)
      } catch {
        /* ignore */
      }
    } else if (this.ctx && this.master) {
      this.ensure()
      this.master.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.02)
    }
  }

  get isMuted(): boolean {
    return this.muted
  }

  /** 连击音阶消除音；combo 从 0 起，越大音调越高。 */
  blip(combo = 0): void {
    if (!this.ready()) return
    const ctx = this.ctx!
    const freq = PENTA[Math.min(PENTA.length - 1, combo)] ?? 523.25
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, t)
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.08)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.32, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    osc.connect(gain).connect(this.master!)
    osc.start(t)
    osc.stop(t + 0.24)
    this.pulse(0.5)
  }

  /** 清脆命中音（节奏游戏 M2 也会复用）。 */
  hit(perfect = true): void {
    if (!this.ready()) return
    const ctx = this.ctx!
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(perfect ? 1320 : 990, t)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(perfect ? 0.18 : 0.1, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    osc.connect(gain).connect(this.master!)
    osc.start(t)
    osc.stop(t + 0.14)
    this.pulse(perfect ? 0.7 : 0.4)
  }

  /** 爆炸/大连消：滤波噪声 + 低频轰鸣。 */
  explode(intensity = 1): void {
    if (!this.ready() || !this.noiseBuf) return
    const ctx = this.ctx!
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1800, t)
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.4)
    const gain = ctx.createGain()
    const peak = Math.min(0.5, 0.18 + intensity * 0.08)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    src.connect(lp).connect(gain).connect(this.master!)
    src.start(t)
    src.stop(t + 0.5)

    // 叠加一个低频“咚”，增强打击感。
    const sub = ctx.createOscillator()
    const sg = ctx.createGain()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(160, t)
    sub.frequency.exponentialRampToValueAtTime(60, t + 0.3)
    sg.gain.setValueAtTime(0.0001, t)
    sg.gain.exponentialRampToValueAtTime(0.28, t + 0.012)
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    sub.connect(sg).connect(this.master!)
    sub.start(t)
    sub.stop(t + 0.36)
    this.pulse(Math.min(1, 0.6 + intensity * 0.12))
  }

  /** 记录一次节拍能量（0..1），随时间指数回落。 */
  pulse(strength: number): void {
    this.beatValue = Math.max(this.beatValue, Math.min(1, strength))
    this.lastBeatAt = performance.now()
  }

  /** 当前节拍能量 0..1（渲染背景呼吸/光效用）。 */
  beat(): number {
    if (this.beatValue <= 0) return 0
    const dt = (performance.now() - this.lastBeatAt) / 1000
    const v = this.beatValue * Math.exp(-4.5 * dt)
    if (v < 0.01) {
      this.beatValue = 0
      return 0
    }
    return v
  }

  suspend(): void {
    try {
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
    } catch {
      /* ignore */
    }
  }

  /** 彻底关闭上下文（游戏组件卸载/重开时调用，避免多次重开堆积 AudioContext）。 */
  close(): void {
    try {
      if (this.ctx) void this.ctx.close()
    } catch {
      /* ignore */
    }
    this.ctx = null
    this.master = null
    this.noiseBuf = null
  }

  private ready(): boolean {
    return !this.muted && !!this.ctx && !!this.master && this.ctx.state === 'running'
  }
}

/** 触感振动（不支持/失败静默）。enabled 由设置决定。 */
export function haptic(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* ignore */
  }
}
