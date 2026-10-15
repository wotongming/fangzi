import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSegments, toSrtTime, formatClock, mergeSegments, splitSegment, joinSegments } from '../src/tools/local-transcribe/lib/segment.ts'
import { splitSentences, summarize } from '../src/tools/local-transcribe/lib/summarize.ts'
import { computePeaks } from '../src/tools/local-transcribe/lib/waveform.ts'
import { buildTxt, buildSrt, buildMd, buildExport } from '../src/tools/local-transcribe/lib/export.ts'
import { monthKey, addUsedSeconds, quotaState, FREE_SECONDS_PER_MONTH } from '../src/tools/local-transcribe/lib/quota.ts'
import type { TranscriptRecord } from '../src/tools/local-transcribe/lib/types.ts'

/* ---------------- 时间戳分段 ---------------- */

test('toSegments：规整正常 chunks 并按时间排序', () => {
  const segs = toSegments(
    [
      { timestamp: [2, 5], text: ' 世界  ' },
      { timestamp: [0, 2], text: '你好' }
    ],
    5
  )
  assert.deepEqual(
    segs.map((s) => [s.start, s.end, s.text]),
    [
      [0, 2, '你好'],
      [2, 5, '世界']
    ]
  )
})

test('toSegments：null 起止用下一段起点 / 总时长兜底', () => {
  const segs = toSegments(
    [
      { timestamp: [0, null], text: '开头' },
      { timestamp: [3, null], text: '结尾' }
    ],
    8
  )
  assert.equal(segs[0]!.start, 0)
  assert.equal(segs[0]!.end, 3) // 用下一段起点
  assert.equal(segs[1]!.end, 8) // 末段用总时长
})

test('toSegments：越界裁剪、空文本丢弃、负时长纠正', () => {
  const segs = toSegments(
    [
      { timestamp: [-5, 999], text: '越界' },
      { timestamp: [1, 1], text: '' },
      { timestamp: [2, 3], text: '正常' }
    ],
    10
  )
  assert.equal(segs[0]!.start, 0)
  assert.equal(segs[0]!.end, 10)
  assert.equal(segs.length, 2) // 空文本被丢弃
  assert.equal(segs[1]!.text, '正常')
})

test('SRT / 时钟格式正确', () => {
  assert.equal(toSrtTime(0), '00:00:00,000')
  assert.equal(toSrtTime(3661.5), '01:01:01,500')
  assert.equal(formatClock(65), '01:05')
  assert.equal(formatClock(3725), '1:02:05')
})

test('合并 / 拆分 / 拼合', () => {
  const base = [
    { start: 0, end: 2, text: '你好' },
    { start: 2, end: 4, text: '世界' }
  ]
  const merged = mergeSegments(base, 0)
  assert.equal(merged.length, 1)
  assert.equal(merged[0]!.text, '你好 世界')
  assert.equal(merged[0]!.end, 4)

  const split = splitSegment([{ start: 0, end: 10, text: '一二三四五六七八' }], 0, 5)
  assert.equal(split.length, 2)
  assert.equal(split[0]!.end, 5)
  assert.equal(split[1]!.start, 5)
  // 越界拆分返回原数组
  assert.equal(splitSegment(base, 0, 99), base)

  assert.equal(joinSegments(base), '你好\n世界')
})

/* ---------------- 抽取式纪要 ---------------- */

test('splitSentences：中英文断句并过滤碎片', () => {
  const s = splitSentences('我们需要在周五前完成方案。OK！\n好的。\nThe team should follow up by Monday please.')
  assert.ok(s.includes('我们需要在周五前完成方案。'))
  assert.ok(s.some((x) => /follow up/i.test(x)))
  assert.ok(!s.includes('好的。')) // 2 字碎片被过滤
})

