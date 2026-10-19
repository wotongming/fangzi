/**
 * home-medicine —— 就诊带药清单（纯文本，便于打印/出示/转发给医生药师）。
 */
import { MED_TYPE_LABEL, SLOT_LABEL, type Med, type Member } from './models'
import { isTakingOn } from './schedule'

export function buildClinicText(member: Member | undefined, meds: Med[], today: string): string {
  const lines: string[] = []
  lines.push(`就诊带药清单（家庭成员：${member?.name ?? '未命名'}）`)
  lines.push(`生成日期：${today}　由「方子·家庭药箱」本地生成`)
  lines.push('')
  lines.push('说明：以下为家庭自行登记的在用药品/保健品记录，仅供就诊沟通参考，具体诊疗以医生判断为准。')
  lines.push('')

  const groups: Med['type'][] = ['rx', 'otc', 'tcm', 'supplement']
  let idx = 1
  for (const type of groups) {
    const list = meds.filter((m) => m.type === type && isTakingOn(m, today))
    if (list.length === 0) continue
    lines.push(`【${MED_TYPE_LABEL[type]}】`)
    for (const m of list) {
      const freq = m.slots.length ? m.slots.map((s) => SLOT_LABEL[s]).join('/') : '按医嘱'
      const period =
        m.startDate || m.stopDate ? `（${m.startDate || '起始未填'} 起 ${m.stopDate ? `至 ${m.stopDate}` : '长期'}）` : ''
      lines.push(
        `${idx++}. ${m.name}${m.spec ? `　${m.spec}` : ''}　每次：${m.doseText || '按医嘱'}　频次：${freq}${period}`
      )
    }
    lines.push('')
  }

  if (idx === 1) lines.push('当前没有登记“仍在使用”的药品。')

  lines.push('—— 请在就诊时向医生/药师出示本清单，并主动说明药物过敏史与既往不良反应 ——')
  return lines.join('\n')
}

/** 季度理药：把药品按 过期/疑似重复/非必需(保健品及已停用备用) 分类标注 */
export function buildReviewText(member: Member | undefined, meds: Med[], today: string): string {
  const lines: string[] = []
  lines.push(`家庭药箱季度梳理清单（${member?.name ?? '未命名'}）`)
  lines.push(`生成日期：${today}`)
  lines.push('')
  const inactive: Med[] = []
  const supplements: Med[] = []
  for (const m of meds) {
    if (!m.active) inactive.push(m)
    if (m.type === 'supplement' && m.active) supplements.push(m)
  }
  lines.push(`一、建议带去药学门诊/请药师复核：在用保健品/中成药共 ${supplements.length} 种`)
  supplements.forEach((m) => lines.push(`  · ${m.name}${m.spec ? ` ${m.spec}` : ''}`))
  lines.push('')
  lines.push(`二、已停用/备用药品（确认是否仍需保留）：${inactive.length} 种`)
  inactive.forEach((m) => lines.push(`  · ${m.name}${m.spec ? ` ${m.spec}` : ''}`))
  lines.push('')
  lines.push('三、临期/过期情况请以工具“安全梳理”页的逐条提示为准；过期药请勿服用。')
  return lines.join('\n')
}
