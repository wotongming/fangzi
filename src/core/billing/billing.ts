/**
 * 计费框架：
 * - 统一支持 一次性买断 / Freemium / 按次(量) 三种（外加免费）模式
 * - 每个工具只在 manifest.billing 声明规则，权限判定、下单、用量都由本模块统一处理
 * - BillingProvider 为接口：LocalMockProvider 可完整演示与离线使用；
 *   RemoteBillingProvider 通过 /api/billing/* 对接真实支付网关（见 docs/deployment.md 合约）
 */

import type { BillingPlan } from '../types'
import { readJSON, writeJSON } from '../storage'

const STORAGE_KEY = 'fangzi:billing:v1'

export type OrderKind = 'buyout' | 'freemium-pro' | 'usage-pack'

export interface Order {
  id: string
  toolId: string
  kind: OrderKind
  amountCents: number
  currency: string
  /** usage-pack：购买的额度单位数量 */
  units?: number
  status: 'paid' | 'pending' | 'refunded'
  provider: string
  createdAt: string
}

interface UsageState {
  used: number
  /** 已购买的永久额度包数量（跨周期保留） */
  purchasedQuota: number
  resetAt: string
}

interface PersistShape {
  orders: Order[]
  usage: Record<string, UsageState>
}

export interface CheckoutRequest {
  toolId: string
  kind: OrderKind
  amountCents: number
  currency: string
  units?: number
}

export type AccessReason = 'ok' | 'not-owned' | 'quota-exhausted'

export interface AccessDecision {
  allowed: boolean
  reason: AccessReason
  /** 仍可用量（usage 模式） */
  remaining?: number
  /** 需要解锁的付费功能（freemium） */
  lockedFeature?: string
  /** 需要支付的金额（分） */
  requiredCents?: number
}

export interface UsageInfo {
  used: number
  freeQuota: number
  purchasedQuota: number
  remaining: number
  resetAt: string
}

export interface BillingProvider {
  readonly name: string
  listOrders(toolId?: string): Order[]
  isOwned(toolId: string, kind: OrderKind): boolean
  getUsage(plan: BillingPlan, toolId: string): UsageInfo
  canUse(plan: BillingPlan, toolId: string, featureKey?: string): AccessDecision
  /** 发起支付；成功返回 paid 订单 */
  checkout(req: CheckoutRequest): Promise<Order>
  /** 记录一次（或指定数量）消耗，usage 模式使用 */
  consume(toolId: string, plan: BillingPlan, amount?: number): void
  on(event: 'change', cb: () => void): () => void
}

