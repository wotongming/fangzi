import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, dayDiff, dayMs, type MockExam, type PointPath, type Question, type ReviewLog } from '../src/tools/exam-review-scheduler/lib/models'
import { initialSchedule, scheduleNext, STEPS } from '../src/tools/exam-review-scheduler/lib/scheduler'
import { dueToday } from '../src/tools/exam-review-scheduler/lib/queue'
import { analyzeWeakness, levelOf } from '../src/tools/exam-review-scheduler/lib/weakness'
import { buildCurve, examPercent } from '../src/tools/exam-review-scheduler/lib/curve'
import { buildDecision, DECISION_DISCLAIMER } from '../src/tools/exam-review-scheduler/lib/decision'

const TODAY = '2026-10-20'

function q(over: Partial<Question> & Pick<Question, 'id' | 'nextReview'>): Question {
  return {
    projectId: 'p1',
    stem: '题干',
    wrongCause: '',
    answer: '',
    source: '',
    pointPath: { subject: '会计', chapter: '总论', point: '存货' },
    ease: 2.5,
    intervalDays: 1,
    reps: 0,
    createdAt: 1,
    ...over
  }
}

// —— 日期纯函数（本地日历日，不漂） ——
test('addDays 跨月/跨年/闰年安全', () => {
  assert.equal(addDays('2026-10-20', 1), '2026-10-21')
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-02-27', 2), '2026-03-01') // 2026 非闰年
  assert.equal(addDays('2024-02-27', 2), '2024-02-29') // 2024 闰年
})

test('dayDiff 为本地日历整数天差，dayMs 为当地零点', () => {
  assert.equal(dayDiff('2026-10-18', '2026-10-20'), 2)
  assert.equal(dayMs('2026-10-20'), new Date(2026, 9, 20).getTime())
})

// —— 调度引擎 ——
test('新题初始调度：明天到期、间隔 1 天、ease 2.5', () => {
  const s = initialSchedule(TODAY)
  assert.equal(s.intervalDays, STEPS[0])
  assert.equal(s.reps, 0)
  assert.equal(s.ease, 2.5)
  assert.equal(s.nextReview, addDays(TODAY, 1))
})

test('连续“记得”：间隔按 [1,2,4,7,15×ease] 递进', () => {
  let st = { ease: 2.5, intervalDays: 1, reps: 0 }
  const r1 = scheduleNext(st, 5, TODAY)
  assert.equal(r1.intervalDays, 1)
  assert.equal(r1.reps, 1)
  assert.equal(r1.ease, 2.65)
  st = r1
  assert.equal(scheduleNext(st, 5, TODAY).intervalDays, 2)
  st = scheduleNext(st, 5, TODAY)
  assert.equal(scheduleNext(st, 5, TODAY).intervalDays, 4)
  st = scheduleNext(st, 5, TODAY)
  assert.equal(scheduleNext(st, 5, TODAY).intervalDays, 7)
})

test('第 5 次记得：用上一次 ease 与 1.3 倍率滚动增长', () => {
  // 前 4 次记得后 ease = 2.5 + 4*0.15 = 3.1
  const st = { ease: 3.1, intervalDays: 7, reps: 4 }
  const r = scheduleNext(st, 5, TODAY)
  assert.equal(r.reps, 5)
  assert.equal(r.intervalDays, Math.round(15 * 3.1 * 1.3))
  assert.equal(r.nextReview, addDays(TODAY, r.intervalDays))
})

test('“已忘”：reps 归零、间隔重置为 1 天、ease -0.2', () => {
  const r = scheduleNext({ ease: 2.5, intervalDays: 7, reps: 4 }, 1, TODAY)
  assert.equal(r.reps, 0)
  assert.equal(r.intervalDays, 1)
  assert.equal(r.ease, 2.3)
  assert.equal(r.nextReview, addDays(TODAY, 1))
})

test('ease 下限 1.3，多次已忘不再下探', () => {
  const r = scheduleNext({ ease: 1.35, intervalDays: 1, reps: 0 }, 1, TODAY)
  assert.equal(r.ease, 1.3)
})

test('“模糊”：reps 仍 +1，ease -0.1，间隔按 reps 落基准表', () => {
  const r = scheduleNext({ ease: 2.5, intervalDays: 1, reps: 0 }, 3, TODAY)
  assert.equal(r.reps, 1)
  assert.equal(r.intervalDays, 1)
  assert.equal(r.ease, 2.4)
})

// —— 今日队列 ——
test('队列：筛 nextReview<=今天，按逾期天数降序', () => {
  const a = q({ id: 'a', nextReview: '2026-10-18', createdAt: 1 })
  const b = q({ id: 'b', nextReview: TODAY, createdAt: 2 })
  const c = q({ id: 'c', nextReview: '2026-10-25', createdAt: 3 })
  const due = dueToday([a, b, c], TODAY)
  assert.equal(due.length, 2)
  assert.equal(due[0]!.question.id, 'a') // 逾期 2 天最久在前
  assert.equal(due[1]!.question.id, 'b') // 今天到期
  assert.equal(due[0]!.overdueDays, 2)
  assert.equal(due[1]!.today, true)
})

