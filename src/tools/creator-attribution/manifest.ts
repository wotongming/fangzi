import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'creator-attribution',
  name: '创作归因台',
  tagline:
    '同时运营抖音/小红书/B站/公众号好几个号？把每周逐平台手抄的阅读、收益、工时录成本地台账，按主题/形式/平台/发布时段四维归因，告诉你下周该主攻什么、商单报多少',
  category: 'work',
  type: 'web',
  targetUsers: [
    '粉丝 5 千–50 万的独立内容创作者',
    '同时运营 3–5 个平台的自媒体人',
    '靠商单+分成吃饭、想复盘哪类内容最赚钱的人',
    '讨厌新榜/蚁小二那种年费数千、又重分发的矩阵工具的人',
    '数据只愿意存在自己电脑、不想上云的创作者'
  ],
  scenarios: [
    '每周日晚上，把这周各平台发的内容逐条记下来：标题、标签、形式、花了几小时',
    '发布 7 天/30 天后，回到内容下面补一次阅读量、涨粉、收益快照',
    '想知道到底是哪类主题、哪种形式、哪个平台、几点发布最赚钱',
    '品牌来问价，翻一翻最近 30 天已成交商单大概什么区间',
    '月底想导出一份收入构成 + TOP3 内容 + 下月选题策略的 Markdown 月报',
    '之前在 Excel/表格里记的历史数据，想批量 CSV 导入进来'
  ],
  painPoints: [
    '每周要逐平台后台手抄阅读/收益凑 Excel，花 1–3 小时还容易抄错',
    '数据散在各个平台后台，看不出哪类内容真正赚钱',
    '不知道该把下周时间押在哪个主题/平台/发布时段',
    '商单报价全凭感觉，没有自己历史成交价做参考',
    '企业级矩阵工具年费数千，对小创作者太重又只重分发',
    '内容数据隐私敏感，不想传到第三方 SaaS'
  ],
  keywords: [
    '内容复盘',
    '多平台数据',
    '收益归因',
    '自媒体',
    '创作者',
    '商单报价',
    'ROI',
    '公众号',
    '抖音',
    '小红书',
    'B站',
    '内容台账',
    '阅读量统计',
    '分成收益',
    '选题策略',
    '创作复盘',
    '数据回收',
    '工时统计',
    '变现复盘',
    '独立创作者'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1990,
    features: [
      { key: 'ledger-basic', label: '免费：最多 3 个账号 / 30 条内容台账 + 手动录入与数据回收', free: true },
      { key: 'unlimited-account', label: '专业版：账号与内容条数不限（免费 3 账号 / 30 条）', free: false },
      { key: 'csv-import', label: '专业版：CSV 批量导入历史内容台账', free: false },
      { key: 'attribution-board', label: '专业版：主题/形式/平台/时段四维归因看板', free: false },
      { key: 'deal-book', label: '专业版：品牌商单记录与近 30 天报价参考区间', free: false },
      { key: 'monthly-report', label: '专业版：月度经营报告 Markdown 导出', free: false }
    ],
    subscription: { priceCentsPerMonth: 300, priceCentsPerYear: 2990 }
  },
  createdAt: '2026-10-20',
  updatedAt: '2026-10-20',
  version: '1.0.0',
  status: 'beta'
}
