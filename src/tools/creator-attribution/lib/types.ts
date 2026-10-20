/**
 * creator-attribution —— 领域模型（零依赖、不 import Vue）。
 *
 * 合规边界：本工具数据全部来自用户手动录入或用户自行准备的 CSV，
 * 不接任何平台 API、不抓包、不内嵌任何平台网页。金额一律整数分（cents）。
 */

export type ContentFormat = 'graphic' | 'video' | 'podcast'
export type DealResult = 'done' | 'doing' | 'dead'

/** 平台枚举（自由文本兜底“其他”） */
export const PLATFORMS = [
  '抖音',
  '小红书',
  'B站',
  '公众号',
  '知乎',
  '播客',
  '视频号',
  '其他'
] as const

export const FORMAT_LABEL: Record<ContentFormat, string> = {
  graphic: '图文',
  video: '视频',
  podcast: '播客'
}

export const FORMAT_VALUE: Record<string, ContentFormat> = {
  图文: 'graphic',
  视频: 'video',
  播客: 'podcast',
  graphic: 'graphic',
  video: 'video',
  podcast: 'podcast'
}

export interface Account {
  id: string
  /** 平台，如 抖音 / 小红书 */
  platform: string
  /** 账号昵称 */
  nickname: string
  createdAt: number
}

export interface Content {
  id: string
  accountId: string
  /** 内容标题（用户自录） */
  title: string
  /** 主题标签（归一后的小写数组） */
  tags: string[]
  format: ContentFormat
  /** 发布时间 epoch ms */
  publishedAt: number
  /** 投入工时（小时，支持 0.5） */
  hours: number
  createdAt: number
  updatedAt: number
}

export interface MetricSnapshot {
  id: string
  contentId: string
  /** 快照时间 epoch ms */
  capturedAt: number
  /** 阅读 / 播放量 */
  views: number
  /** 本期涨粉数 */
  followersDelta: number
  /** 本期收益合计（分：分成 + 商单） */
  revenueCents: number
  note: string
}

export interface Deal {
  id: string
  accountId: string
  /** 品牌名 */
  brand: string
  /** 商单成交/记录日期 epoch ms */
  date: number
  /** 金额（分） */
  amountCents: number
  result: DealResult
  note: string
}

export type AttributionDim = 'tag' | 'format' | 'platform' | 'slot'

export interface AttributionRow {
  label: string
  count: number
  views: number
  revenueCents: number
  revenueYuan: number
  perContentYuan: number
  hours: number
  /** 元/小时；工时为 0 时回退 null（除零安全） */
  roiYuanPerHour: number | null
}

/** 工具内常量 */
export const FREE_ACCOUNT_LIMIT = 3
export const FREE_CONTENT_LIMIT = 30

export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 分 → 元，保留两位展示 */
export function centsToYuan(cents: number): number {
  return Math.round(cents) / 100
}