test('summarize：抽取待办与决定，产出一句话摘要', () => {
  const text = [
    '本次评审讨论了离线语音转写的整体方案与时间安排。',
    '我们需要在下周三之前完成模型选型并由小张负责跟进测试。',
    '团队决定采用 Whisper tiny 作为第一版本地方案。',
    '会后请尽快把会议纪要同步给所有参会同学确认。',
    '离线转写可以帮助敏感会议避免上传云端带来的合规风险。'
  ].join('')
  const sum = summarize(text)
  assert.ok(sum.headline.length > 0)
  assert.ok(sum.actionItems.some((x) => /下周三|负责|跟进|尽快|请/.test(x)))
  assert.ok(sum.decisions.some((x) => /决定|采用/.test(x)))
  assert.ok(sum.keyPoints.length >= 1)
  // 待办与决定不重复
  for (const a of sum.actionItems) assert.ok(!sum.decisions.includes(a))
})

test('summarize：空文本安全返回空结构', () => {
  const sum = summarize('')
  assert.equal(sum.headline, '')
  assert.deepEqual(sum.keyPoints, [])
})

/* ---------------- 波形 ---------------- */

test('computePeaks：桶数正确、归一化到可见高度', () => {
  const pcm = new Float32Array(1000)
  for (let i = 0; i < 1000; i++) pcm[i] = (i % 100 === 0 ? 1 : 0.1) * (i % 2 ? 1 : -1)
  const peaks = computePeaks(pcm, 50)
  assert.equal(peaks.length, 50)
  assert.ok(Math.max(...peaks) > 0.8)
  assert.ok(Math.min(...peaks) >= 0.03)
  assert.deepEqual(computePeaks(new Float32Array(0), 10), new Array(10).fill(0))
})

/* ---------------- 导出 ---------------- */

const rec: TranscriptRecord = {
  id: 't1',
  title: '周会录音',
  durationSec: 65,
  sourceName: 'meeting.wav',
  language: '中文',
  fullText: '第一句。\n第二句。',
  segments: [
    { start: 0, end: 2, text: '第一句。' },
    { start: 2, end: 4, text: '第二句。' }
  ],
  summary: { headline: '讨论方案', keyPoints: ['第一句。'], actionItems: [], decisions: [] },
  createdAt: new Date('2026-10-15T09:00:00').getTime(),
  updatedAt: new Date('2026-10-15T09:00:00').getTime()
}

test('TXT 导出包含标题与正文', () => {
  const txt = buildTxt(rec)
  assert.ok(txt.includes('周会录音'))
  assert.ok(txt.includes('第一句。'))
  assert.ok(txt.includes('第二句。'))
})

test('SRT 导出序号与时间戳', () => {
  const srt = buildSrt(rec.segments)
  assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:02,000\n第一句。'))
  assert.ok(srt.includes('2\n00:00:02,000 --> 00:00:04,000\n第二句。'))
})

test('Markdown 导出含纪要与时间戳正文', () => {
  const md = buildMd(rec)
  assert.ok(md.includes('# 周会录音'))
  assert.ok(md.includes('会议纪要'))
  assert.ok(md.includes('讨论方案'))
  assert.ok(md.includes('[00:00–00:02]'))
})

test('buildExport 分格式返回扩展名与 mime', () => {
  assert.equal(buildExport(rec, 'srt').ext, 'srt')
  assert.equal(buildExport(rec, 'md').ext, 'md')
  assert.equal(buildExport(rec, 'txt').ext, 'txt')
})

/* ---------------- 额度 ---------------- */

// 内存版 localStorage 桩
const mem = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0
} as unknown as Storage

test('月度额度：累加、用尽判定、Pro 不限', () => {
  const key = '2026-10'
  assert.equal(monthKey(new Date(2026, 9, 15)), key)
  mem.clear()
  assert.equal(addUsedSeconds(1800, key), 1800)
  assert.equal(addUsedSeconds(1800, key), 3600)
  const free = quotaState(false, key)
  assert.equal(free.usedSec, 3600)
  assert.equal(free.remainingSec, 0)
  assert.equal(free.exhausted, true)
  assert.equal(FREE_SECONDS_PER_MONTH, 3600)
  const pro = quotaState(true, key)
  assert.equal(pro.exhausted, false)
  assert.equal(pro.remainingSec, Number.POSITIVE_INFINITY)
})
