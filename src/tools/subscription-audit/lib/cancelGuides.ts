/**
 * cancelGuides.ts —— 两平台“关闭自动续费/免密支付”的官方操作路径（仅指路，不代操作）。
 * 链接只放稳定的官方帮助中心入口，避免失效深链。
 */
import type { Platform } from './platforms'

export interface CancelGuide {
  platform: Exclude<Platform, 'unknown'>
  label: string
  steps: string[]
  helpUrl: string
  helpLabel: string
}

export const CANCEL_GUIDES: CancelGuide[] = [
  {
    platform: 'wechat',
    label: '微信支付',
    steps: [
      '打开微信 → 我 → 服务',
      '进入「钱包」→ 点「支付设置」',
      '分别查看「自动续费」「免密支付」两个列表',
      '对不再使用的服务点进去 →「关闭扣费服务」'
    ],
    helpUrl: 'https://kf.qq.com/product/wechatpay.html',
    helpLabel: '微信支付官方帮助中心'
  },
  {
    platform: 'alipay',
    label: '支付宝',
    steps: [
      '打开支付宝 → 我的 → 右上角「设置」',
      '进入「支付设置」',
      '查看「免密支付 / 自动扣款」列表',
      '对不再使用的服务点进去 →「关闭服务」'
    ],
    helpUrl: 'https://cschannel.alipay.com/mobile/helpDetail.htm?help_id=201602052261',
    helpLabel: '支付宝服务中心：免密支付/自动扣款解约说明'
  }
]

export function guideFor(p: Platform): CancelGuide | undefined {
  return CANCEL_GUIDES.find((g) => g.platform === p)
}
