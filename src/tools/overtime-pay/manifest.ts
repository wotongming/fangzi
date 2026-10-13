import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'overtime-pay',
  name: '加班费计算器',
  tagline: '按工作日/休息日/法定节假日三档计算加班费',
  category: 'compliance',
  type: 'web',
  targetUsers: ['劳动者', 'HR', '排班管理人员'],
  scenarios: ['国庆/春节连续加班，算三薪两薪能拿多少', '核对公司加班费是否按 1.5/2/3 倍足额发放', '综合工时/标准工时下估算月度加班费'],
  painPoints: ['工作日 150%、休息日 200%、法定节假日 300% 容易记混', '计薪天数 21.75 与月计薪基数换算复杂'],
  keywords: ['加班费', '加班工资', '三倍工资', '节假日加班', '双休加班', '延时加班', '1.5倍', '2倍', '3倍', '21.75', '调休'],
  billing: { mode: 'free' },
  createdAt: '2026-09-10',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
