/**
 * 纠错反馈：对 critical/warn 文案做节流播报（speechSynthesis，浏览器内置、无联网），
 * 同一条文案在冷却时间内不重复念；可整体静音。DOM 相关仅在浏览器可用时触发。
 */
import type { Issue } from './types'

export class Feedback {
  private lastSpokeAt = new Map<string, number>()
  private muted = false

  constructor(private cooldownMs = 2500) {}

  setMuted(m: boolean): void {
    this.muted = m
    if (m && typeof speechSynthesis !== 'undefined') {
      try { speechSynthesis.cancel() } catch { /* ignore */ }
    }
  }

  isMuted(): boolean {
    return this.muted
  }

  /** 返回本轮应该播报的最高优先级文案（也可供 HUD 高亮），并触发语音 */
  announce(issues: Issue[], now = Date.now()): string | null {
    const order = { critical: 0, warn: 1, info: 2 } as const
    const cand = [...issues].sort((a, b) => order[a.level] - order[b.level])[0]
    if (!cand) return null
    const last = this.lastSpokeAt.get(cand.code) ?? -Infinity
    if (now - last < this.cooldownMs) return null
    this.lastSpokeAt.set(cand.code, now)
    this.speak(cand.text)
    return cand.text
  }

  private speak(text: string): void {
    if (this.muted) return
    if (typeof window === 'undefined' || typeof speechSynthesis === 'undefined') return
    try {
      if (speechSynthesis.speaking) speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      u.rate = 1.05
      u.volume = 0.9
      speechSynthesis.speak(u)
    } catch { /* 某些环境无 TTS，静默降级 */ }
  }
}
