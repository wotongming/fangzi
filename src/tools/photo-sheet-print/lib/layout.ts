/**
 * photo-sheet-print —— 排版/分页纯逻辑（零依赖、可 node 单测）。
 * 单位：纸张与边距均用 pt（1/72 英寸）；A4 纵向 595.28 × 841.89 pt。
 */

export type Orientation = 'portrait' | 'landscape'

/** A4 尺寸（pt）：纵向宽 595.28、高 841.89。 */
export const A4_PORTRAIT = { w: 595.28, h: 841.89 }
export const A4_LANDSCAPE = { w: 841.89, h: 595.28 }

/** 1 mm 折算 pt。 */
export const MM_TO_PT = 72 / 25.4

export function mmToPt(mm: number): number {
  return Math.max(0, mm) * MM_TO_PT
}

export interface PaperSize {
  w: number
  h: number
}

/** 按方向取 A4 纸张尺寸（pt）。 */
export function paperSize(orientation: Orientation): PaperSize {
  return orientation === 'portrait' ? { ...A4_PORTRAIT } : { ...A4_LANDSCAPE }
}

export interface SheetConfig {
  orientation: Orientation
  /** 每页列数（>=1） */
  cols: number
  /** 每页行数（>=1） */
  rows: number
  /** 页边距（mm） */
  marginMm: number
  /** 图间距（mm） */
  gapMm: number
  /** 页眉标题（可空） */
  header: string
}

/** 归一化配置：行列钳到 >=1，间距不超过纸面合理值。 */
export function normalizeConfig(cfg: Partial<SheetConfig>): SheetConfig {
  const cols = Math.max(1, Math.min(6, Math.floor(Number(cfg.cols) || 1)))
  const rows = Math.max(1, Math.min(6, Math.floor(Number(cfg.rows) || 1)))
  const marginMm = clampNum(cfg.marginMm ?? 12, 4, 40)
  const gapMm = clampNum(cfg.gapMm ?? 4, 0, 20)
  return {
    orientation: cfg.orientation === 'landscape' ? 'landscape' : 'portrait',
    cols,
    rows,
    marginMm,
    gapMm,
    header: String(cfg.header ?? '')
  }
}

function clampNum(v: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** 每页可放图片数 = 列 × 行。 */
export function perPage(cfg: SheetConfig): number {
  return cfg.cols * cfg.rows
}

/** 给定图片数，返回总页数；空数组为 0 页。 */
export function pageCount(total: number, per: number): number {
  if (total <= 0) return 0
  const p = Math.max(1, Math.floor(per))
  return Math.ceil(total / p)
}

/** 把图片按每页 per 张分组；空输入返回空数组。 */
export function groupPages<T>(items: T[], per: number): T[][] {
  if (!items.length) return []
  const p = Math.max(1, Math.floor(per))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += p) out.push(items.slice(i, i + p))
  return out
}

export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

/** 按行列、边距、间距计算每个单元格矩形（pt，原点在左上，y 向下）。 */
export function gridCells(paper: PaperSize, cfg: SheetConfig): CellRect[] {
  const margin = mmToPt(cfg.marginMm)
  const gap = mmToPt(cfg.gapMm)
  const usableW = paper.w - margin * 2
  const usableH = paper.h - margin * 2
  const cw = (usableW - gap * (cfg.cols - 1)) / cfg.cols
  const ch = (usableH - gap * (cfg.rows - 1)) / cfg.rows
  const cells: CellRect[] = []
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      cells.push({
        x: margin + c * (cw + gap),
        y: margin + r * (ch + gap),
        w: cw,
        h: ch
      })
    }
  }
  return cells
}

/** 图片原始尺寸旋转 90° 倍数后的宽高（90/270 交换）。 */
export function rotateDims(w: number, h: number, deg: number): { w: number; h: number } {
  const d = ((Math.round(deg) % 360) + 360) % 360
  return d === 90 || d === 270 ? { w: h, h: w } : { w, h }
}

export interface FitRect {
  w: number
  h: number
  x: number
  y: number
}

/** 把原始宽高按 contain（不裁剪、不变形）放进单元格，居中留白。 */
export function fitInto(aw: number, ah: number, cw: number, ch: number): FitRect {
  if (aw <= 0 || ah <= 0 || cw <= 0 || ch <= 0) return { w: 0, h: 0, x: 0, y: 0 }
  const scale = Math.min(cw / aw, ch / ah)
  const w = aw * scale
  const h = ah * scale
  return { w, h, x: (cw - w) / 2, y: (ch - h) / 2 }
}

/** 页眉在版面内占用的高度（pt），留空时为 0。 */
export function headerHeight(header: string, fontPt = 13): number {
  return header.trim() ? fontPt * 2.4 : 0
}
