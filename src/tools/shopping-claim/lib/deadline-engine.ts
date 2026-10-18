/**
 * 时效引擎（纯函数）：输入案件 + 今天，输出各窗口起止、剩余天数、状态与今日可做动作。
 * 便于单测：闰年、跨月、质量不受 7 日限制、定作例外等在此覆盖。
 */
import { addDays, addMonths, dayMs, diffDays, toDateStr, today as defaultToday, type ClaimCase } from './models'
import { CATEGORY_RULES, NOREASON_DAYS, SOURCES } from './rules-cn'

export type WindowState = 'expired' | 'due-soon' | 'open' | 'na'
export type WindowKey = 'noReason' | 'exchange15' | 'warranty' | 'priceProtect'

export interface WindowStatus {
  key: WindowKey
  label: string
  start: string
  end: string
  /** 今天距 end 的整天数；负数表示已过期 */
  daysLeft: number
  state: WindowState
  /** 今天可采取的动作 / 提示 */
  action: string
  source: string
  note?: string
}

const DUE_SOON_DAYS = 2

function stateOf(daysLeft: number, applicable: boolean): WindowState {
  if (!applicable) return 'na'
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= DUE_SOON_DAYS) return 'due-soon'
  return 'open'
}

/**
 * 计算单个案件的全部时效窗口。
 * @param nowIso 今天 YYYY-MM-DD（默认本机今天），便于测试注入
 */
export function computeWindows(c: ClaimCase, nowIso: string = defaultToday()): WindowStatus[] {
  const cat = CATEGORY_RULES[c.category]
  const out: WindowStatus[] = []
  const received = c.receivedDate

  // 1) 7 天无理由退货（远程购物）
  const noReasonEnd = addDays(received, NOREASON_DAYS)
  const noReasonDays = diffDays(nowIso, noReasonEnd)
  const noReasonApply = !c.customMade
  out.push({
    key: 'noReason',
    label: '7 天无理由退货',
    start: received,
    end: noReasonEnd,
    daysLeft: noReasonDays,
    state: stateOf(noReasonDays, noReasonApply),
    action:
      c.customMade
        ? '该商品为定作等情形，通常不适用七日无理由；如属质量问题仍可依法主张修换退'
        : noReasonDays < 0
          ? '无理由窗口已过；如属质量问题，改走质量问题通道，不受 7 日限制'
          : '可在保持商品完好前提下申请七天无理由退货（拆封≠不完好）',
    source: SOURCES.noReason
  })

  // 2) 三包 15 日内换货（性能故障），仅适用品类
  if (cat.triplePack15) {
    const exEnd = addDays(received, 15)
    const exDays = diffDays(nowIso, exEnd)
    out.push({
      key: 'exchange15',
      label: '15 日内换货（性能故障）',
      start: received,
      end: exEnd,
      daysLeft: exDays,
      state: stateOf(exDays, true),
      action:
        exDays < 0
          ? '15 日换货窗口已过；保修期内出现性能故障仍可要求免费修理，符合条件可主张退货/换货'
          : '确属性能故障的，可在 15 日内要求换货或修理（部分品类 7 日内可退）',
      source: SOURCES.triplePack,
      note: '质量问题主张不受七日无理由期限限制'
    })
  }

  // 3) 保修期免费修理
  if (cat.warrantyMonths > 0) {
    const wEnd = addMonths(received, cat.warrantyMonths)
    const wDays = diffDays(nowIso, wEnd)
    out.push({
      key: 'warranty',
      label: `保修期内免费修理（常见 ${cat.warrantyMonths} 个月）`,
      start: received,
      end: wEnd,
      daysLeft: wDays,
      state: stateOf(wDays, true),
      action:
        wDays < 0
          ? '常见保修期已过，以三包凭证/保修卡实际承诺为准；超保仍可协商或主张质量缺陷责任'
          : '保修期内非人为损坏可要求免费修理；两次修理仍不能正常使用等情形可主张换/退',
      source: SOURCES.warranty,
      note: '具体保修期以三包凭证、保修卡为准'
    })
  } else {
    out.push({
      key: 'warranty',
      label: '保修期内修理',
      start: received,
      end: '—',
      daysLeft: Number.POSITIVE_INFINITY,
      state: 'na',
      action: '该品类无统一法定保修月数，请按商家承诺/三包凭证或质量缺陷责任主张',
      source: SOURCES.warranty
    })
  }

  // 4) 价保（平台规则，可编辑天数）
  if (c.priceProtectDays > 0) {
    const pEnd = addDays(received, c.priceProtectDays)
    const pDays = diffDays(nowIso, pEnd)
    out.push({
      key: 'priceProtect',
      label: `价保 ${c.priceProtectDays} 天（平台规则）`,
      start: received,
      end: pEnd,
      daysLeft: pDays,
      state: stateOf(pDays, true),
      action:
        pDays < 0
          ? '价保期已过，仍可查看订单页是否有延长价保或补差券'
          : '若商品降价，可在订单价保入口一键申请退差价，具体以平台规则为准',
      source: SOURCES.price
    })
  }

  return out.sort((a, b) => rank(a.state) - rank(b.state) || endTime(a.end) - endTime(b.end))
}

function rank(s: WindowState): number {
  return s === 'due-soon' ? 0 : s === 'open' ? 1 : 2
}

function endTime(end: string): number {
  return end === '—' ? Number.POSITIVE_INFINITY : dayMs(end)
}

/** 是否存在今天就要处理（临期/已到期但仍有质量通道）的窗口，用于待办角标。 */
export function urgentCount(windows: WindowStatus[]): number {
  return windows.filter((w) => w.state === 'due-soon' || (w.state === 'expired' && w.key === 'noReason')).length
}

/** 汇总多个案件的待办（用于顶部角标）。 */
export function allWindows(cases: ClaimCase[], nowIso: string = defaultToday()): { c: ClaimCase; windows: WindowStatus[] }[] {
  return cases.map((c) => ({ c, windows: computeWindows(c, nowIso) }))
}

export function todayStr(): string {
  return toDateStr(new Date())
}
