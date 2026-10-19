/**
 * weakness.ts —— 弱项热力聚合（纯函数）。
 * 按「科目::章节::考点」聚合：错题数、复习次数、最近正确率。
 * 正确率 = 记得次数 /（记得 + 已忘）；模糊不计入分子分母。
 * 色块：<50% 红 / 50%~70% 黄 / >70% 绿；还没有复习记录的考点为灰色（不算红黄绿）。
 */
import { pointKey, type Question, type ReviewLog } from './models'

export type WeakLevel = 'red' | 'yellow' | 'green' | 'none'

export interface WeaknessCell {
  key: string
  subject: string
  chapter: string
  point: string
  /** 该考点收录的错题数 */
  questionCount: number
  /** 累计复习次数（5/3/1 全部计入） */
  reviewCount: number
  /** 记得次数（grade 5） */
  hits: number
  /** 已忘次数（grade 1） */
  wrong: number
  /** 最近正确率 0~1；无对错记录时为 null */
  accuracy: number | null
  level: WeakLevel
}

export function levelOf(accuracy: number | null): WeakLevel {
  if (accuracy === null) return 'none'
  if (accuracy < 0.5) return 'red'
  if (accuracy <= 0.7) return 'yellow'
  return 'green'
}

/**
 * 聚合全部错题与其复习日志，输出按「最弱优先」排序的考点热力单元格。
 * 没有任何错题的考点不出现。
 */
export function analyzeWeakness(questions: Question[], reviews: ReviewLog[]): WeaknessCell[] {
  const map = new Map<string, WeaknessCell & { _h: number; _w: number; _r: number }>()

  for (const q of questions) {
    const key = pointKey(q.pointPath)
    let cell = map.get(key)
    if (!cell) {
      cell = {
        key,
        subject: q.pointPath.subject,
        chapter: q.pointPath.chapter,
        point: q.pointPath.point,
        questionCount: 0,
        reviewCount: 0,
        hits: 0,
        wrong: 0,
        accuracy: null,
        level: 'none',
        _h: 0,
        _w: 0,
        _r: 0
      }
      map.set(key, cell)
    }
    cell.questionCount += 1
  }

  for (const r of reviews) {
    // 找到该 review 对应的考点（通过 question）
    const q = questions.find((x) => x.id === r.questionId)
    if (!q) continue
    const key = pointKey(q.pointPath)
    const cell = map.get(key)
    if (!cell) continue
    cell._r += 1
    if (r.grade === 5) cell._h += 1
    else if (r.grade === 1) cell._w += 1
  }

  const cells: WeaknessCell[] = []
  for (const c of map.values()) {
    const decided = c._h + c._w
    const accuracy = decided > 0 ? c._h / decided : null
    cells.push({
      key: c.key,
      subject: c.subject,
      chapter: c.chapter,
      point: c.point,
      questionCount: c.questionCount,
      reviewCount: c._r,
      hits: c._h,
      wrong: c._w,
      accuracy,
      level: levelOf(accuracy)
    })
  }

  // 最弱优先：有正确率的按正确率升序；灰的（无复习）排后；同级再按错题数降序
  return cells.sort((a, b) => {
    const av = a.accuracy ?? 2
    const bv = b.accuracy ?? 2
    if (av !== bv) return av - bv
    return b.questionCount - a.questionCount
  })
}
