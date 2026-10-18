import type { ToolManifest } from '@/core/types'

/** 免费层可管理卡数（含），超出需专业版 */
export const FREE_CARD_LIMIT = 2

export const manifest: ToolManifest = {
  id: 'card-billing',
  name: '多卡还款日·免息期管家',
  tagline: '集中管理多张信用卡账单日/还款日，倒计时防逾期，输入消费日推荐免息最长的卡，追踪年费刷免，零授权、不碰资金、全程只存本机',
  category: 'life',
  type: 'web',
  targetUsers: ['持有两张以上信用卡的人', '想用足最长免息期的人', '担心漏还导致罚息与征信受损的人', '怕年费刷免笔数不够被扣年费的人', '不愿把银行卡授权给第三方聚合 App 的谨慎用户'],
  scenarios: [
    '各卡账单日还款日分散，想在一屏看清最近该还哪张、还剩几天',
    '大额消费前，想知道今天刷哪张卡免息期最长',
    '想确认某张卡年费刷几笔能免，还差几笔',
    '想了解只还最低还款或分期大概会产生多少利息',
    '不想绑卡授权，只用本地日历/通知获得还款提醒'
  ],
  painPoints: [
    '账单日不统一、还款日各不同，靠记忆容易漏还，产生罚息违约金并影响征信',
    '不知道一笔消费刷哪张卡能享最长免息期',
    '年费减免需刷满笔数或金额，容易忘被扣年费',
    '聚合 App 要绑卡授权、读取账单，担心隐私与资金安全',
    '各银行 App 各管各卡，跨卡对账繁琐'
  ],
  keywords: [
    '信用卡',
    '还款日',
    '账单日',
    '免息期',
    '最长免息',
    '多卡管理',
    '还款提醒',
    '逾期',
    '罚息',
    '违约金',
    '征信',
    '年费',
    '刷免年费',
    '最低还款',
    '分期',
    '信用卡还款',
    '账单周期',
    '选卡',
    'credit card billing'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 890,
    features: [
      { key: 'basic', label: `最多 ${FREE_CARD_LIMIT} 张卡、还款日倒计时与还款标记`, free: true },
      { key: 'multi', label: '不限卡数，多张信用卡长期统一管理', free: false },
      { key: 'picker', label: '免息期选卡器：消费日推荐免息最长的卡', free: false },
      { key: 'fee', label: '年费刷免追踪与利息/违约金测算、日历提醒导出', free: false }
    ],
    subscription: { priceCentsPerMonth: 260, priceCentsPerYear: 2600 }
  },
  createdAt: '2026-10-19',
  updatedAt: '2026-10-19',
  version: '1.0.0',
  status: 'beta'
}
