/**
 * 计费 Provider 单例选择：
 * - 默认 LocalMockProvider（开箱即用、离线可演示、零后端）
 * - 配置 VITE_BILLING_ENDPOINT 后使用 RemoteBillingProvider 对接真实支付后端
 */

import { LocalMockProvider, RemoteBillingProvider, type BillingProvider } from './billing'

let instance: BillingProvider | null = null

export function billingProvider(): BillingProvider {
  if (instance) return instance
  const endpoint = (import.meta.env.VITE_BILLING_ENDPOINT as string | undefined)?.trim()
  instance = endpoint ? new RemoteBillingProvider(endpoint) : new LocalMockProvider()
  return instance
}

export * from './billing'
