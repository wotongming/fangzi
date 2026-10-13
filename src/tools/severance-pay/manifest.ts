import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'severance-pay',
  name: '离职补偿金计算器',
  tagline: '按劳动法计算协商解除/裁员的 N、N+1、2N 经济补偿金',
  category: 'compliance',
  type: 'web',
  targetUsers: ['劳动者', 'HR', '法务'],
  scenarios: ['被公司裁员或协商解除，想知道经济补偿怎么算', '公司只给 N，想确认自己是否应得 N+1 或 2N', '核对 HR 给的补偿金额是否合法'],
  painPoints: ['N、N+1、2N 的适用情形容易混淆', '社平工资三倍封顶、工龄不满一年的折算规则不清'],
  keywords: [
    '离职补偿',
    '经济补偿金',
    '裁员',
    '辞退',
    'N+1',
    '2N',
    '协商解除',
    '违法解除',
    '代通知金',
    '劳动法',
    '劳动合同法'
  ],
  billing: { mode: 'free' },
  createdAt: '2026-09-15',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
