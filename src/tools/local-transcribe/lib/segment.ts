/**
 * 时间戳分段：把 Whisper 的 chunks 规整为可编辑 Segment[]，
 * 处理模型可能给出的 null 起止、越界、空文本等边界。纯函数，便于单测。
 */
import type { Segment } from './types'

type RawChunk = { timestamp: [number | null, number | null]; text: string }

/** 秒 → mm:ss / h:mm:ss（界面用） */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 秒 → SRT 时间戳 HH:MM:SS,mmm */
export function toSrtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = ms % 1000
  const p2 = (n: number) => String(n).padStart(2, '0')
  const p3 = (n: number) => String(n).padStart(3, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${p3(milli)}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * @param chunks Whisper chunks（timestamp 单位秒，可能为 null）
 * @param durationSec 音频总时长，用于末段兜底与越界裁剪
 */
export function toSegments(chunks: RawChunk[], durationSec: number): Segment[] {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const sorted = [...chunks].sort((a, b) => (a.timestamp[0] ?? 0) - (b.timestamp[0] ?? 0))
  const out: Segment[] = []
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]
    if (!c) continue
    const text = (c.text ?? '').trim()
    if (!text) continue
    const nextStart = sorted[i + 1]?.timestamp?.[0]
    const prevEnd = out.length ? out[out.length - 1]!.end : 0
    let start = c.timestamp[0]
    let end = c.timestamp[1]
    if (start === null || start === undefined || !Number.isFinite(start)) start = prevEnd
    if (end === null || end === undefined || !Number.isFinite(end)) {
      end = nextStart !== null && nextStart !== undefined && Number.isFinite(nextStart) ? nextStart : dur
    }
    start = clamp(start, 0, dur || start)
    end = clamp(end, start, dur || Math.max(end, start))
    if (end <= start) end = start + 0.01
    // 与上一段完全重叠且文本一致时跳过
    const last = out[out.length - 1]
    if (last && Math.abs(last.start - start) < 1e-6 && Math.abs(last.end - end) < 1e-6 && last.text === text) continue
    out.push({ start, end, text })
  }
  return out
}

/** 合并相邻分段（编辑操作） */
export function mergeSegments(segments: Segment[], index: number): Segment[] {
  if (index < 0 || index >= segments.length - 1) return segments
  const a = segments[index]!
  const b = segments[index + 1]!
  const merged: Segment = { start: a.start, end: b.end, text: `${a.text} ${b.text}`.replace(/\s+/g, ' ').trim() }
  return [...segments.slice(0, index), merged, ...segments.slice(index + 2)]
}

/** 将一段在 offset 秒处拆为两段（按文本长度粗略分配，可再编辑） */
export function splitSegment(segments: Segment[], index: number, atSec: number): Segment[] {
  const seg = segments[index]
  if (!seg || atSec <= seg.start || atSec >= seg.end) return segments
  const chars = [...seg.text]
  const ratio = (atSec - seg.start) / (seg.end - seg.start)
  const cut = Math.round(chars.length * clamp(ratio, 0, 1))
  const left = chars.slice(0, cut).join('').trim()
  const right = chars.slice(cut).join('').trim()
  if (!left || !right) return segments
  return [
    ...segments.slice(0, index),
    { start: seg.start, end: atSec, text: left },
    { start: atSec, end: seg.end, text: right },
    ...segments.slice(index + 1)
  ]
}

/** 由分段拼合完整文本 */
export function joinSegments(segments: Segment[]): string {
  return segments.map((s) => s.text.trim()).filter(Boolean).join('\n')
}
