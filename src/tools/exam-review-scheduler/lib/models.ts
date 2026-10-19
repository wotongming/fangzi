/**
 * exam-review-scheduler —— 领域模型与日期纯函数（零依赖、不 import Vue）。
 *
 * 合规边界：本工具只管理「用户自录」的错题与复习节奏，不做搜答案、
 * 不抓取/内置任何机构题库或出版社版权内容。所有题目数据均来自用户本人。
 */

/** 三级标签树：科目 → 章节 → 考点（末级） */
export interface TagChapter {
  name: string
  points: string[]
}
export interface TagNode {
  subject: string
  chapters: TagChapter[]
}

/** 一道错题的定位（必选末级考点才能提交） */
export interface PointPath {
  subject: string
  chapter: string
  point: string
}

export interface Project {
  id: string
  /** 如 "CPA-会计 2026" */
  name: string
  /** 考试日期 YYYY-MM-DD，决策看板用 */
  examDate: string
  /** 百分制目标分 */
  targetScore: number
  createdAt: number
  tags: TagNode[]
}

export interface Question {
  id: string
  projectId: string
  /** 题干（用户自录） */
  stem: string
  /** 错因 */
  wrongCause: string
  /** 正解 */
  answer: string
  /** 来源（纸质书/PDF/网课，自由文本，不抓取机构题库） */
  source: string
  pointPath: PointPath
  /** 压缩后的拍照附件（JPEG，去 EXIF），可选 */
  photoBlob?: Blob
  photoMime?: string
  photoWidth?: number
  photoHeight?: number
  // —— SM-2 调度状态 ——
  /** 难度系数，初始 2.5，下限 1.3 */
  ease: number
  /** 当前间隔（天） */
  intervalDays: number
  /** 连续答对次数 */
  reps: number
  /** 下次复习日 YYYY-MM-DD（本地日历日） */
  nextReview: string
  createdAt: number
}

export interface ReviewLog {
  id: string
  questionId: string
  ts: number
  /** 5=记得 / 3=模糊 / 1=已忘 */
  grade: 1 | 3 | 5
  /** 本次自评后算出的间隔（天），用于审计 */
  intervalAfter: number
}

export interface MockExam {
  id: string
  projectId: string
  /** 考试日期 YYYY-MM-DD */
  date: string
  subject: string
  score: number
  fullScore: number
  /** 用时（分钟） */
  minutes: number
  note?: string
  createdAt: number
}

export type Grade = 1 | 3 | 5

export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 本地时区当天 YYYY-MM-DD（避免 toISOString 的 UTC 漂移） */
export function today(): string {
  const d = new Date()
  return toLocalDateStr(d)
}

export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** YYYY-MM-DD → 当地零点 ms（避免 UTC 偏移） */
export function dayMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime()
}

/** 本地日历日 + n 天（整数天差，跨年/跨月/闰年安全） */
export function addDays(date: string, n: number): string {
  const ms = dayMs(date) + Math.round(n) * 86400000
  return toLocalDateStr(new Date(ms))
}

/** 本地日历日相差天数：dayDiff(a, b) = b - a（n 天）。同为本地零点，无夏令时漂移。 */
export function dayDiff(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / 86400000)
}

/** 标签树扁平化出全部末级考点 key（subject / chapter / point），用于去重与下拉 */
export function flattenPoints(tags: TagNode[]): PointPath[] {
  const out: PointPath[] = []
  for (const s of tags) {
    for (const c of s.chapters) {
      for (const p of c.points) out.push({ subject: s.subject, chapter: c.name, point: p })
    }
  }
  return out
}

export function pointKey(p: PointPath): string {
  return `${p.subject}::${p.chapter}::${p.point}`
}
