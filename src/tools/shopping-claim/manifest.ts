import type { ToolManifest } from '@/core/types'

/** 免费层可建案件数（含），超出需专业版 */
export const FREE_CASE_LIMIT = 2

export const manifest: ToolManifest = {
  id: 'shopping-claim',
  name: '网购三包·退换货维权管家',
  tagline: '按品类自动算 7 天无理由/15 日换货/三包/保修/价保时效，证据随拍固化、一键生成协商与 12315 文本，全程只存本机',
  category: 'life',
  type: 'web',
  targetUsers: ['经常网购家电 3C 家具母婴的消费者', '不清楚还在不在退换时效内的人', '证据散落各 App、事后说不清的人', '不会写投诉、怕错过 7 天/15 天/三包节点的人', '帮父母处理网购售后的子女'],
  scenarios: [
    '网购大家电/数码出问题，想知道现在还能不能退、换、修，今天该做什么',
    '和商家协商前，想把订单、聊天、物流、商品瑕疵照片按顺序固化成证据包',
    '超过七天商家就不理，想确认质量问题其实不受 7 天无理由期限限制并生成说法',
    '需要申请平台介入或拨打 12315，想快速得到一份事实清楚、诉求明确、可自行修改的文本',
    '想跟踪从取证、协商、平台介入到 12315 的进度，并记录最终挽回了多少钱'
  ],
  painPoints: [
    '不知道退换货/三包/保修/价保各自的时效，容易错过窗口',
    '证据散落在不同 App，事后被商家带节奏、自证困难',
    '不会组织语言和诉求，协商、平台介入、12315 不知道怎么写',
    '以为拆封就不能退、过了 7 天就没辙，被常见借口劝退',
    '不愿意把订单、地址、聊天等敏感维权材料上传到云端'
  ],
  keywords: [
    '七天无理由',
    '7天无理由退货',
    '三包',
    '退换货',
    '退货',
    '换货',
    '退款',
    '保修期',
    '价保',
    '退差价',
    '维权',
    '消费者权益',
    '12315',
    '平台介入',
    '质量问题',
    '性能故障',
    '发错货',
    '证据',
    '购物售后',
    '消法第二十五条',
    '消法第二十四条',
    '网购维权',
    'shopping claim'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 990,
    features: [
      { key: 'basic', label: `最多 ${FREE_CASE_LIMIT} 个案件、时效看板与规则速查`, free: true },
      { key: 'multi', label: '多商品长期跟踪（不限案件数、保修长期提醒）', free: false },
      { key: 'letters', label: '协商话术 / 平台介入 / 12315 全套文书', free: false },
      { key: 'export', label: '证据包 ZIP 导出与日历（.ics）提醒', free: false }
    ],
    subscription: { priceCentsPerMonth: 290, priceCentsPerYear: 2990 }
  },
  createdAt: '2026-10-18',
  updatedAt: '2026-10-18',
  version: '1.0.0',
  status: 'beta'
}
