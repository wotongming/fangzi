/**
 * 工具接入计费的统一入口（声明式、响应式）。
 *
 * 网页工具内：
 *   const billing = useToolBilling(manifest.id)
 *   billing.canUse('pro')          // 判定权限 / 额度
 *   await billing.buy()            // 拉起支付
 *   billing.consume()              // usage 模式扣减一次额度
 *
 * billingVersion 在权益/用量变化时自增，工具可 watch 它刷新界面。
 */
import { ref } from 'vue'
import { getTool } from '../core/registry'
import { billingProvider, type AccessDecision, type Order, type OrderKind, type UsageInfo } from '../core/billing'
import { formatPrice } from '../core/constants'
import type { BillingPlan } from '../core/types'

export interface ToolBillingApi {
  plan: BillingPlan
  currency: 'CNY' | 'USD'
  isFree: boolean
  /** 权益/用量版本号，变化时界面需重新读取 canUse/usage */
  billingVersion: ReturnType<typeof ref<number>>
  canUse: (featureKey?: string) => AccessDecision
  usage: () => UsageInfo | null
  priceText: (cents?: number) => string
  buy: (kind?: OrderKind, units?: number) => Promise<Order>
  consume: (amount?: number) => void
}

export function useToolBilling(toolId: string): ToolBillingApi {
  const registered = getTool(toolId)
  if (!registered) throw new Error(`useToolBilling：未注册工具 ${toolId}`)
  const plan = registered.manifest.billing
  const currency = plan.currency ?? 'CNY'
  const provider = billingProvider()
  const billingVersion = ref(0)
  provider.on('change', () => {
    billingVersion.value++
  })

  const buy = (kind?: OrderKind, units?: number): Promise<Order> => {
    const resolvedKind: OrderKind =
      kind ?? (plan.mode === 'buyout' ? 'buyout' : plan.mode === 'usage' ? 'usage-pack' : 'freemium-pro')
    const amount =
      resolvedKind === 'usage-pack'
        ? (plan.pricePerUnitCents ?? 0) * (units ?? 1)
        : (plan.priceCents ?? 0)
    return provider.checkout({
      toolId,
      kind: resolvedKind,
      amountCents: amount,
      currency,
      units: resolvedKind === 'usage-pack' ? units ?? 1 : undefined
    })
  }

  return {
    plan,
    currency,
    isFree: plan.mode === 'free',
    billingVersion,
    // 读取 billingVersion 建立响应式依赖：权益/用量变化自增版本号时，
    // 在 computed / 模板渲染期间调用 canUse/usage 会自动重算刷新。
    canUse: (featureKey?: string) => {
      void billingVersion.value
      return provider.canUse(plan, toolId, featureKey)
    },
    usage: () => {
      void billingVersion.value
      return plan.mode === 'usage' ? provider.getUsage(plan, toolId) : null
    },
    priceText: (cents?: number) => formatPrice(cents, currency),
    buy,
    consume: (amount = 1) => provider.consume(toolId, plan, amount)
  }
}
