/**
 * decision.ts —— 报考/保弃决策看板（纯函数，固定模板文案，无 AI 生成）。
 * 只做「剩余天数 × 最近模考均分 vs 目标分」的保守提示，必须带免责声明。
 */
import { dayDiff, type MockExam, type Project } from './models'
import { examPercent } from './curve'

export type DecisionVerdict = 'unknown' | 'on-track' | 'risk' | 'far'

export interface DecisionResult {
  daysLeft: number
  avgPercent: number | null
  targetPercent: number
  verdict: DecisionVerdict
  lines: string[]
}

export const DECISION_DISCLAIMER =
  '本看板仅根据你自录的模考数据给出保守参考，不预测也不承诺通过率；是否报考请结合自身情况与官方考纲决定。'

export function buildDecision(project: Project, exams: MockExam[], todayStr: string): DecisionResult {
  const daysLeft = project.examDate ? dayDiff(todayStr, project.examDate) : 0
  const mine = exams.filter((e) => e.projectId === project.id)
  const percents = mine.map(examPercent)
  const avgPercent = percents.length ? percents.reduce((s, v) => s + v, 0) / percents.length : null
  const targetPercent = project.targetScore || 0

  const lines: string[] = []
  let verdict: DecisionVerdict = 'unknown'

  if (!mine.length) {
    lines.push(`还没有「${project.name}」的模考记录。先在「模考」里录入 1~2 次计时模考，这里才会给出参考。`)
    lines.push(DECISION_DISCLAIMER)
    return { daysLeft, avgPercent, targetPercent, verdict, lines }
  }

  const dateWord =
    daysLeft > 0 ? `距离考试还有 ${daysLeft} 天` : daysLeft === 0 ? '今天就是考试日' : `考试已结束（${-daysLeft} 天前）`

  if (avgPercent === null) {
    lines.push(dateWord)
    lines.push(DECISION_DISCLAIMER)
    return { daysLeft, avgPercent, targetPercent, verdict, lines }
  }

  const gap = avgPercent - targetPercent
  if (gap >= 0) {
    verdict = 'on-track'
    lines.push(`${dateWord}。最近 ${mine.length} 次模考平均约 ${avgPercent.toFixed(0)}%，已达到目标线 ${targetPercent}%，按当前节奏「今年报考、争取通过」较为稳妥。`)
  } else if (gap >= -15) {
    verdict = 'risk'
    lines.push(`${dateWord}。最近 ${mine.length} 次模考平均约 ${avgPercent.toFixed(0)}%，距目标线 ${targetPercent}% 还差 ${-gap.toFixed(0)} 个百分点，处于「有风险、但冲刺可追」区间——优先把弱项热力图里的红块考点刷掉。`)
  } else {
    verdict = 'far'
    lines.push(`${dateWord}。最近 ${mine.length} 次模考平均约 ${avgPercent.toFixed(0)}%，距目标线 ${targetPercent}% 差距较大（约 ${-gap.toFixed(0)} 分）。若时间紧，可保守考虑「今年保核心科目、其余次年再战」，避免多科全线摊薄。`)
  }
  lines.push(DECISION_DISCLAIMER)
  return { daysLeft, avgPercent, targetPercent, verdict, lines }
}
