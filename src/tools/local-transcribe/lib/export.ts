/**
 * 导出转写与纪要：纯文本 / Markdown / SRT 字幕。
 * 构建函数为纯函数（便于单测）；downloadText 触发浏览器下载。
 */
import type { ExtractiveSummary, Segment, TranscriptRecord, ExportFormat } from './types'
import { formatClock, toSrtTime } from './segment'

function safeName(s: string): string {
  return (s || 'transcript').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').slice(0, 80).trim() || 'transcript'
}

export function buildTxt(rec: Pick<TranscriptRecord, 'title' | 'segments' | 'fullText'>): string {
  const body = rec.segments.length ? rec.segments.map((s) => s.text).join('\n') : rec.fullText
  return `${rec.title}\n${'='.repeat(Math.min(rec.title.length, 30))}\n\n${body}\n`
}

export function buildSrt(segments: Segment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${toSrtTime(s.start)} --> ${toSrtTime(s.end)}\n${s.text}\n`)
    .join('\n')
}

function summaryMd(summary: ExtractiveSummary | null): string {
  if (!summary) return ''
  const li = (arr: string[]) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- （未识别到）')
  return [
    '## 会议纪要',
    '',
    `**一句话摘要：** ${summary.headline || '（无）'}`,
    '',
    '### 关键要点',
    li(summary.keyPoints),
    '',
    '### 待办 / 行动项',
    li(summary.actionItems),
    '',
    '### 已做决定',
    li(summary.decisions),
    ''
  ].join('\n')
}

export function buildMd(rec: TranscriptRecord): string {
  const lines: string[] = [
    `# ${rec.title}`,
    '',
    `- 来源：${rec.sourceName}`,
    `- 时长：${formatClock(rec.durationSec)}`,
    `- 语言：${rec.language || '自动检测'}`,
    `- 生成时间：${new Date(rec.createdAt).toLocaleString()}`,
    '',
    summaryMd(rec.summary),
    '## 转写正文（带时间戳）',
    ''
  ]
  for (const s of rec.segments) {
    lines.push(`- \`[${formatClock(s.start)}–${formatClock(s.end)}]\` ${s.text}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function buildExport(rec: TranscriptRecord, fmt: ExportFormat): { content: string; mime: string; ext: string } {
  if (fmt === 'srt') return { content: buildSrt(rec.segments), mime: 'text/srt;charset=utf-8', ext: 'srt' }
  if (fmt === 'md') return { content: buildMd(rec), mime: 'text/markdown;charset=utf-8', ext: 'md' }
  return { content: buildTxt(rec), mime: 'text/plain;charset=utf-8', ext: 'txt' }
}

export function exportRecord(rec: TranscriptRecord, fmt: ExportFormat): void {
  const { content, mime, ext } = buildExport(rec, fmt)
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName(rec.title)}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
