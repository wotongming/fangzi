/**
 * 向量余弦相似度计算（纯函数，零依赖）。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function embeddingTextOf(doc: {
  name: string
  tagline: string
  keywords: string[]
  scenarios: string[]
  painPoints: string[]
  targetUsers: string[]
}): string {
  return [
    doc.name,
    doc.tagline,
    `关键词:${doc.keywords.join(' ')}`,
    `场景:${doc.scenarios.join(' ')}`,
    `痛点:${doc.painPoints.join(' ')}`,
    `用户:${doc.targetUsers.join(' ')}`
  ].join('\n')
}
