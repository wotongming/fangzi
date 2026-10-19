/**
 * home-medicine —— 用药安全梳理（纯函数）。
 * 输出重复成分 / 高风险组合 / 过期 / 临期 / 开封过期等提示项；保守、可解释。
 */
import type { Med } from './models'
import { GROUP_DUPLICATE, HIGH_RISK_RULES, INGREDIENTS, type IngredientGroup } from './rules-cn'
import { expiryInfo } from './expiry'

export type FindingLevel = 'danger' | 'warn' | 'info'
export type FindingType = 'expired' | 'near' | 'duplicate' | 'risk'

export interface Finding {
  type: FindingType
  level: FindingLevel
  title: string
  detail: string
  advice?: string
  source?: string
  medIds: string[]
  medNames: string[]
}

function groupsOf(med: Med): Set<IngredientGroup> {
  const s = new Set<IngredientGroup>()
  for (const key of med.ingredientKeys) {
    const def = INGREDIENTS[key]
    if (def) def.groups.forEach((g) => s.add(g))
  }
  return s
}

/**
 * 汇总一个成员（或跨成员）的用药提示。
 * @param meds 待评估药品（建议传入当前成员的全部库存药；成分/高风险仅看 active 在用药）
 */
export function reviewMeds(meds: Med[], today: string): Finding[] {
  const out: Finding[] = []

  // 1) 有效期 / 开封到期：对全部库存药（含备用、已停）评估，季度理药也要能发现过期药
  for (const med of meds) {
    const info = expiryInfo(med, today)
    if (info.level === 'expired') {
      const byOpen = info.basis === 'opened' || (info.basis === 'both' && info.date === info.openExpiry)
      out.push({
        type: 'expired',
        level: 'danger',
        title: byOpen ? '已超过开封后使用期限，建议停用' : '药品已过有效期，请勿服用',
        detail: `「${med.name}」生效停用日期为 ${info.date}（${byOpen ? '按开封后期限' : info.basis === 'both' ? '有效期与开封期限取早' : '按包装有效期'}），已过期 ${Math.abs(info.days ?? 0)} 天。`,
        advice: '过期或开封超期药品药效与安全性无法保证，请停止使用并按家庭有害垃圾/药店回收妥善处理。',
        medIds: [med.id],
        medNames: [med.name]
      })
    } else if (info.level === 'near') {
      out.push({
        type: 'near',
        level: 'info',
        title: '药品临近有效期',
        detail: `「${med.name}」将于 ${info.date} 到期，还剩 ${info.days} 天，请优先使用或及时更换。`,
        medIds: [med.id],
        medNames: [med.name]
      })
    }
  }

  // 2) 成分重复 / 3) 高风险组合：仅评估“仍在使用”的药
  const active = meds.filter((m) => m.active)

  const groupMeds = new Map<IngredientGroup, Med[]>()
  for (const med of active) {
    for (const g of groupsOf(med)) {
      if (!groupMeds.has(g)) groupMeds.set(g, [])
      groupMeds.get(g)!.push(med)
    }
  }

  for (const [group, list] of groupMeds) {
    const rule = GROUP_DUPLICATE[group]
    if (rule && list.length >= 2) {
      out.push({
        type: 'duplicate',
        level: rule.level,
        title: rule.title,
        detail: `在用药中检测到 ${list.length} 种药品命中同一成分/类别：${list.map((m) => `「${m.name}」`).join('、')}。`,
        advice: rule.advice,
        source: rule.source,
        medIds: list.map((m) => m.id),
        medNames: list.map((m) => m.name)
      })
    }
  }

  for (const rule of HIGH_RISK_RULES) {
    const aMeds = active.filter((m) => groupsOf(m).has(rule.a))
    const bMeds = active.filter((m) => groupsOf(m).has(rule.b))
    // 排除同一药同时带两组造成的“自我配对”，要求来自不同药品
    const pair: Med[] = []
    for (const x of aMeds) {
      const y = bMeds.find((m) => m.id !== x.id)
      if (y) {
        pair.push(x, y)
        break
      }
    }
    if (pair.length === 2) {
      const uniq = pair.filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
      out.push({
        type: 'risk',
        level: rule.level,
        title: rule.title,
        detail: `在用药中同时检测到：${uniq.map((m) => `「${m.name}」`).join('、')}。`,
        advice: rule.advice,
        source: rule.source,
        medIds: uniq.map((m) => m.id),
        medNames: uniq.map((m) => m.name)
      })
    }
  }

  return out
}

export function countByLevel(findings: Finding[]): Record<FindingLevel, number> {
  return findings.reduce(
    (acc, f) => {
      acc[f.level] += 1
      return acc
    },
    { danger: 0, warn: 0, info: 0 }
  )
}
