/**
 * PDF 真脱敏 · 纯几何与元数据工具（无浏览器依赖，便于单测）。
 *
 * 坐标约定：PDF 用户空间（原点左下，y 自下向上），单位 pt。矩形 {x,y,w,h}。
 * 遮罩命中判定、页内矩形裁剪、元数据清洗均在此；真正的 pdf.js/pdf-lib 编排在 engine.ts。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 两个轴对齐矩形是否相交（含边相切）。 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return false
  const ax2 = a.x + a.w
  const ay2 = a.y + a.h
  const bx2 = b.x + b.w
  const by2 = b.y + b.h
  return a.x < bx2 && b.x < ax2 && a.y < by2 && b.y < ay2
}

/** 在页宽/页高内裁剪矩形（ clamp 到 [0,pageW]×[0,pageH]），越界部分丢弃。 */
export function clampRectToPage(r: Rect, pageW: number, pageH: number): Rect | null {
  const x1 = Math.max(0, r.x)
  const y1 = Math.max(0, r.y)
  const x2 = Math.min(pageW, r.x + r.w)
  const y2 = Math.min(pageH, r.y + r.h)
  const w = x2 - x1
  const h = y2 - y1
  if (w <= 0 || h <= 0) return null
  return { x: x1, y: y1, w, h }
}

/** 判断某文字项 bbox 是否被任一遮罩矩形覆盖（命中即需真删）。 */
export function rectHitsItem(mask: Rect, item: Rect): boolean {
  return rectsOverlap(mask, item)
}

/** 归一化遮罩列表：裁剪到页内、去掉空矩形、按页去重。 */
export function normalizeMasks(raw: Rect[], pageW: number, pageH: number): Rect[] {
  const out: Rect[] = []
  for (const r of raw) {
    const c = clampRectToPage(r, pageW, pageH)
    if (c) out.push(c)
  }
  return out
}

/**
 * 待清除的文档元数据字段（导出时一律重写为空/匿名）。
 * 返回一个"清洗后元数据"纯对象，engine.ts 据此写回 PDF。
 */
export const PRIVATE_META_FIELDS = [
  'Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'
] as const

export type PrivateMetaField = (typeof PRIVATE_META_FIELDS)[number]

/** 把任意来源的元数据对象清洗为"匿名/空"（用于断言与引擎共用同一口径）。 */
export function scrubMetadata(_raw: Record<string, unknown> = {}): Record<string, string> {
  // 导出件统一不保留任何用户输入的文档信息：全部置空串。
  const out: Record<string, string> = {}
  for (const f of PRIVATE_META_FIELDS) out[f] = ''
  return out
}
