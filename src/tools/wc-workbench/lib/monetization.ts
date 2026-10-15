/**
 * wc-workbench 变现层（主方案：freemium + 买断 Pro ¥49.90）。
 * 免费：原生组件生成、实时预览、API 文档、custom-elements.json、单文件/最小包导出、本地最多 3 个组件。
 * Pro（一次买断 freemium-pro）：Lit 生成、React/Vue wrapper、完整 npm 包 zip、不限本地组件、模型导入导出。
 */
import type { ToolBillingApi } from '@/composables/useToolBilling'

export interface WbAccess {
  pro: boolean
  priceText: string
}

export function buildAccess(billing: ToolBillingApi): WbAccess {
  const pro = billing.isOwned('freemium-pro') || billing.isOwned('buyout')
  return { pro, priceText: billing.priceText(billing.plan.priceCents) }
}

export async function upgrade(billing: ToolBillingApi): Promise<void> {
  await billing.buy('freemium-pro')
}
