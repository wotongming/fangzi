/**
 * home-medicine —— 有效期 / 开封后使用期限（纯函数，便于跨月单测）。
 */
import { addDays, daysBetween, type Med } from './models'
import { DEFAULT_OPEN_DAYS, NEAR_EXPIRY_DAYS } from './rules-cn'

export type ExpiryLevel = 'expired' | 'near' | 'ok' | 'none'

export interface ExpiryInfo {
  level: ExpiryLevel
  /** 实际生效的停用日期（有效期与开封到期取早） */
  date?: string
  /** 距今天数（负=已过期天数） */
  days?: number
  /** 该日期来源 */
  basis: 'expiry' | 'opened' | 'both' | 'none'
  /** 开封到期日（如有） */
  openExpiry?: string
}

/** 开封后到期日；无开封日或该剂型无默认期限时返回 null */
export function openedExpiryDate(med: Pick<Med, 'openedDate' | 'openDays' | 'form'>): string | null {
  if (!med.openedDate) return null
  const days = med.openDays ?? DEFAULT_OPEN_DAYS[med.form]
  if (!days || days <= 0) return null
  return addDays(med.openedDate, days)
}

/** 有效期与开封到期取更早者 */
export function effectiveExpiry(med: Pick<Med, 'expiryDate' | 'openedDate' | 'openDays' | 'form'>): { date?: string; basis: 'expiry' | 'opened' | 'both' | 'none'; openExpiry?: string } {
  const openExp = openedExpiryDate(med)
  const exp = med.expiryDate || undefined
  if (exp && openExp) return { date: openExp < exp ? openExp : exp, basis: 'both', openExpiry: openExp }
  if (exp) return { date: exp, basis: 'expiry' }
  if (openExp) return { date: openExp, basis: 'opened', openExpiry: openExp }
  return { basis: 'none' }
}

export function expiryInfo(med: Med, today: string): ExpiryInfo {
  const eff = effectiveExpiry(med)
  if (!eff.date) return { level: 'none', basis: 'none' }
  const days = daysBetween(today, eff.date)
  if (days === null) return { level: 'none', basis: 'none' }
  let level: ExpiryLevel = 'ok'
  if (days < 0) level = 'expired'
  else if (days <= NEAR_EXPIRY_DAYS) level = 'near'
  return { level, date: eff.date, days, basis: eff.basis, openExpiry: eff.openExpiry }
}
