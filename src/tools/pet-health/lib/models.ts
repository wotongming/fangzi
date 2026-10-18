/**
 * pet-health —— 领域模型与常量（纯类型 / 纯函数，零依赖）。
 *
 * 医疗边界：本工具只做「记录 / 提醒 / 整理」，不做疾病诊断、不推荐用药、不承诺疗效。
 */

export type Species = 'cat' | 'dog' | 'other'
export type Gender = 'male' | 'female' | 'unknown'

/** 健康事件类型 */
export type EventKind =
  | 'vaccine' // 疫苗接种
  | 'deworm' // 体内外驱虫
  | 'med' // 用药记录
  | 'visit' // 就诊
  | 'symptom' // 症状观察
  | 'diet' // 饮食/换粮
  | 'weight' // 体重（用 valueKg）
  | 'medprice' // 自记药品价格（用 name/amountCents/hospital）
  | 'other'

export interface Pet {
  id: string
  name: string
  species: Species
  breed?: string
  gender: Gender
  /** 出生日期 YYYY-MM-DD（可空，只知道大概可不填） */
  birthday?: string
  neutered?: boolean
  /** 芯片号 */
  chip?: string
  /** 过敏史（文本，多条换行） */
  allergies?: string
  /** 既往基础病（文本） */
  chronic?: string
  /** 头像图片 id（存 photos 表） */
  avatarPhotoId?: string
  createdAt: number
}

export interface HealthEvent {
  id: string
  petId: string
  kind: EventKind
  /** 发生日期 YYYY-MM-DD */
  date: string
  /** 标题/名称：疫苗名、药品名、症状名、医院名等 */
  name: string
  /** 详情备注：剂量、症状描述、医嘱等 */
  note?: string
  /** 就诊医院 */
  hospital?: string
  /** 接诊医生 */
  doctor?: string
  /** 费用（分），visit/med/medprice/diet 等可填 */
  amountCents?: number
  /** 体重 kg（kind=weight） */
  valueKg?: number
  /** 药品规格（kind=medprice），如 50mg*6 片 */
  spec?: string
  /** 关联照护计划 key（疫苗/驱虫用于推算下次） */
  planKey?: string
  /** 单据图片（化验单/处方/疫苗本）照片 id 列表 */
  photoIds: string[]
  createdAt: number
}

/** 单据 / 凭证图片，单独分表存 Blob，避免主记录过大 */
export interface PhotoRecord {
  id: string
  /** 归属宠物（便于按宠清理） */
  petId: string
  blob: Blob
  mime: string
  width: number
  height: number
  bytes: number
  createdAt: number
}

/** 周期照护计划（每只宠物可启用/停用、可改起始日与周期） */
export interface CarePlan {
  id: string
  petId: string
  /** 内置计划 key，如 deworm-monthly / vaccine-yearly */
  planKey: string
  enabled: boolean
  /** 周期天数 */
  intervalDays: number
  /** 起始日期 YYYY-MM-DD（没有历史记录时以此为基准） */
  startDate: string
}

export interface PlanTemplate {
  key: string
  label: string
  kind: EventKind
  intervalDays: number
  /** 参考说明（必须提示遵当地兽医与法规） */
  hint: string
}

/**
 * 常见疫苗/驱虫「参考」节奏，可编辑，仅用于生成提醒。
 * 不同地区、品牌、动物个体差异很大，界面必须提示以执业兽医建议为准。
 */
export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: 'deworm-monthly',
    label: '每月体外/体内驱虫',
    kind: 'deworm',
    intervalDays: 30,
    hint: '常见每月一次的预防性驱虫节奏，具体药品与频率请遵兽医建议。'
  },
  {
    key: 'vaccine-yearly',
    label: '年度疫苗加强',
    kind: 'vaccine',
    intervalDays: 365,
    hint: '成年宠物常见年度加强节奏（如猫三联/狂犬、犬四联/狂犬），接种程序与有效期以兽医和当地规定为准。'
  }
]

export const EVENT_META: Record<EventKind, { label: string; emoji: string; cost: boolean }> = {
  vaccine: { label: '疫苗', emoji: '💉', cost: false },
  deworm: { label: '驱虫', emoji: '🪱', cost: false },
  med: { label: '用药', emoji: '💊', cost: true },
  visit: { label: '就诊', emoji: '🏥', cost: true },
  symptom: { label: '症状', emoji: '👀', cost: false },
  diet: { label: '饮食', emoji: '🍚', cost: true },
  weight: { label: '体重', emoji: '⚖️', cost: false },
  medprice: { label: '药价', emoji: '🏷️', cost: true },
  other: { label: '其他', emoji: '📝', cost: false }
}

export const SPECIES_LABELS: Record<Species, string> = {
  cat: '猫',
  dog: '狗',
  other: '其他'
}

export const GENDER_LABELS: Record<Gender, string> = {
  male: '公',
  female: '母',
  unknown: '未知'
}

export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** YYYY-MM-DD → 当地零点 ms（避免 toISOString 的 UTC 偏移） */
export function dayMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime()
}

export function fmtDate(date: string): string {
  return date
}

/** 金额：分 → 元文本 */
export function fmtYuan(cents?: number): string {
  if (cents === undefined || cents === null) return ''
  return `¥${(cents / 100).toFixed(2)}`
}

/** 元输入 → 分（非法返回 undefined） */
export function yuanToCents(yuan: string): number | undefined {
  const v = Number(yuan)
  if (!isFinite(v) || v < 0) return undefined
  return Math.round(v * 100)
}

/** 简单药品名归一，用于「同药不同价」聚合（自录数据，非市场价） */
export function normalizeMedName(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s·•|_（）()【】\[\]]+/g, '')
}
