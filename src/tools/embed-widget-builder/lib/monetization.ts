/**
 * embed-widget-builder 变现层（主方案：freemium + 买断专业版 ¥39.90）。
 * 免费：3 类基础模板、最多 3 个本地组件、实时预览、导出脚本、保留角标。
 * 专业版（一次买断 freemium-pro）：进阶模板、不限组件、去角标/品牌定制、CSV 数据导出。
 */
import type { ToolBillingApi } from '@/composables/useToolBilling'

export const FREE_INSTANCE_LIMIT = 3

export interface EmAccess {
  pro: boolean
  priceText: string
}

export function buildAccess(billing: ToolBillingApi): EmAccess {
  const pro = billing.isOwned('freemium-pro') || billing.isOwned('buyout')
  return { pro, priceText: billing.priceText(billing.plan.priceCents) }
}

/** freemium 模式下默认走 freemium-pro，金额取 manifest.priceCents（买断价） */
export async function upgrade(billing: ToolBillingApi): Promise<void> {
  await billing.buy('freemium-pro')
}
