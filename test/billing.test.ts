import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { LocalMockProvider } from '../src/core/billing/billing.ts'
import type { BillingPlan } from '../src/core/types'

// Node 测试环境无 localStorage，提供内存版垫片
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  clear() {
    this.m.clear()
  }
}
;(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage

const free: BillingPlan = { mode: 'free' }
const buyout: BillingPlan = { mode: 'buyout', priceCents: 2990 }
const freemium: BillingPlan = {
  mode: 'freemium',
  priceCents: 990,
  features: [
    { key: 'basic', label: '基础', free: true },
    { key: 'pro', label: '高级', free: false }
  ]
}
const usage: BillingPlan = {
  mode: 'usage',
  pricePerUnitCents: 20,
  unit: '次',
  freeQuotaPerCycle: 3,
  quotaCycle: 'month'
}

beforeEach(() => localStorage.clear())

test('免费工具始终放行', () => {
  const p = new LocalMockProvider()
  assert.equal(p.canUse(free, 't').allowed, true)
})

test('买断：未购买拦截，支付后放行', async () => {
  const p = new LocalMockProvider()
  assert.equal(p.canUse(buyout, 't').allowed, false)
  const order = await p.checkout({ toolId: 't', kind: 'buyout', amountCents: 2990, currency: 'CNY' })
  assert.equal(order.status, 'paid')
  assert.equal(p.canUse(buyout, 't').allowed, true)
})

test('Freemium：免费功能放行，高级功能购买后放行', async () => {
  const p = new LocalMockProvider()
  assert.equal(p.canUse(freemium, 't', 'basic').allowed, true)
  assert.equal(p.canUse(freemium, 't', 'pro').allowed, false)
  await p.checkout({ toolId: 't', kind: 'freemium-pro', amountCents: 990, currency: 'CNY' })
  assert.equal(p.canUse(freemium, 't', 'pro').allowed, true)
})

test('按次计费：免费额度耗尽后拦截，购买额度包后恢复', async () => {
  const p = new LocalMockProvider()
  p.consume('t', usage, 1)
  p.consume('t', usage, 1)
  assert.equal(p.canUse(usage, 't').allowed, true) // 已用 2，剩 1
  p.consume('t', usage, 1)
  assert.equal(p.canUse(usage, 't').allowed, false) // 3 次免费用完

  const info = p.getUsage(usage, 't')
  assert.equal(info.remaining, 0)

  await p.checkout({ toolId: 't', kind: 'usage-pack', amountCents: 200, currency: 'CNY', units: 10 })
  const after = p.getUsage(usage, 't')
  assert.equal(after.purchasedQuota, 10)
  assert.equal(after.remaining, 10)
  assert.equal(p.canUse(usage, 't').allowed, true)
})

test('非 usage 模式调用 consume 不产生副作用', () => {
  const p = new LocalMockProvider()
  p.consume('t', free, 5)
  assert.equal(p.listOrders().length, 0)
})
