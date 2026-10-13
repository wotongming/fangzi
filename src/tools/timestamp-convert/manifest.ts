import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'timestamp-convert',
  name: '时间戳转换工具',
  tagline: '秒/毫秒 Unix 时间戳与北京时间互转，支持批量与相对时间',
  category: 'developer',
  type: 'web',
  targetUsers: ['开发者', '测试', '数据分析'],
  scenarios: ['日志里的 1728000000 不知道对应几号', '把日期时间快速转成秒或毫秒时间戳', '批量转换一列时间戳排查数据问题'],
  painPoints: ['秒与毫秒差 1000 倍经常搞反', 'UTC 与北京时间时区换算容易错 8 小时'],
  keywords: ['时间戳', 'timestamp', 'unix', '毫秒', '秒', '北京时间', '时区', 'utc', '日期转换', 'epoch', '日志时间'],
  billing: { mode: 'free' },
  createdAt: '2026-10-05',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
