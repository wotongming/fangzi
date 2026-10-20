/**
 * models.ts —— 家庭资产档案库领域模型与纯函数（零依赖、不 import Vue）。
 *
 * 合规边界：本工具只存储用户本人录入的家庭物品档案与本人拍照的凭证，
 * 不抓取、不内置任何第三方版权内容；所有数据保存在本机浏览器。
 */

// —— 常量 ——

/** 免费层资产卡片上限（张） */
export const FREE_ASSET_LIMIT = 50

/** QR 载荷前缀：扫码内容形如 fz-box:<boxId> */
export const QR_PREFIX = 'fz-box:'

/** 照片压缩目标：长边像素、JPEG 质量、体积上限（字节） */
export const PHOTO_MAX_EDGE = 1600
export const PHOTO_QUALITY = 0.82
export const PHOTO_MAX_BYTES = 300 * 1024

/** 到期分级窗口（天） */
export const SOON_7_DAYS = 7
export const SOON_30_DAYS = 30

// —— 领域模型 ——

/** 资产卡片（一件贵重/关键物品） */
export interface Asset {
  id: string
  name: string
  /** 家电/数码/家具/证件/保单/车辆/其它（允许自由扩展） */
  category: string
  /** 存放位置自由文本，如「主卧-衣柜上层」 */
  location: string
  /** 购入日期 YYYY-MM-DD */
  purchaseDate?: string
  /** 购入价（整数分） */
  priceCents?: number
  brandModel?: string
  serialNo?: string
  /** 保修截止 YYYY-MM-DD → 入到期日历 */
  warrantyEnd?: string
  notes?: string
  /** 搬家后归属箱 id */
  boxId?: string
  createdAt: number
  updatedAt: number
}

/** 凭证（发票/保修卡/说明书/维修记录/其它），一资产多份 */
export type DocKind = 'invoice' | 'warranty' | 'manual' | 'repair' | 'other'

export interface Doc {
  id: string
  assetId: string
  kind: DocKind
  photoBlob: Blob
  note?: string
  createdAt: number
}

/** 搬家箱 */
export interface Box {
  id: string
  /** 箱号（用户可读，如 1） */
  code: string
  /** 目的地房间，如「卧室区」 */
  destRoom: string
  note?: string
  createdAt: number
}

/** 箱内物品关联 */
export interface BoxItem {
  id: string
  boxId: string
  assetId: string
  ts: number
}

/** 手动登记的到期项（证件/保险/年检等，非资产保修） */
export type ExpiryKind = 'warranty' | 'license' | 'insurance' | 'inspection'

export interface ExpiryItem {
  id: string
  title: string
  /** YYYY-MM-DD */
  dueDate: string
  kind: ExpiryKind
  /** 关联资产 id（保修项才有） */
  assetId?: string
  notes?: string
}

/** 看板聚合后的到期行 */
export type ExpiryLevel = 'expired' | 'soon7' | 'soon30' | 'ok'

export interface ExpiryRow {
  id: string
  title: string
  dueDate: string
  kind: ExpiryKind
  assetId?: string
  level: ExpiryLevel
  /** 距今天数（负=已过期天数）；非法日期为 null */
  days: number | null
}

// —— 枚举标签 ——

export const CATEGORY_PRESETS = ['家电', '数码', '家具', '证件', '保单', '车辆', '其它']

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  invoice: '发票',
  warranty: '保修卡',
  manual: '说明书',
  repair: '维修记录',
  other: '其它凭证'
}

export const EXPIRY_KIND_LABELS: Record<ExpiryKind, string> = {
  warranty: '保修',
  license: '证件',
  insurance: '保险',
  inspection: '年检/年审'
}

// —— ID / 日期纯函数（本地日历日，避免 UTC 漂移） ——

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 两个 yyyy-mm-dd 相差的整数天（b - a）；非法输入返回 null */
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

// —— 金额展示（整数分 → 元字符串） ——

export function formatCents(cents?: number): string {
  if (cents == null || Number.isNaN(cents)) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

export function yuanToCents(yuan: string): number | undefined {
  const v = Number.parseFloat(yuan)
  if (!Number.isFinite(v) || v < 0) return undefined
  return Math.round(v * 100)
}

// —— QR 载荷纯函数（不依赖动态库，可单测） ——

/** 构造箱 QR 载荷 fz-box:<boxId> */
export function payloadForBox(boxId: string): string {
  return `${QR_PREFIX}${boxId}`
}

/** 解析扫码文本：命中 fz-box: 前缀返回 boxId，否则 null */
export function parseBoxPayload(text: string): string | null {
  const t = (text ?? '').trim()
  if (!t.startsWith(QR_PREFIX)) return null
  const id = t.slice(QR_PREFIX.length).trim()
  return id ? id : null
}
