import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'year-bonus-tax',
  name: '年终奖个税筹划器',
  tagline: '对比年终奖“单独计税”与“并入综合所得”两种方式，立刻看清哪种更省税',
  category: 'life',
  type: 'web',
  targetUsers: ['上班族', '财务 HR', '拿到年终奖的员工'],
  scenarios: [
    '年终奖发了，纠结单独计税还是并入工资更划算',
    '想提前算清年终奖到手多少钱、扣多少税',
    'HR 发年终奖前帮员工测算最优计税方式'
  ],
  painPoints: ['年终奖两种计税方式规则复杂，自己算容易错', '选错计税方式可能多缴上千元税'],
  keywords: [
    '年终奖',
    '全年一次性奖金',
    '个税',
    '个人所得税',
    '单独计税',
    '并入综合所得',
    '省税',
    '到手工资',
    '奖金税',
    'tax'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1990,
    features: [
      { key: 'compare', label: '两种计税方式对比', free: true },
      { key: 'batch', label: '批量测算与结果导出', free: false }
    ]
  },
  createdAt: '2026-09-20',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
