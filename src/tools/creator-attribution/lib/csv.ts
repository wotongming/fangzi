/**
 * csv.ts —— 内容台账 CSV 导入纯函数（复用 reusable-module/bill-csv）。
 * 能力：UTF-8/GBK 智能解码、RFC4180 解析、中文列名模糊定位、元→分、多格式日期。
 * 导入为「追加、不覆盖」；导入前先预览行数与失败行；缺必需列直接报错不写入。
 * 纯 TS，浏览器与 Node 均可运行，可直接单测。
 */
import {
  decodeText,
  findColumn,
  parseCsv,
  parseFlexibleDate,
  yuanToCents
} from '../../../../reusable-module/bill-csv/bill-csv'
import type { ContentFormat } from './types'
import { FORMAT_VALUE } from './types'

/** 主题标签归一：按中英文逗号、顿号、空格切分，去空白去重，统一小写。 */
export function normalizeLooseTags(raw: string): string[] {
  if (!raw) return []
  const parts = raw
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(parts)]
}

export interface CsvColumnMap {
  title: number
  platform: number
  date: number
  format: number
  tags: number
  views: number
  revenue: number
  hours: number
}

export interface CsvParseError {
  error: string
  missingRequired: string[]
}

/** 依据表头定位各列；缺必需列（标题、发布时间）返回错误，不写入。 */
export function mapCsvColumns(header: string[]): CsvColumnMap | CsvParseError {
  const title = findColumn(header, ['标题', '内容', '内容标题', 'title', '作品'])
  const date = findColumn(header, ['发布时间', '发布日期', '日期', '时间', 'date', 'publish'])
  const missingRequired: string[] = []
  if (title < 0) missingRequired.push('标题')
  if (date < 0) missingRequired.push('发布时间')
  if (missingRequired.length) {
    return { error: `缺少必需列：${missingRequired.join('、')}`, missingRequired }
  }
  return {
    title,
    date,
    platform: findColumn(header, ['平台', '账号', 'platform', '渠道']),
    format: findColumn(header, ['形式', '类型', '体裁', 'format', '内容形式']),
    tags: findColumn(header, ['标签', '主题', '话题', 'tags', '分类']),
    views: findColumn(header, ['阅读', '播放', '阅读量', '播放量', 'views', '曝光']),
    revenue: findColumn(header, ['收益', '收入', '分成', 'revenue', '金额']),
    hours: findColumn(header, ['工时', '投入', '耗时', 'hours', '时长'])
  }
}

/** 一条待导入内容草稿（尚未分配 accountId / id，由组件侧补全）。 */
export interface CsvContentDraft {
  title: string
  platform: string
  tags: string[]
  format: ContentFormat
  publishedAt: number
  hours: number
  views: number
  revenueCents: number
}

export interface CsvImportResult {
  encoding: 'utf-8' | 'gbk'
  drafts: CsvContentDraft[]
  /** 解析失败被跳过的行数（标题空 / 日期无法解析） */
  skipped: number
}

function pickFormat(raw: string): ContentFormat {
  const v = FORMAT_VALUE[raw.trim()]
  if (v) return v
  const s = raw.trim()
  if (s.includes('视频') || s.includes('video')) return 'video'
  if (s.includes('播客') || s.includes('音频') || s.includes('podcast')) return 'podcast'
  return 'graphic'
}

function cell(line: string[], idx: number): string {
  return idx >= 0 ? (line[idx] ?? '').trim() : ''
}

/**
 * 解析 CSV 为待导入草稿。
 * @param buf CSV 文件 ArrayBuffer（UTF-8 或 GBK 均可）
 * @throws 缺必需列时抛错（由组件侧提示，不写入）
 */
export function parseCsvImport(buf: ArrayBuffer): CsvImportResult {
  const { text, encoding } = decodeText(buf)
  const grid = parseCsv(text)
  if (grid.length < 2) return { encoding, drafts: [], skipped: 0 }
  const header = grid[0]!
  const mapped = mapCsvColumns(header)
  if ('error' in mapped) throw new Error(mapped.error)

  const drafts: CsvContentDraft[] = []
  let skipped = 0
  for (const line of grid.slice(1)) {
    const title = cell(line, mapped.title)
    const publishedAt = parseFlexibleDate(cell(line, mapped.date))
    if (!title || publishedAt === null) {
      skipped += 1
      continue
    }
    const rev = yuanToCents(cell(line, mapped.revenue)) ?? 0
    const views = Math.max(0, Math.round(Number(cell(line, mapped.views)) || 0))
    const hoursRaw = Number(cell(line, mapped.hours))
    drafts.push({
      title,
      platform: cell(line, mapped.platform) || '其他',
      tags: normalizeLooseTags(cell(line, mapped.tags)),
      format: pickFormat(cell(line, mapped.format)),
      publishedAt,
      hours: Number.isFinite(hoursRaw) && hoursRaw >= 0 ? hoursRaw : 0,
      views,
      revenueCents: rev
    })
  }
  return { encoding, drafts, skipped }
}
