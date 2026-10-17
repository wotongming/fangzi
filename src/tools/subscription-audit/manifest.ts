import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'subscription-audit',
  name: '账单订阅盘点与自动续费预警',
  tagline: '导入微信/支付宝官方账单 CSV，本机自动识别月付/年付订阅，算清一年花多少、哪些闲置重复涨价，给官方解约入口并生成扣费日历提醒，账单全程不上传',
  category: 'life',
  type: 'web',
  targetUsers: ['订阅多的年轻人', '数字内容/工具重度消费者', '家庭财务管理者', '学生与上班族', '想关掉自动续费省钱的人', '首月优惠试用开通过一堆会员的人'],
  scenarios: [
    '年底发现视频/音乐/网盘/健身会员白交了很多钱，想一次性盘点自己在为哪些自动续费付钱',
    '从微信和支付宝导出账单，自动找出周期性扣费并算出每个订阅一年、三年花多少',
    '识别多个同类视频会员、涨价订阅、疑似长期没用却还在扣费的服务，决定保留还是取消',
    '试用/首月优惠即将转正，想在下次扣费前收到提醒，及时关闭',
    '需要微信/支付宝关闭免密自动扣款的准确入口，并把续费提醒加到手机系统日历'
  ],
  painPoints: [
    '自动续费分散在微信、支付宝两个入口，平时无感、逐个翻查麻烦，忘关一年白交几百上千元',
    '通用记账 App 要长期逐笔手动记，门槛高、坚持不下来',
    '把财务账单传到在线工具不放心，担心泄露收入与消费',
    '只知道在扣钱，却不清楚下次什么时候扣、总共扣了多少、哪些其实已经不用',
    '“首月1元”试用到期悄悄转正，缺少扣费前提醒'
  ],
  keywords: [
    '自动续费', '自动扣款', '免密支付', '关闭续费', '忘记取消', '订阅盘点', '订阅扣费', '会员续费',
    '微信账单', '支付宝账单', '账单csv', '账单分析', '周期性扣费', '重复会员', '闲置会员', '涨价',
    '省钱', '退订', '解约', '续费提醒', '扣费提醒', '一年花多少', '视频会员', '网盘会员', '首月优惠',
    'subscription', 'recurring', 'cancel subscription', '本地处理', '不上传'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 990,
    features: [
      { key: 'basic', label: '单份账单、基础订阅识别与年度总览', free: true },
      { key: 'multi-account', label: '多月/多份/多账户合并去重与趋势', free: false },
      { key: 'insights', label: '闲置/重复/涨价/试用转正智能判定与手动纠错', free: false },
      { key: 'remind-export', label: '扣费日历提醒(.ics)、退订待办与报告导出', free: false }
    ],
    subscription: { priceCentsPerMonth: 400, priceCentsPerYear: 3000 }
  },
  createdAt: '2026-10-17',
  updatedAt: '2026-10-17',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
