/**
 * 纯规则训练计划生成（无 LLM、零后端）：按目标 / 器械 / 每周训练天数生成周课表。
 */

export type Goal = 'fatloss' | 'muscle' | 'posture'
export type Equipment = 'none' | 'dumbbell'

export interface PlanItem {
  exerciseId: string
  sets: number
  reps: string
}
export interface DayPlan {
  day: number // 1..7
  rest: boolean
  title: string
  items: PlanItem[]
}

interface GoalSpec {
  label: string
  pool: Array<{ exerciseId: string; sets: number; reps: (e: Equipment) => string }>
}

const GOALS: Record<Goal, GoalSpec> = {
  fatloss: {
    label: '减脂塑形',
    pool: [
      { exerciseId: 'squat', sets: 4, reps: () => '15' },
      { exerciseId: 'pushup', sets: 4, reps: () => '12' },
      { exerciseId: 'lunge', sets: 3, reps: () => '每侧 12' },
      { exerciseId: 'plank', sets: 3, reps: () => '40 秒' }
    ]
  },
  muscle: {
    label: '增肌力量',
    pool: [
      { exerciseId: 'squat', sets: 5, reps: () => '10' },
      { exerciseId: 'pushup', sets: 5, reps: () => '8-12' },
      { exerciseId: 'shoulderpress', sets: 4, reps: (e) => (e === 'dumbbell' ? '12（哑铃）' : '12') },
      { exerciseId: 'lunge', sets: 4, reps: () => '每侧 10' },
      { exerciseId: 'bridge', sets: 4, reps: () => '15' }
    ]
  },
  posture: {
    label: '体态矫正',
    pool: [
      { exerciseId: 'shoulderpress', sets: 3, reps: () => '15' },
      { exerciseId: 'plank', sets: 3, reps: () => '45 秒' },
      { exerciseId: 'bridge', sets: 3, reps: () => '15' },
      { exerciseId: 'pushup', sets: 3, reps: () => '10' }
    ]
  }
}

export const GOAL_LABELS: Record<Goal, string> = {
  fatloss: '减脂塑形',
  muscle: '增肌力量',
  posture: '体态矫正'
}

/**
 * @param goal 目标
 * @param equipment 器械（仅影响文案，动作均可用自重完成）
 * @param daysPerWeek 训练天数 2..6
 */
export function buildWeeklyPlan(goal: Goal, equipment: Equipment, daysPerWeek: number): DayPlan[] {
  const spec = GOALS[goal]
  const days = Math.max(2, Math.min(6, Math.round(daysPerWeek)))
  // 均匀分配训练日，其余休息
  const trainIdx = new Set<number>()
  for (let k = 0; k < days; k++) {
    trainIdx.add(1 + Math.round((k * 6) / Math.max(1, days - 1)))
  }
  const plan: DayPlan[] = []
  let ti = 0
  for (let d = 1; d <= 7; d++) {
    if (!trainIdx.has(d)) {
      plan.push({ day: d, rest: true, title: '休息 / 拉伸放松', items: [] })
      continue
    }
    // 每个训练日取 3 个动作，轮转覆盖动作池
    const items: PlanItem[] = []
    const take = Math.min(3, spec.pool.length)
    for (let n = 0; n < take; n++) {
      const p = spec.pool[(ti + n) % spec.pool.length]!
      items.push({ exerciseId: p.exerciseId, sets: p.sets, reps: p.reps(equipment) })
    }
    ti += take
    plan.push({ day: d, rest: false, title: `${spec.label}训练 ${plan.filter((x) => !x.rest).length + 1}`, items })
  }
  return plan
}
