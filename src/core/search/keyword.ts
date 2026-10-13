/**
 * 高质量关键词检索：字段加权 bigram 覆盖率 + 关键词整词重叠 + 完整短语加成。
 * 无需 AI 配置即可工作，是检索能力的可靠降级方案。
 */

import { normalize, queryTokens } from './bigram'
import type { SearchDocument, SearchHighlight } from '../types'

/** 字段权重：名称与关键词最能代表工具，权重最高 */
const FIELD_WEIGHTS = {
  name: 6,
  keywords: 5,
  tagline: 3,
  painPoints: 3,
  scenarios: 2,
  targetUsers: 1
} as const

type WeightedField = keyof typeof FIELD_WEIGHTS

function fieldText(doc: SearchDocument, field: WeightedField): string {
  const v = doc[field]
  return Array.isArray(v) ? v.join(' ') : String(v ?? '')
}

/** 预构建的文档索引：字段 token 集合 + 归一化原文 */
export interface IndexedDoc {
  doc: SearchDocument
  fields: Record<WeightedField, { tokens: Set<string>; text: string }>
}

const TOTAL_WEIGHT = Object.values(FIELD_WEIGHTS).reduce((a, b) => a + b, 0)

export function buildIndex(docs: SearchDocument[]): IndexedDoc[] {
  return docs.map((doc) => {
    const fields = {} as IndexedDoc['fields']
    for (const field of Object.keys(FIELD_WEIGHTS) as WeightedField[]) {
      const text = fieldText(doc, field)
      fields[field] = { tokens: new Set(queryTokens(text)), text: normalize(text) }
    }
    return { doc, fields }
  })
}

export interface KeywordResult {
  score: number
  highlights: SearchHighlight[]
  /** 命中的关键词整词（解释用） */
  matchedKeywords: string[]
}

/**
 * 计算单文档与查询的相关性。
 * @param rawQuery 原始查询
 */
export function scoreKeyword(indexed: IndexedDoc, rawQuery: string): KeywordResult {
  const qNorm = normalize(rawQuery)
  if (!qNorm) return { score: 0, highlights: [], matchedKeywords: [] }

  const qTokens = queryTokens(rawQuery)
  if (qTokens.length === 0) return { score: 0, highlights: [], matchedKeywords: [] }

  let weighted = 0
  const highlights: SearchHighlight[] = []
  const matchedKeywords: string[] = []

  for (const field of Object.keys(FIELD_WEIGHTS) as WeightedField[]) {
    const { tokens, text } = indexed.fields[field]
    let hits = 0
    for (const t of qTokens) {
      if (tokens.has(t)) hits++
    }
    const coverage = hits / qTokens.length
    if (coverage <= 0) continue

    // 完整短语加成：归一化查询整体出现在字段原文中（强信号）
    const phraseBoost = text.includes(qNorm) ? 0.15 : 0
    const fieldScore = Math.min(1, coverage + phraseBoost)
    weighted += fieldScore * FIELD_WEIGHTS[field]

    const snippet = makeSnippet(field, indexed.doc, qTokens, qNorm)
    if (snippet) highlights.push(snippet)

    if (field === 'keywords') {
      for (const kw of indexed.doc.keywords) {
        const kwNorm = normalize(kw)
        if (kwNorm && (qNorm.includes(kwNorm) || kwNorm.includes(qNorm))) {
          matchedKeywords.push(kw)
        }
      }
    }
  }

  let score = weighted / TOTAL_WEIGHT

  // 关键词整词重叠额外加成（“2-gram + 关键词重叠”中的重叠信号）
  const qWords = qNorm.split(' ').filter(Boolean)
  let kwOverlap = 0
  for (const kw of indexed.doc.keywords) {
    const kwNorm = normalize(kw)
    if (!kwNorm) continue
    if (qNorm.includes(kwNorm)) kwOverlap++
    else if (qWords.some((w) => w.length >= 2 && kwNorm.includes(w))) kwOverlap += 0.5
  }
  score = Math.min(1, score + Math.min(0.25, kwOverlap * 0.08))

  return { score, highlights, matchedKeywords }
}

const FIELD_LABELS: Record<WeightedField, SearchHighlight['field']> = {
  name: 'name',
  keywords: 'keywords',
  tagline: 'tagline',
  painPoints: 'painPoints',
  scenarios: 'scenarios',
  targetUsers: 'targetUsers'
}

/** 生成命中片段：优先完整短语上下文，否则截取首个命中 token 周边文本 */
function makeSnippet(
  field: WeightedField,
  doc: SearchDocument,
  qTokens: string[],
  qNorm: string
): SearchHighlight | null {
  const raw = fieldText(doc, field)
  if (!raw) return null
  const lower = normalize(raw)

  const phraseIdx = lower.indexOf(qNorm)
  if (phraseIdx >= 0) {
    return { field: FIELD_LABELS[field], snippet: raw }
  }

  // 找到任一命中 token 的位置
  let idx = -1
  for (const t of qTokens) {
    const i = lower.indexOf(t)
    if (i >= 0) {
      idx = i
      break
    }
  }
  if (idx < 0) return null

  const start = Math.max(0, idx - 10)
  const end = Math.min(raw.length, idx + 24)
  const snippet = (start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '')
  return { field: FIELD_LABELS[field], snippet }
}
