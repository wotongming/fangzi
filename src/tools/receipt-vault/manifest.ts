import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'receipt-vault',
  name: '小票本',
  tagline: '拍照小票/发票本地 OCR 抽字段（商家/日期/金额/税额），按项目挂账、可校对、导出 CSV 报税，图片不上传',
  category: 'life',
  type: 'web',
  targetUsers: ['自由职业者', '个体户', 'HR/行政报销', '咨询顾问', '财税小白'],
  scenarios: [
    '报税季把一摞餐饮/交通小票拍成照片，本地 OCR 成结构化记录',
    '按差旅/餐饮/办公项目挂账，月底导出 CSV 报销',
    '合同/发票图片敏感，不能上传云端识别'
  ],
  painPoints: [
    '手工录入小票费时易错',
    '云端 OCR 要把发票上传第三方，隐私/合规不允许',
    '报销前要按项目/月份手工汇总'
  ],
  keywords: ['小票', '发票', 'OCR', '报销', '报税', '记账', '金额识别', '本地OCR', '不上传', 'CSV导出', '收据'],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 4900,
    features: [
      { key: 'basic', label: '每月 20 张、字段抽取、按项目挂账、CSV 导出', free: true },
      { key: 'pro', label: '无限张数、多项目汇总表、年度报税导出', free: false }
    ]
  },
  createdAt: '2026-10-21',
  updatedAt: '2026-10-21',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
