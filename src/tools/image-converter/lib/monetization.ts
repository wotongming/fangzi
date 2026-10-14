/**
 * 变现能力层：把「免费增值 / 买断 / 按量 / 订阅 / 平台分成」五种模式统一落地。
 * 判定规则：
 *   - 基础转换：始终免费（freemium 免费层）
 *   - AI 增强 / 批量：需满足任一 —— 买断订单 / 订阅订单(freemium-pro) / 用量包+每日免费额度剩余
 * 订单统一走 fangzi 计费框架（buyout / freemium-pro / usage-pack 三种 kind），可离线演示、可换远程网关。
 */
import type { BillingPlan } from '@/core/types'
import { billingProvider, type UsageInfo } from '@/core/billing'
import type { ToolBillingApi } from '@/composables/useToolBilling'

export type PurchasePath = 'buyout' | 'subscription-month' | 'subscription-year' | 'usage-pack'

export interface AccessSummary {
  buyoutOwned: boolean
  proOwned: boolean
  usage: UsageInfo
  /** AI/批量当前是否可用 */
  unlocked: boolean
  /** 今日免费剩余（用量包口径） */
  freeRemainingToday: number
  /** 各付费路径价格（分） */
  prices: {
    buyout: number | undefined
    subscriptionMonth: number | undefined
    subscriptionYear: number | undefined
    usagePerUnit: number | undefined
  }
  /** 平台分成配置 */
  split: { enabled: boolean; ratePct?: number; note?: string }
}

/** 由 manifest 的 usagePack 派生「每日免费+用量包」合成计划，交给计费框架统计/扣减 */
function buildUsagePlan(plan: BillingPlan): BillingPlan {
  return {
    mode: 'usage',
    currency: plan.currency ?? 'CNY',
    pricePerUnitCents: plan.usagePack?.priceCentsPerUnit ?? 990,
    unit: plan.usagePack?.unit ?? '张',
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

/** 扣减一次 AI/批量用量（仅当未持有买断/订阅时生效） */
export function consumeIfNeeded(summary: AccessSummary, toolId: string, plan: BillingPlan): void {
  if (summary.buyoutOwned || summary.proOwned) return
  const provider = billingProvider()
  provider.consume(toolId, buildUsagePlan(plan), 1)
}

/** 记录付费订单（本地演示支付；正式环境由 RemoteBillingProvider 对接真实网关） */
export async function purchase(billing: ToolBillingApi, path: PurchasePath): Promise<void> {
  switch (path) {
    case 'buyout':
      await billing.buy('buyout')
      break
    case 'subscription-month':
    case 'subscription-year':
      // 订阅订单走 freemium-pro kind（周期续费由真实网关/后端实现，本地记录订阅权益）
      await billing.buy('freemium-pro')
      break
    case 'usage-pack':
      await billing.buy('usage-pack', 100)
      break
  }
}
