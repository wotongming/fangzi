/**
 * 混合检索 + 抽取式答案合成。
 * 向量余弦 + BM25 经 RRF 融合；模型不可用时纯 BM25。答案从 Top-K 片段抽取高相关句并附 [n] 引用。
 */
import { BM25, tokenize } from './bm25'
import type { KBChunk, Citation, AnswerResult } from './types'

export const DEFAULT_TOP_K = 5
export const CONFIDENCE_THRESHOLD = 0.32

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!
  return dot
}

interface Ranked {
  id: string
  rank: number
}

/** Reciprocal Rank Fusion：两路按排名 1/(k+rank) 融合 */
export function rrf(vectorHits: Ranked[], bm25Hits: Ranked[], k = 60): Map<string, number> {
  const fused = new Map<string, number>()
  for (const h of vectorHits) fused.set(h.id, (fused.get(h.id) ?? 0) + 1 / (k + h.rank))
  for (const h of bm25Hits) fused.set(h.id, (fused.get(h.id) ?? 0) + 1 / (k + h.rank))
  return fused
}

export interface RetrievalDeps {
  chunks: KBChunk[]
  bm25: BM25
  embedQuery?: (q: string) => Promise<number[]>
  topK?: number
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\.])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
}

/** 句子与问题的词重叠得分（0~1 归一），用于抽取 */
function sentenceRelevance(sentence: string, queryTerms: Set<string>): number {
  const terms = tokenize(sentence)
  if (!terms.length) return 0
  let hit = 0
  for (const t of terms) if (queryTerms.has(t)) hit++
  return hit / Math.sqrt(terms.length)
}

/**
 * 检索并合成答案。
 * - semantic=true 且提供 embedQuery：RRF 融合向量与 BM25；否则纯 BM25。
 * - 答案：从引用片段抽取与问题最相关的句子（按词重叠），保留顺序加 [n] 标记；
 *   抽不到句子时回退为「以下资料可能相关」列出片段首句。
 */
export async function retrieveAndAnswer(question: string, deps: RetrievalDeps): Promise<AnswerResult> {
  const topK = deps.topK ?? DEFAULT_TOP_K
  const bmHits = deps.bm25.search(question, topK * 2)

  let fused: Map<string, number>
  let semantic = false
  let vecTopScore = 0

  if (deps.embedQuery) {
    try {
      const qv = await deps.embedQuery(question)
      const scored = deps.chunks
        .filter((c) => c.vector && c.vector.length === qv.length)
        .map((c) => ({ id: c.id, score: cosine(qv, c.vector!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK * 2)
      if (scored.length) {
        semantic = true
        vecTopScore = scored[0]!.score
        const vHits: Ranked[] = scored.map((s, i) => ({ id: s.id, rank: i + 1 }))
        const bRanked: Ranked[] = bmHits.map((h, i) => ({ id: h.id, rank: i + 1 }))
        fused = rrf(vHits, bRanked)
      } else {
        fused = rrf([], bmHits.map((h, i) => ({ id: h.id, rank: i + 1 })))
      }
    } catch (err) {
      console.warn('[本地知识库] 语义检索降级为 BM25：', err)
      fused = rrf([], bmHits.map((h, i) => ({ id: h.id, rank: i + 1 })))
    }
  } else {
    fused = rrf([], bmHits.map((h, i) => ({ id: h.id, rank: i + 1 })))
  }

  const byId = new Map(deps.chunks.map((c) => [c.id, c]))
  const ordered = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score]) => ({ chunk: byId.get(id), score }))
    .filter((x): x is { chunk: KBChunk; score: number } => !!x.chunk)

  const citations: Citation[] = ordered.map((x) => ({
    chunkId: x.chunk.id,
    docId: x.chunk.docId,
    docName: x.chunk.docName,
    index: x.chunk.index,
    text: x.chunk.text,
    score: x.score
  }))

  // 置信度：语义通道用最高余弦；BM25 通道用归一化命中强度
  const topBm = bmHits[0]?.score ?? 0
  const confidence = semantic
    ? Math.max(0, Math.min(1, vecTopScore))
    : Math.max(0, Math.min(1, topBm / 12))

  // 抽取式合成
  const queryTerms = new Set(tokenize(question))
  const picked: { ref: number; sentence: string }[] = []
  citations.forEach((cit, ci) => {
    const sents = splitSentences(cit.text)
    const best = sents
      .map((s) => ({ s, r: sentenceRelevance(s, queryTerms) }))
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r)[0]
    if (best) picked.push({ ref: ci + 1, sentence: best.s })
  })

  let answer: string
  if (picked.length) {
    answer = picked.map((p) => `${p.sentence} [${p.ref}]`).join(' ')
  } else if (citations.length) {
    answer =
      '未在资料中找到与问题直接对应的表述。以下是可能相关的资料片段，请结合原文判断：\n' +
      citations.map((c, i) => `[${i + 1}] ${c.text.slice(0, 120)}…`).join('\n')
  } else {
    answer = '当前知识库中没有检索到相关内容。可尝试换个说法，或先导入相关文档。'
  }

  const lowConfidence = citations.length === 0 || confidence < CONFIDENCE_THRESHOLD
  return { answer, citations, confidence, semantic, lowConfidence }
}
