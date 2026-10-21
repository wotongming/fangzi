/**
 * payment-chaser —— 自由职业者应收/欠款台账数据模型。
 * 全部存本地 IndexedDB（独立库 fz-payment-chaser-v1），无后端、无账号。
 */

export type ChaseMethod = '微信' | '电话' | '邮件' | '面访' | '其他'

export interface TimelineEntry {
  id: string
  /** YYYY-MM-DD */
  date: string
  method: ChaseMethod
  note: string
  response?: string
}

export interface Invoice {
  id: string
  clientName: string
  projectName: string
  /** 应收金额，单位：分 */
  amountCents: number
  /** 约定付款日 YYYY-MM-DD */
  dueDate: string
  paid: boolean
  paidDate?: string
  note?: string
  timeline: TimelineEntry[]
  createdAt: string
}

export type AgingBucketKey = 'notdue' | '0-30' | '30-60' | '60-90' | '90+'

export interface AgingBucket {
  key: AgingBucketKey
  label: string
  count: number
  cents: number
}

export interface Dashboard {
  buckets: AgingBucket[]
  totalOutstandingCents: number
  totalOutstandingCount: number
  badDebtCents: number
  dueSoonCents: number // 7 天内到期未付
}
