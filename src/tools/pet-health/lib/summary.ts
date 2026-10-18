/**
 * summary.ts —— 把时间线整理成可复制给兽医的「病情摘要」（模板拼装，不做任何医学判断）。
 */
import { dayMs, EVENT_META, SPECIES_LABELS, GENDER_LABELS } from './models'
import type { HealthEvent, Pet } from './models'

export interface SummaryRange {
  start?: string
  end?: string
}

const RELEVANT: HealthEvent['kind'][] = ['symptom', 'visit', 'med', 'vaccine', 'deworm', 'diet', 'weight', 'other']

/** 生成病情摘要纯文本；无数据时给出明确兜底，不编造。 */
export function buildSummary(pet: Pet, events: HealthEvent[], range: SummaryRange = {}): string {
  const rows = events
    .filter((e) => e.petId === pet.id && RELEVANT.includes(e.kind))
    .filter((e) => (!range.start || e.date >= range.start) && (!range.end || e.date <= range.end))
    .sort((a, b) => dayMs(a.date) - dayMs(b.date) || a.createdAt - b.createdAt)

  const lines: string[] = []
  lines.push(`【病情时间线摘要】（由主人用「方子·宠物健康管家」记录整理）`)
  lines.push(`宠物：${pet.name}（${SPECIES_LABELS[pet.species]}${pet.breed ? '·' + pet.breed : ''}·${GENDER_LABELS[pet.gender]}${pet.neutered ? '·已绝育' : ''}）`)
  if (pet.birthday) lines.push(`出生日期：${pet.birthday}`)
  if (pet.allergies?.trim()) lines.push(`已知过敏：${pet.allergies.trim()}`)
  if (pet.chronic?.trim()) lines.push(`既往基础病：${pet.chronic.trim()}`)
  lines.push('')

  if (rows.length === 0) {
    lines.push('所选时间范围内暂无健康记录。')
  } else {
    for (const e of rows) {
      const meta = EVENT_META[e.kind]
      let line = `${e.date} ${meta.emoji}${meta.label}：${e.name || '（未填写名称）'}`
      if (typeof e.valueKg === 'number') line += `（体重 ${e.valueKg}kg）`
      if (e.hospital) line += `｜医院：${e.hospital}`
      if (e.doctor) line += `｜医生：${e.doctor}`
      if (e.note?.trim()) line += `｜${e.note.trim()}`
      lines.push(line)
    }
  }

  lines.push('')
  lines.push('说明：以上为主人自行记录的健康时间线，供兽医面诊参考，不能替代兽医诊断。')
  return lines.join('\n')
}