function genOrderId(): string {
  return 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function cycleEnd(cycle: 'day' | 'month' | 'never', from = new Date()): string {
  if (cycle === 'never') return '9999-12-31T23:59:59+08:00'
  const d = new Date(from)
  if (cycle === 'day') d.setDate(d.getDate() + 1)
  else d.setMonth(d.getMonth() + 1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

abstract class BaseProvider implements BillingProvider {
  abstract readonly name: string
  protected state: PersistShape
  private listeners = new Set<() => void>()

  constructor() {
    this.state = readJSON<PersistShape>(STORAGE_KEY, { orders: [], usage: {} })
  }

  protected persist() {
    writeJSON(STORAGE_KEY, this.state)
    this.listeners.forEach((cb) => cb())
  }

  on(_event: 'change', cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  listOrders(toolId?: string): Order[] {
    const all = this.state.orders
    return toolId ? all.filter((o) => o.toolId === toolId) : all
  }

  isOwned(toolId: string, kind: OrderKind): boolean {
    return this.state.orders.some((o) => o.toolId === toolId && o.kind === kind && o.status === 'paid')
  }

  /** 周期到期则把已用量清零（已购额度包保留） */
  private rolloverIfNeeded(toolId: string, plan: BillingPlan): UsageState {
    const cycle = plan.quotaCycle ?? 'month'
    const existing = this.state.usage[toolId]
    if (existing && new Date(existing.resetAt).getTime() > Date.now()) {
      return existing
    }
    const fresh: UsageState = {
      used: 0,
      purchasedQuota: existing?.purchasedQuota ?? 0,
      resetAt: cycleEnd(cycle)
    }
    this.state.usage[toolId] = fresh
    return fresh
  }

  getUsage(plan: BillingPlan, toolId: string): UsageInfo {
    const rec = this.rolloverIfNeeded(toolId, plan)
    const freeQuota = plan.freeQuotaPerCycle ?? 0
    const remaining = Math.max(0, freeQuota + rec.purchasedQuota - rec.used)
    return { used: rec.used, freeQuota, purchasedQuota: rec.purchasedQuota, remaining, resetAt: rec.resetAt }
  }

  canUse(plan: BillingPlan, toolId: string, featureKey?: string): AccessDecision {
    switch (plan.mode) {
      case 'free':
        return { allowed: true, reason: 'ok' }
      case 'buyout':
        return this.isOwned(toolId, 'buyout')
          ? { allowed: true, reason: 'ok' }
          : { allowed: false, reason: 'not-owned', requiredCents: plan.priceCents }
      case 'freemium': {
        if (!featureKey) return { allowed: true, reason: 'ok' }
        const feature = plan.features?.find((f) => f.key === featureKey)
        if (!feature || feature.free) return { allowed: true, reason: 'ok' }
        return this.isOwned(toolId, 'freemium-pro')
          ? { allowed: true, reason: 'ok' }
          : {
              allowed: false,
              reason: 'not-owned',
              lockedFeature: featureKey,
              requiredCents: plan.priceCents
            }
      }
      case 'usage': {
        const info = this.getUsage(plan, toolId)
        return info.remaining > 0
          ? { allowed: true, reason: 'ok', remaining: info.remaining }
          : { allowed: false, reason: 'quota-exhausted', remaining: 0, requiredCents: plan.pricePerUnitCents }
      }
      default: {
        // 理论不可达：BillingMode 为有限联合，上面已穷尽
        const _exhaustive: never = plan.mode
        throw new Error(`未知计费模式：${String(_exhaustive)}`)
      }
    }
  }

  consume(toolId: string, plan: BillingPlan, amount = 1): void {
    if (plan.mode !== 'usage') return
    const rec = this.rolloverIfNeeded(toolId, plan)
    rec.used += amount
    this.persist()
  }

  /** 子类完成支付后调用：写订单；额度包同步增加可用量 */
  protected applyPaidOrder(order: Order) {
    this.state.orders.push(order)
    if (order.kind === 'usage-pack' && order.units) {
      const rec = this.state.usage[order.toolId] ?? {
        used: 0,
        purchasedQuota: 0,
        resetAt: cycleEnd('month')
      }
      rec.purchasedQuota += order.units
      this.state.usage[order.toolId] = rec
    }
    this.persist()
  }

  abstract checkout(req: CheckoutRequest): Promise<Order>
}

/**
 * 本地模拟支付：下单即视为支付成功。
 * 用于离线演示、本地开发与无支付网关阶段；正式环境替换为 RemoteBillingProvider。
 */
export class LocalMockProvider extends BaseProvider {
  readonly name = 'local-mock'

  async checkout(req: CheckoutRequest): Promise<Order> {
    await new Promise((r) => setTimeout(r, 300)) // 模拟网络确认
    const order: Order = {
      id: genOrderId(),
      toolId: req.toolId,
      kind: req.kind,
      amountCents: req.amountCents,
      currency: req.currency,
      units: req.units,
      status: 'paid',
      provider: this.name,
      createdAt: new Date().toISOString()
    }
    this.applyPaidOrder(order)
    return order
  }
}

/**
 * 真实支付网关适配器：与自有后端 /api/billing/* 交互。
 * 具体网关（微信/支付宝/Stripe/Paddle）在后端实现，前端不接触任何密钥。
 */
export class RemoteBillingProvider extends BaseProvider {
  readonly name = 'remote'
  constructor(private apiBase: string) {
    super()
  }

  async checkout(req: CheckoutRequest): Promise<Order> {
    const res = await fetch(`${this.apiBase}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    })
    if (!res.ok) throw new Error(`支付下单失败：${res.status}`)
    const payload = (await res.json()) as { order: Order; payUrl?: string }
    if (payload.payUrl) {
      // 跳转收银台；支付结果由后端回调写单，返回后前端轮询 /order/:id 同步权益
      window.location.href = payload.payUrl
    }
    return payload.order
  }
}
