/**
 * queue.ts —— 今日复习队列（纯函数）。
 * 规则：nextReview <= 今天 的题目全部到期，按「逾期越久越靠前」排序。
 */
import { dayDiff, type Question } from './models'

export interface DueItem {
  question: Question
  /** 逾期天数（0=今天到期，>0=已逾期） */
  overdueDays: number
  /** 是否今天到期 */
  today: boolean
}

/** 某题相对今天的逾期天数（nextReview 早于今天 → 正数）。 */
export function overdueDaysOf(q: Question, todayStr: string): number {
  return Math.max(0, dayDiff(q.nextReview, todayStr))
}

/**
 * 今日到期队列：筛 nextReview <= today，按逾期天数降序（最久没复习的排最前）。
 * 同日到期的再按创建时间升序（先录的先复习）。
 */
export function dueToday(questions: Question[], todayStr: string): DueItem[] {
  return questions
    .filter((q) => q.nextReview <= todayStr)
    .map((q) => ({ question: q, overdueDays: overdueDaysOf(q, todayStr), today: q.nextReview === todayStr }))
    .sort((a, b) => b.overdueDays - a.overdueDays || a.question.createdAt - b.question.createdAt)
}

/** 队列角标：所有「今天到期 + 已逾期」的题数。 */
export function dueBadgeCount(questions: Question[], todayStr: string): number {
  return dueToday(questions, todayStr).length
}
