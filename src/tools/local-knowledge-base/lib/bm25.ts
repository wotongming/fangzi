/**
 * BM25 关键词检索（不依赖模型，语义模型不可用时的独立可用通道）。
 * 分词：拉丁/数字按词，CJK 按字一元 + 相邻二元（经典中文 BM25 近似）。
 */

export interface BM25Hit {
  id: string
  score: number
}

const K1 = 1.5
const B = 0.75

const LATIN = /[a-z0-9]+/g

/** CJK 统一表意文字（含扩展A常见区） */
function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)
}

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  const latin = lower.match(LATIN)
  if (latin) out.push(...latin)
  const chars: string[] = []
  for (const ch of lower) if (isCJK(ch)) chars.push(ch)
  for (let i = 0; i < chars.length; i++) {
    out.push(chars[i]!)
    if (i + 1 < chars.length) out.push(chars[i]! + chars[i + 1]!)
  }
  return out
}

interface DocTermStat {
  tf: Map<string, number>
  len: number
}

export class BM25 {
  private docs = new Map<string, DocTermStat>()
  private df = new Map<string, number>()
  private avgLen = 0

  add(id: string, text: string): void {
    if (this.docs.has(id)) this.remove(id)
    const tokens = tokenize(text)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    this.docs.set(id, { tf, len: tokens.length })
    for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1)
    this.recomputeAvg()
  }

  remove(id: string): void {
    const stat = this.docs.get(id)
    if (!stat) return
    for (const term of stat.tf.keys()) {
      const n = (this.df.get(term) ?? 1) - 1
      if (n <= 0) this.df.delete(term)
      else this.df.set(term, n)
    }
    this.docs.delete(id)
    this.recomputeAvg()
  }

  clear(): void {
    this.docs.clear()
    this.df.clear()
    this.avgLen = 0
  }

  private recomputeAvg(): void {
    let sum = 0
    for (const d of this.docs.values()) sum += d.len
    this.avgLen = this.docs.size ? sum / this.docs.size : 0
  }

  get size(): number {
    return this.docs.size
  }

  search(query: string, topK: number): BM25Hit[] {
    const qTokens = [...new Set(tokenize(query))]
    const N = this.docs.size
    if (!N || !qTokens.length) return []
    const hits: BM25Hit[] = []
    for (const [id, doc] of this.docs) {
      let score = 0
      for (const term of qTokens) {
        const f = doc.tf.get(term) ?? 0
        if (!f) continue
        const n = this.df.get(term) ?? 0
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
        const norm = (f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.len) / (this.avgLen || 1)))
        score += idf * norm
      }
      if (score > 0) hits.push({ id, score })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }
}
