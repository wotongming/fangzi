/**
 * 计费 Provider 单例选择：
 * - 默认 LocalMockProvider（开箱即用、离线可演示、零后端）
 * - 配置 VITE_BILLING_ENDPOINT 后使用 RemoteBillingProvider 对接真实支付后端
 */

import { LocalMockProvider, RemoteBillingProvider, type BillingProvider } from './billing'

let instance: BillingProvider | null = null

export function billingProvider(): BillingProvider {
  if (instance) return instance
  // 防御式读取：Node 测试环境无 import.meta.env；Vite 构建下正常
  const env = import.meta.env as { VITE_BILLING_ENDPOINT?: string } | undefined
  const endpoint = env?.VITE_BILLING_ENDPOINT?.trim()
  instance = endpoint ? new RemoteBillingProvider(endpoint) : new LocalMockProvider()
  return instance
}

/**
 * 仅供测试：重置计费单例（含内存态订单/用量），配合 localStorage.clear() 实现用例隔离。
 * 正常运行路径不使用本钩子，不改变任何线上行为。
 */
export function __resetBillingForTest(): void {
  instance = null
}

export * from './billing'
