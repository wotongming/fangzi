/**
 * gradient.ts —— 逐行冷暖引导色与视觉行聚类（纯逻辑）。
 */

export interface LineColor { h: number; s: number; l: number; css: string }

export function lineColor(ratio: number): LineColor {
  const r = Math.min(1, Math.max(0, ratio))
  const h = Math.round(210 - (210 - 28) * r)
  const s = 62
  const l = 88
  return { h, s, l, css: `hsl(${h}, ${s}%, ${l}%)` }
}

export interface RectItem { y: number; height: number; x: number; text: string }
export interface VisualLine { index: number; ratio: number; items: RectItem[] }

export function clusterVisualLines(items: RectItem[], rowTolerance = 4): VisualLine[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: { y: number; items: RectItem[] }[] = []
  for (const it of sorted) {
    const row = lines.find((l) => Math.abs(l.y - it.y) <= rowTolerance)
    if (row) {
      row.items.push(it)
      row.items.sort((a, b) => a.x - b.x)
    } else {
      lines.push({ y: it.y, items: [it] })
    }
  }
  return lines.map((l, i) => ({
    index: i,
    ratio: lines.length > 1 ? i / (lines.length - 1) : 0,
    items: l.items
  }))
}
