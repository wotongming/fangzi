/**
 * home-medicine —— 类型与基础工具。金额无关，本工具核心是日期与确定性规则。
 */

export type MedType = 'rx' | 'otc' | 'tcm' | 'supplement' // 处方药 / 非处方药 / 中成药 / 保健品
export type DoseForm = 'tablet' | 'capsule' | 'liquid' | 'eyeDrop' | 'topical' | 'inhaler' | 'injection' | 'other'

/** 服药时段（早/中/晚/睡前） */
export type SlotKey = 'morning' | 'noon' | 'evening' | 'bedtime'

export const SLOT_LABEL: Record<SlotKey, string> = {
  morning: '早',
  noon: '中',
  evening: '晚',
  bedtime: '睡前'
}
export const SLOT_ORDER: SlotKey[] = ['morning', 'noon', 'evening', 'bedtime']

export interface Member {
  id: string
  name: string
  note?: string
  createdAt: number
  updatedAt: number
}

export interface Med {
  id: string
  memberId: string
  /** 药品通用名（优先）或商品名 */
  name: string
  /** 规格，如 “0.5g*24片” */
  spec?: string
  type: MedType
  form: DoseForm
  /** 命中的成分 key（见 rules-cn.INGREDIENTS），用于重复成分/高风险组合检测；可为空 */
  ingredientKeys: string[]
  /** 每次剂量的文字描述，如 “1片 / 5ml” */
  doseText?: string
  /** 服药时段 */
  slots: SlotKey[]
  /** 用药起始/结束日期（yyyy-mm-dd）；结束为空表示长期 */
  startDate?: string
  stopDate?: string
  /** 有效期（包装标注，yyyy-mm-dd） */
  expiryDate?: string
  /** 开封日期（yyyy-mm-dd） */
  openedDate?: string
  /** 开封后可用天数；留空按剂型默认（眼药水 28 天） */
  openDays?: number
  /** 剩余量文字 */
  stockText?: string
  /** 存放位置 */
  location?: string
  /** 是否仍在使用（false=已停/备用，仅做药箱库存与梳理） */
  active: boolean
  note?: string
  createdAt: number
  updatedAt: number
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 两个 yyyy-mm-dd 之间相差的整数天（b - a）；非法输入返回 null */
export function daysBetween(a: string, b: string): number | null {
  if (!a || !b) return null
  const da = Date.parse(`${a}T00:00:00`)
  const db = Date.parse(`${b}T00:00:00`)
  if (Number.isNaN(da) || Number.isNaN(db)) return null
  return Math.round((db - da) / 86400000)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

export const MED_TYPE_LABEL: Record<MedType, string> = {
  rx: '处方药',
  otc: '非处方药',
  tcm: '中成药',
  supplement: '保健品'
}

export const DOSE_FORM_LABEL: Record<DoseForm, string> = {
  tablet: '片剂',
  capsule: '胶囊',
  liquid: '口服液/糖浆',
  eyeDrop: '滴眼液',
  topical: '外用膏/贴',
  inhaler: '吸入剂',
  injection: '注射剂',
  other: '其他'
}
