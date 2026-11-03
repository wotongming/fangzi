import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'health-trend',
  name: '体检趋势',
  tagline: '历年体检趋势曲线，缓慢爬升预警，复查清单导出 PDF',
  category: 'life',
  type: 'web',
  targetUsers: ['30+ 关注健康的白领', '有慢病家族史人群', '体检报告压箱底人群'],
  scenarios: [
    '今年体检报告出来，想知道某指标比去年高了还是低了',
    '某个指标连续几年缓慢爬升，要不要复查',
    '去医院前把历年异常指标整理成一张复查清单'
  ],
  painPoints: [
    '报告压箱底，跨年对比靠记忆',
    '单个 ↑↓ 符号容易过度焦虑',
    '不知道哪些指标真的需要复查'
  ],
  keywords: ['体检', '体检报告', '健康趋势', '指标趋势', '复查', '慢病管理', '跨年对比', '本地', '不上传'],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1900,
    features: [
      { key: 'basic', label: '历年指标录入、趋势曲线、缓慢爬升预警、复查清单（免费）', free: true },
      { key: 'pro', label: 'PDF 导出、多人体检档案分组', free: false }
    ]
  },
  createdAt: '2026-11-03',
  updatedAt: '2026-11-03',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
