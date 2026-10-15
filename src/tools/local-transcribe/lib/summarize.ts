/**
 * 本地会议纪要（V1：抽取式，纯规则，零额外大模型，结果可溯源到原文句子）。
 * 生成式 LLM 纪要（Qwen 等）列 V1.1：避免再下载数百 MB 模型，保证本档端到端可跑。
 */
import type { ExtractiveSummary } from './types'

const ACTION_RE =
  /(需要|需|应当|应该|请|务必|负责|跟进|落实|安排|完成|确认|推进|下周|本周|之前|前提交|待办|行动|尽快|按时|todo|to-do|follow\s?up|action item|should|must|need to|will|by\s+\w+|please|assign|owner)/i
const DECISION_RE =
  /(决定|已定|确定通过|拍板|达成一致|结论是|最终|批准|通过了|定了|decision|decided|agreed|approved|conclusion)/i

/** 中英文切句；保留句义，过滤过短碎片 */
export function splitSentences(text: string): string[] {
  if (!text) return []
  // 在句末标点后断句；兼容中英文与换行
  const parts = text
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
  return parts.filter((s) => {
    const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
    const letters = (s.match(/[A-Za-z0-9]/g) || []).length
    return cjk >= 4 || letters >= 6
  })
}

/** 中文一元/二元 + 英文词，用于句子打分 */
function tokenize(s: string): string[] {
  const toks: string[] = []
  const cjk = s.match(/[\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    const chars = [...run]
    for (const ch of chars) toks.push(ch)
    for (let i = 0; i < chars.length - 1; i++) toks.push(chars[i]! + chars[i + 1]!)
  }
  const en = s.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []
  toks.push(...en)
  return toks
}

const STOP = new Set([
  '我们', '他们', '这个', '那个', '一个', '可以', '就是', '因为', '所以', '如果', '然后', '以及', '进行',
  'the', 'and', 'for', 'that', 'this', 'with', 'are', 'was', 'you', 'our', 'will'
])

function scoreSentences(sentences: string[]): number[] {
  const freq = new Map<string, number>()
  for (const s of sentences) {
    for (const t of tokenize(s)) {
      if (STOP.has(t)) continue
      freq.set(t, (freq.get(t) ?? 0) + 1)
    }
  }
  return sentences.map((s) => {
    const seen = new Set<string>()
    let score = 0
    for (const t of tokenize(s)) {
      if (STOP.has(t) || seen.has(t)) continue
      seen.add(t)
      score += Math.log1p(freq.get(t) ?? 0)
    }
    // 过长句子略降权，避免整段被选作“要点”
    const len = [...s].length
    return score / (1 + Math.max(0, len - 60) / 120)
  })
}

function topByScore(sentences: string[], scores: number[], n: number, predicate?: (s: string) => boolean): string[] {
  return sentences
    .map((s, i) => ({ s, score: scores[i] ?? 0 }))
    .filter((x) => (predicate ? predicate(x.s) : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => sentences.indexOf(a.s) - sentences.indexOf(b.s)) // 回到原文顺序，便于阅读
    .map((x) => x.s)
}

/** 生成抽取式纪要 */
export function summarize(fullText: string): ExtractiveSummary {
  const sentences = splitSentences(fullText)
  if (sentences.length === 0) {
    return { headline: '', keyPoints: [], actionItems: [], decisions: [] }
  }
  const scores = scoreSentences(sentences)

  const actionItems = topByScore(sentences, scores, 5, (s) => ACTION_RE.test(s))
  const decisions = topByScore(
    sentences,
    scores,
    4,
    (s) => DECISION_RE.test(s) && !actionItems.includes(s)
  )
  const used = new Set([...actionItems, ...decisions])
  const keyPoints = topByScore(sentences, scores, 6, (s) => !used.has(s))

  const bestIdx = scores.indexOf(Math.max(...scores))
  let headline = sentences[bestIdx] ?? sentences[0] ?? ''
  if ([...headline].length > 60) headline = [...headline].slice(0, 60).join('') + '…'

  return { headline, keyPoints, actionItems, decisions }
}
