/**
 * 混合搜索引擎：
 * - 始终可用：中文 bigram + 关键词重叠的高质量关键词检索（词面命中 + 片段高亮）
 * - 配置 AI 参数后：叠加向量语义检索，用 RRF（Reciprocal Rank Fusion）融合两路排名
 * - 向量服务不可用 / 超时 / 报错：自动无缝降级为纯关键词检索
 */

import type { AiSearchConfig, SearchDocument, SearchHit } from '../types'
import { isAiConfigured } from '../types'
import { buildIndex, scoreKeyword, type IndexedDoc } from './keyword'
import { createEmbeddings } from './embedding'
import { cosineSimilarity, embeddingTextOf } from './vector'
import { VectorCache } from './vector-store'

const KEYWORD_CUTOFF = 0.08
const VECTOR_CUTOFF = 0.3
const RRF_K = 60
const EMBED_TIMEOUT_MS = 8000
/** 单批嵌入文本上限，避免超出服务商输入条数限制 */
const EMBED_BATCH = 64

export interface SearchOptions {
  ai?: Partial<AiSearchConfig> | null
  limit?: number
}

export interface SearchOutcome {
  hits: SearchHit[]
  mode: 'hybrid' | 'keyword'
  degradedReason?: string
  timingMs: number
}

export class SearchEngine {
  private indexed: IndexedDoc[]
  private cache = new VectorCache()
  private docVectors = new Map<string, number[]>()
  private vectorModel: string | null = null

  constructor(private docs: SearchDocument[]) {
    this.indexed = buildIndex(docs)
  }

  /** 预取（补齐）全部工具文档向量；返回可用状态，供设置页“测试连接/建索引” */
  async prepareVectors(cfg: AiSearchConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureDocVectors(cfg)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async ensureDocVectors(cfg: AiSearchConfig): Promise<void> {
    if (this.vectorModel === cfg.model && this.docVectors.size === this.docs.length) return

    const missing: Array<{ id: string; text: string }> = []
    for (const doc of this.docs) {
      if (this.vectorModel === cfg.model && this.docVectors.has(doc.id)) continue
      const text = embeddingTextOf(doc)
      const cached = await this.cache.get(cfg.model, text)
      if (cached) {
        this.docVectors.set(doc.id, cached)
      } else {
        missing.push({ id: doc.id, text })
      }
    }

    for (let i = 0; i < missing.length; i += EMBED_BATCH) {
      const batch = missing.slice(i, i + EMBED_BATCH)
      const vectors = await createEmbeddings(
        cfg,
        batch.map((b) => b.text),
        AbortSignal.timeout(EMBED_TIMEOUT_MS)
      )
      await this.cache.setMany(
        cfg.model,
        batch.map((b, idx) => ({ text: b.text, vector: vectors[idx]! }))
      )
      batch.forEach((b, idx) => this.docVectors.set(b.id, vectors[idx]!))
    }
    this.vectorModel = cfg.model
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
    const started = performance.now()
    const limit = options.limit ?? 30
    const q = query.trim()

    if (!q) {
      return { hits: [], mode: 'keyword', timingMs: 0 }
    }

    // 1) 关键词通道（永远执行）
    const kwScored = this.indexed
      .map((entry) => ({ entry, kw: scoreKeyword(entry, q) }))
      .filter((x) => x.kw.score >= KEYWORD_CUTOFF)
      .sort((a, b) => b.kw.score - a.kw.score)

    // 2) 向量通道（可选）
    const useAi = isAiConfigured(options.ai)
    let vecRank = new Map<string, number>()
    let vecScore = new Map<string, number>()
    let mode: 'hybrid' | 'keyword' = 'keyword'
    let degradedReason: string | undefined

    if (useAi) {
      const cfg = options.ai as AiSearchConfig
      try {
        await this.ensureDocVectors(cfg)
        const [qv] = await createEmbeddings(cfg, [q], AbortSignal.timeout(EMBED_TIMEOUT_MS))
        const scored = this.docs
          .map((doc) => {
            const v = this.docVectors.get(doc.id)
            return { id: doc.id, cos: v ? cosineSimilarity(qv!, v) : 0 }
          })
          .filter((x) => x.cos >= VECTOR_CUTOFF)
          .sort((a, b) => b.cos - a.cos)
        scored.forEach((s, idx) => {
          vecRank.set(s.id, idx + 1)
          vecScore.set(s.id, s.cos)
        })
        if (scored.length > 0) mode = 'hybrid'
      } catch (err) {
        degradedReason = err instanceof Error ? err.message : String(err)
        mode = 'keyword'
        vecRank = new Map()
        vecScore = new Map()
      }
    }

    // 3) 融合
    let hits: SearchHit[]
    if (mode === 'hybrid') {
      const kwRank = new Map<string, number>()
      kwScored.forEach((x, idx) => kwRank.set(x.entry.doc.id, idx + 1))

      const candidateIds = new Set<string>([...kwRank.keys(), ...vecRank.keys()])
      const fused = [...candidateIds].map((id) => {
        const r1 = kwRank.get(id)
        const r2 = vecRank.get(id)
        const rrf = (r1 ? 1 / (RRF_K + r1) : 0) + (r2 ? 1 / (RRF_K + r2) : 0)
        return { id, rrf, r1: r1 ?? null, r2: r2 ?? null }
      })
      const maxRrf = Math.max(...fused.map((f) => f.rrf), 1e-9)

      hits = fused
        .map((f) => {
          const entry = this.indexed.find((e) => e.doc.id === f.id)!
          const kw = kwScored.find((x) => x.entry.doc.id === f.id)?.kw
          return {
            doc: entry.doc,
            score: Math.min(1, f.rrf / maxRrf),
            scores: {
              keyword: kw?.score ?? 0,
              vector: vecScore.get(f.id) ?? null
            },
            highlights: kw?.highlights ?? []
          } satisfies SearchHit
        })
        .sort((a, b) => b.score - a.score)
    } else {
      hits = kwScored.map(({ entry, kw }) => ({
        doc: entry.doc,
        score: kw.score,
        scores: { keyword: kw.score, vector: null },
        highlights: kw.highlights
      }))
    }

    hits = hits.slice(0, limit)
    return { hits, mode, degradedReason, timingMs: Math.round(performance.now() - started) }
  }
}
