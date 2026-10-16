/**
 * 变现能力层：免费增值 / 买断 / 订阅 / 用量包 / 平台分成 五种模式统一落地。
 *
 * 免费层：单次 ≤50 万点、三种图型、缩放平移刷选、PNG 截图。
 * 专业能力（任一付费路径解锁）：>50 万点全量数据、刷选结果 CSV 导出、嵌入式组件代码。
 * 订单统一走 fangzi 计费框架（buyout / freemium-pro / usage-pack），离线可演示、可换远程网关。
 */
import type { BillingPlan } from '@/core/types'
import { billingProvider, type UsageInfo } from '@/core/billing'
import type { ToolBillingApi } from '@/composables/useToolBilling'
import { FREE_POINT_LIMIT } from './store'

export type PurchasePath = 'buyout' | 'subscription-month' | 'subscription-year' | 'usage-pack'

export interface AccessSummary {
  buyoutOwned: boolean
  proOwned: boolean
  usage: UsageInfo
  /** 专业能力当前是否可用 */
  unlocked: boolean
  /** 今日免费专业操作剩余（用量包口径） */
  freeRemainingToday: number
  freePointLimit: number
  prices: {
    buyout: number | undefined
    subscriptionMonth: number | undefined
    subscriptionYear: number | undefined
    usagePerUnit: number | undefined
  }
  split: { enabled: boolean; ratePct?: number; note?: string }
}

function buildUsagePlan(plan: BillingPlan): BillingPlan {
  return {
    mode: 'usage',
    currency: plan.currency ?? 'CNY',
    pricePerUnitCents: plan.usagePack?.priceCentsPerUnit ?? 129,
    unit: plan.usagePack?.unit ?? '次',
    freeQuotaPerCycle: plan.usagePack?.freePerDay ?? 0,
    quotaCycle: 'day'
  }
}

export function buildAccessSummary(billing: ToolBillingApi, plan: BillingPlan, toolId: string): AccessSummary {
  const provider = billingProvider()
  const usagePlan = buildUsagePlan(plan)
  const buyoutOwned = billing.isOwned('buyout')
  const proOwned = billing.isOwned('freemium-pro')
  const usage = provider.getUsage(usagePlan, toolId)
  const unlocked = buyoutOwned || proOwned || usage.remaining > 0
  return {
    buyoutOwned,
    proOwned,
    usage,
    unlocked,
    freeRemainingToday: Math.max(0, (usagePlan.freeQuotaPerCycle ?? 0) - usage.used),
    freePointLimit: FREE_POINT_LIMIT,
    prices: {
      buyout: plan.priceCents,
      subscriptionMonth: plan.subscription?.priceCentsPerMonth,
      subscriptionYear: plan.subscription?.priceCentsPerYear,
      usagePerUnit: plan.usagePack?.priceCentsPerUnit
    },
    split: {
      enabled: Boolean(plan.platformSplit?.enabled),
      ratePct: plan.platformSplit?.partnerRatePct,
      note: plan.platformSplit?.note
    }
  }
}

/** 扣减一次专业操作用量（仅未持有买断/订阅时生效） */
export function consumeIfNeeded(summary: AccessSummary, toolId: string, plan: BillingPlan): void {
  if (summary.buyoutOwned || summary.proOwned) return
  billingProvider().consume(toolId, buildUsagePlan(plan), 1)
}

/** 记录付费订单（本地演示支付；正式环境由 RemoteBillingProvider 对接真实网关） */
export async function purchase(billing: ToolBillingApi, path: PurchasePath): Promise<void> {
  switch (path) {
    case 'buyout':
      await billing.buy('buyout')
      break
    case 'subscription-month':
    case 'subscription-year':
      await billing.buy('freemium-pro')
      break
    case 'usage-pack':
      await billing.buy('usage-pack', 50)
      break
  }
}
