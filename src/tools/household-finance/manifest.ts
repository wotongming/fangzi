import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'household-finance',
  name: '家庭财务管家',
  tagline: '记账、预算、报表、省钱洞察一条龙，微信支付宝花的钱都拢进一个家庭账本',
  category: 'life',
  type: 'web',
  targetUsers: ['家庭主理人', '双职工家庭', '想理财的年轻人', '经常用微信支付宝付款的人'],
  scenarios: [
    '微信支付宝花了钱，想随手记一笔、月底知道钱花哪了',
    '每月想设个家庭预算，防止超支',
    '年底想复盘全年收支结构',
    '想知道哪类支出占比最高、可以砍一砍',
    '家庭账本想多平台聚合，不再东记一笔西记一笔'
  ],
  painPoints: ['支付分散在微信/支付宝/银行卡，账目难聚合', '记账麻烦坚持不下来', '只有流水没有预算、报表和洞察', '不知道钱花哪了、哪类支出可优化'],
  keywords: [
    '记账',
    '家庭账本',
    '家庭财务',
    '收支',
    '账本',
    '预算',
    '超支',
    '流水',
    '财务报表',
    '月度报表',
    '年度盘点',
    '支出分析',
    '省钱',
    '理财',
    '微信',
    '支付宝',
    '花销',
    '钱花哪了',
    '分类账',
    'budget',
    'expense',
    'ledger',
    '家庭记账'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 2990,
    features: [
      { key: 'basic', label: '记账、分类与看板', free: true },
      { key: 'budget', label: '预算与超支预警', free: true },
      { key: 'report', label: '高级报表与趋势', free: false },
      { key: 'insight', label: '省钱洞察', free: false },
      { key: 'sync', label: '加密备份与云同步', free: false }
    ]
  },
  createdAt: '2026-10-14',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'beta'
}
