import type { ToolManifest } from '@/core/types'

/** 免费层可建客户/欠款条数（含），超出需买断 */
export const FREE_INVOICE_LIMIT = 3

export const manifest: ToolManifest = {
  id: 'payment-chaser',
  name: '自由职业追款助手',
  tagline: '自由职业者/一人公司的应收台账：账龄看板、三档梯度催收话术、沟通留痕时间线，一键导出投诉/起诉证据包 PDF，全程只存本机',
  category: 'work',
  type: 'web',
  targetUsers: ['被客户拖欠尾款的设计师/程序员/翻译/摄影师', '一人公司/小微工作室', '不好意思催款、催了没留痕的自由职业者', '年底应收一堆、现金流紧张的人', '想走 2025 国家拖欠投诉平台却整理不出证据的人'],
  scenarios: [
    '项目交付后尾款拖了 30 天，想知道现在逾期多久、该说多重的话',
    '每次催款现找模板，想要按逾期天数自动给礼貌/正式/最后通牒三档文案',
    '催了几次微信/电话，需要按客户+项目留痕，将来投诉能拿出时间线',
    '对方一直拖，想导出一份事实清楚、金额和时间线齐全的证据包 PDF',
    '想看一眼现在外面一共压了多少钱、分别压了多少天'
  ],
  painPoints: [
    '催款不好意思开口，措辞太软被无视、太硬怕丢客户',
    '催了几次没有记录，真要投诉或起诉时拿不出完整证据链',
    '年底一看应收堆了一堆，现金流被卡死',
    '记账软件面向企业又重又贵，Excel 自己记没有梯度文案和留痕',
    '客户合同/对账/聊天记录散在微信邮箱，不愿上传到云端'
  ],
  keywords: [
    '追款',
    '催收',
    '尾款',
    '应收账款',
    '自由职业',
    ' freelancer ',
    '逾期',
    '账龄',
    '催收话术',
    '催款函',
    '证据包',
    '拖欠',
    '中小企业款项',
    '投诉平台',
    '12315',
    '一人公司',
    '对账',
    '现金流',
    'payment chaser',
    'invoice'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 1990,
    features: [
      { key: 'ledger-basic', label: `最多 ${FREE_INVOICE_LIMIT} 笔应收台账、账龄/现金流看板、梯度话术复制`, free: true },
      { key: 'unlimited', label: '不限客户/欠款笔数、批量导出 CSV/JSON', free: false },
      { key: 'evidence-pdf', label: '投诉/起诉证据包 PDF 导出（含金额、账龄、催收时间线）', free: false }
    ]
  },
  createdAt: '2026-10-22',
  updatedAt: '2026-10-22',
  version: '1.0.0',
  status: 'beta'
}
