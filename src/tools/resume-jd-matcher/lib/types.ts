/** resume-jd-matcher 类型定义 */

export type DimKey = 'skill' | 'duty' | 'qual'

export type GateKind = 'degree' | 'years' | 'location' | 'cert'

export interface HardGate {
  kind: GateKind
  /** JD 中的原始要求片段 */
  raw: string
  passed: boolean
  /** 判定依据 */
  detail: string
}

export interface DimScore {
  key: DimKey
  label: string
  /** 0–1 覆盖率 */
  coverage: number
  hit: string[]
  missing: string[]
  required: number
}

export interface MatchResult {
  /** 0–100 综合匹配分 */
  score: number
  dims: DimScore[]
  /** 技能/要求缺失项（canonical 或词项） */
  missing: string[]
  /** 命中的关键项 */
  hits: string[]
  gates: HardGate[]
  gatesAllPass: boolean
  /** 命中的本人简历要点（用于求职信/建议溯源），元素为段落 id */
  matchedBullets: string[]
  /** 参与统计的关键词总数 */
  keywordCount: number
  /**
   * 仅通过同义词/版本别名体现、简历未写标准名的 JD 要求技能。
   * 仍计入“能力匹配”给分，但用于提示“显式写出标准名以利 ATS 关键词检索”。
   */
  synonymOnly: string[]
  /** canonical -> 简历中实际出现的别名写法 */
  synonymAlias: Record<string, string>
}

export interface Suggestion {
  /** 缺失项 */
  missing: string
  /** 为什么可以这么补 */
  reason: string
  /** 来源段落 id（可溯源，禁止无来源） */
  sourceParaId: string
  /** 来源原文片段 */
  sourceText: string
  /** 基于该经历的改写草稿（未新增事实，仅显式命名/重组） */
  draft: string
}

export interface ParsedText {
  text: string
  /** 切分后的段落/要点，id 即数组下标字符串 */
  paragraphs: string[]
}

export interface ResumeVersion {
  id: string
  title: string
  text: string
  paragraphs: string[]
  updatedAt: number
}

export interface JdRecord {
  id: string
  company: string
  position: string
  text: string
  updatedAt: number
}

export type AppStatus = 'todo' | 'applied' | 'interview' | 'offer' | 'rejected'

export interface ApplicationRecord {
  id: string
  company: string
  position: string
  jdId?: string
  score: number | null
  status: AppStatus
  appliedAt: number
  nextFollowUp: number | null
  note: string
  updatedAt: number
}

export const APP_STATUS_LABEL: Record<AppStatus, string> = {
  todo: '待投递',
  applied: '已投递',
  interview: '面试中',
  offer: 'Offer',
  rejected: '已拒绝'
}
