import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'batch-text-processor',
  name: '批量文本处理工坊',
  tagline: '上万行文本批量去重、编号、排序、过滤、大小写与分隔符转换',
  category: 'work',
  type: 'web',
  targetUsers: ['运营', '数据处理人员', '客服', '行政'],
  scenarios: ['上万行手机号/名单需要去重并自动编号', '把一列文本批量加前缀后缀、转换大小写', '按规则过滤空行、注释行或包含关键字的行'],
  painPoints: ['用 Excel 处理纯文本列表步骤繁琐', '手动去重排序上万行极易出错且耗时'],
  keywords: ['批量处理', '文本', '去重', '编号', '排序', '过滤', '大小写转换', '名单', '前缀后缀', '分隔符', 'split', 'trim'],
  billing: {
    mode: 'usage',
    currency: 'CNY',
    pricePerUnitCents: 10,
    unit: '次',
    freeQuotaPerCycle: 20,
    quotaCycle: 'month'
  },
  createdAt: '2026-10-02',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'stable'
}
