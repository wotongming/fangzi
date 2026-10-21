/**
 * gradient.ts —— 逐行冷暖引导色与视觉行聚类（纯逻辑，Node 单测覆盖）。
 * 冷(蓝) → 暖(橙) 沿阅读方向；行内/行间对**文字**上色，不刷整块背景。
 */

export interface LineColor { h: number; s: number; l: number; css: string }

/** 背景浅色（复杂段整段降级时用，仅作兜底）。 */
export function lineBg(ratio: number): LineColor {
  const r = Math.min(1, Math.max(0, ratio))
  const h = Math.round(210 - (210 - 28) * r)
  return { h, s: 62, l: 88, css: `hsl(${h}, 62%, 88%)` }
}

/** 文字色（核心：视觉行上的渐变文字颜色），蓝→橙，中等亮度保证对比度。 */
export function textColor(ratio: number): LineColor {
  const r = Math.min(1, Math.max(0, ratio))
  const h = Math.round(210 - (210 - 28) * r)
  return { h, s: 58, l: 42, css: `hsl(${h}, 58%, 42%)` }
}

export interface RectItem { y: number; height: number; x: number; text: string }
export interface VisualLine { index: number; ratio: number; items: RectItem[] }

/** 按 top 把字符/片段 rect 聚类成视觉行；同行按 x 排序。 */
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

/**
 * 给定一组 {y} 字符位置（保持原始顺序），输出每行包含的**原始下标分组**。
 * 供 content.js 行级包裹使用；纯几何、不依赖 DOM。
 */
export function groupByLineTops(tops: number[], rowTolerance = 4): number[][] {
  const groups: number[][] = []
  let anchor: number | null = null
  for (let i = 0; i < tops.length; i++) {
    const g = groups.find((gg) => Math.abs(anchorOf(gg, tops) - tops[i]) <= rowTolerance)
    if (g) g.push(i)
    else groups.push([i])
  }
  return groups
}

function anchorOf(group: number[], tops: number[]): number {
  return group.reduce((sum, i) => sum + tops[i], 0) / group.length
}