// —— 弱项聚合 ——
test('levelOf 阈值：<50% 红 / 50~70% 黄 / >70% 绿 / 无记录灰', () => {
  assert.equal(levelOf(0.4), 'red')
  assert.equal(levelOf(0.5), 'yellow')
  assert.equal(levelOf(0.7), 'yellow')
  assert.equal(levelOf(0.8), 'green')
  assert.equal(levelOf(null), 'none')
})

test('弱项聚合：红块与正确率一致，空考点不出现，最弱优先排序', () => {
  const stock: PointPath = { subject: '会计', chapter: '总论', point: '存货' }
  const fa: PointPath = { subject: '会计', chapter: '固定资产', point: '折旧' }
  const q1 = q({ id: 'q1', nextReview: TODAY, pointPath: stock })
  const q2 = q({ id: 'q2', nextReview: TODAY, pointPath: stock })
  const q3 = q({ id: 'q3', nextReview: TODAY, pointPath: fa })
  const reviews: ReviewLog[] = [
    { id: 'r1', questionId: 'q1', ts: 1, grade: 1, intervalAfter: 1 },
    { id: 'r2', questionId: 'q1', ts: 2, grade: 1, intervalAfter: 1 },
    { id: 'r3', questionId: 'q2', ts: 3, grade: 1, intervalAfter: 1 },
    { id: 'r4', questionId: 'q3', ts: 4, grade: 5, intervalAfter: 2 },
    { id: 'r5', questionId: 'q3', ts: 5, grade: 5, intervalAfter: 4 }
  ]
  const cells = analyzeWeakness([q1, q2, q3], reviews)
  assert.equal(cells.length, 2) // 空考点不出现
  const stockCell = cells.find((c) => c.point === '存货')!
  assert.equal(stockCell.questionCount, 2)
  assert.equal(stockCell.reviewCount, 3)
  assert.equal(stockCell.accuracy, 0)
  assert.equal(stockCell.level, 'red')
  assert.equal(cells[0]!.point, '存货') // 正确率 0 排最前
  const faCell = cells.find((c) => c.point === '折旧')!
  assert.equal(faCell.accuracy, 1)
  assert.equal(faCell.level, 'green')
})

test('模糊(grade3)不计入正确率分子分母，未产生对错记录为灰色', () => {
  const q1 = q({ id: 'q1', nextReview: TODAY, pointPath: { subject: 's', chapter: 'c', point: 'p' } })
  const cells = analyzeWeakness([q1], [{ id: 'r', questionId: 'q1', ts: 1, grade: 3, intervalAfter: 1 }])
  assert.equal(cells[0]!.accuracy, null)
  assert.equal(cells[0]!.level, 'none')
})

// —— 模考曲线 ——
test('examPercent 与 buildCurve：百分制、趋势、目标线', () => {
  const exams: MockExam[] = [
    { id: 'm1', projectId: 'p1', date: '2026-09-01', subject: '会计', score: 60, fullScore: 100, minutes: 180, createdAt: 1 },
    { id: 'm2', projectId: 'p1', date: '2026-10-01', subject: '会计', score: 80, fullScore: 100, minutes: 180, createdAt: 2 }
  ]
  assert.equal(examPercent(exams[0]!), 60)
  const g = buildCurve(exams, 70)
  assert.equal(g.points.length, 2)
  assert.equal(g.trend, 20)
  assert.equal(g.avg, 70)
  assert.ok(g.targetY !== null)
})

test('单次模考 trend 为 null，目标分<=0 不画参考线', () => {
  const one: MockExam[] = [{ id: 'm1', projectId: 'p1', date: '2026-10-01', subject: '会计', score: 60, fullScore: 100, minutes: 0, createdAt: 1 }]
  const g = buildCurve(one, 0)
  assert.equal(g.trend, null)
  assert.equal(g.targetY, null)
})

// —— 决策看板 ——
const proj = { id: 'p1', name: 'CPA-会计', examDate: '2026-12-31', targetScore: 60, createdAt: 1, tags: [] }

test('无模考记录：引导先录，且必带免责', () => {
  const r = buildDecision(proj, [], TODAY)
  assert.match(r.lines.join(''), /还没有/)
  assert.match(r.lines.join(''), new RegExp(DECISION_DISCLAIMER.slice(0, 12)))
})

test('模考均分达标 → on-track；远低于目标 → far 且带免责', () => {
  const good: MockExam[] = [
    { id: 'm1', projectId: 'p1', date: '2026-09-01', subject: '会计', score: 80, fullScore: 100, minutes: 180, createdAt: 1 },
    { id: 'm2', projectId: 'p1', date: '2026-10-01', subject: '会计', score: 82, fullScore: 100, minutes: 180, createdAt: 2 }
  ]
  const r1 = buildDecision(proj, good, TODAY)
  assert.equal(r1.verdict, 'on-track')
  assert.ok(r1.daysLeft > 0)

  const bad: MockExam[] = [
    { id: 'm3', projectId: 'p1', date: '2026-10-01', subject: '会计', score: 35, fullScore: 100, minutes: 180, createdAt: 3 }
  ]
  const r2 = buildDecision(proj, bad, TODAY)
  assert.equal(r2.verdict, 'far')
  assert.match(r2.lines.join(''), /仅供参考|不承诺通过率/)
})
