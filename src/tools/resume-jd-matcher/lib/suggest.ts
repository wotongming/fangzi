/**
 * 定向改写建议（不虚构原则）。
 *
 * 适用对象（由匹配引擎给出）：JD 要求某项技能，简历通过同义词/版本别名体现了该能力，
 * 但没有写出“标准名”。这类并非能力缺失，而是 ATS/HR 关键词检索可能漏检，
 * 因此建议在对应经历里显式补标准名；建议严格带来源段落与原文别名，绝不新增经历事实。
 */
import type { Suggestion } from './types'

export interface SuggestBuildInput {
  /** 仅同义词命中、建议显式写出标准名的 canonical 列表 */
  synonymOnly: string[]
  /** canonical -> 简历中实际出现的别名写法 */
  synonymAlias?: Record<string, string>
  paragraphs: string[]
}

export function buildSuggestions(input: SuggestBuildInput): Suggestion[] {
  const { synonymOnly, synonymAlias = {}, paragraphs } = input
  const out: Suggestion[] = []
  for (const canonical of synonymOnly) {
    const alias = synonymAlias[canonical]
    if (!alias) continue
    const idx = paragraphs.findIndex((p) => p.toLowerCase().includes(alias.toLowerCase()))
    if (idx < 0) continue
    const sourceText = paragraphs[idx]!
    out.push({
      missing: canonical,
      reason: `你的这段经历已体现该能力${alias ? `（写法“${alias}”）` : ''}，但没有写出招聘 JD 与简历筛选系统常用的标准名「${canonical}」，关键词检索时可能被漏检。`,
      sourceParaId: String(idx),
      sourceText,
      draft: `${sourceText}（可在保留原事实的前提下，把技术标准名补全为：${canonical}）`
    })
  }
  return out
}
