/**
 * 波形：PCM 降采样为峰值数组（纯函数），Canvas 绘制 + 点击/拖动映射到时间。
 */

/** 把 PCM 降采样成 buckets 个峰值（0~1），用于绘制条形波形 */
export function computePeaks(pcm: Float32Array, buckets: number): number[] {
  const n = buckets > 0 ? Math.floor(buckets) : 1
  const total = pcm.length
  if (total === 0) return new Array(n).fill(0)
  const peaks = new Array<number>(n)
  const per = total / n
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * per)
    const end = Math.max(start + 1, Math.floor((i + 1) * per))
    let max = 0
    for (let j = start; j < end && j < total; j++) {
      const v = Math.abs(pcm[j] ?? 0)
      if (v > max) max = v
    }
    peaks[i] = max
  }
  // 归一化（避免安静录音波形贴底；保留最小可见高度）
  const maxPeak = peaks.reduce((m, v) => (v > m ? v : m), 0)
  const norm = maxPeak > 0 ? maxPeak : 1
  return peaks.map((v) => Math.max(0.03, (v / norm) * 0.92))
}

export interface WaveformDrawOptions {
  peaks: number[]
  /** 当前播放位置秒 */
  currentSec: number
  durationSec: number
  /** 已播放部分颜色 / 未播放颜色 */
  playedColor?: string
  restColor?: string
  background?: string
}

/** 在给定 canvas 上绘制波形（适配 devicePixelRatio，避免发虚） */
export function drawWaveform(canvas: HTMLCanvasElement, opts: WaveformDrawOptions): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cssW = canvas.clientWidth || 600
  const cssH = canvas.clientHeight || 80
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = opts.background ?? '#ffffff'
  ctx.fillRect(0, 0, cssW, cssH)

  const n = opts.peaks.length
  const gap = 1
  const barW = cssW / n
  const mid = cssH / 2
  const playedRatio = opts.durationSec > 0 ? Math.min(1, opts.currentSec / opts.durationSec) : 0
  for (let i = 0; i < n; i++) {
    const h = Math.max(2, opts.peaks[i]! * (cssH - 8))
    const x = i * barW
    const isPlayed = i / n <= playedRatio
    ctx.fillStyle = isPlayed ? opts.playedColor ?? '#3f7d5e' : opts.restColor ?? '#c9c3b4'
    const w = Math.max(1, barW - gap)
    ctx.fillRect(x, mid - h / 2, w, h)
  }
}

/** 把波形上的点击横坐标换算为时间（秒） */
export function xToTime(canvas: HTMLCanvasElement, clientX: number, durationSec: number): number {
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return ratio * durationSec
}
