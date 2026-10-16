/**
 * 三消（Match-3）纯逻辑内核：方格棋盘，相邻交换，横向/纵向 >=3 连珠消除并下落补充。
 * 无 DOM、可单测；rng 可注入。
 */

export const ROWS = 8
export const COLS = 8
export const SYMBOLS = 5 // 5 种色块

export type Grid = number[][] // 0 表示空，1..SYMBOLS 表示色块

export function createGrid(rng: () => number = Math.random): Grid {
  const g: Grid = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0))
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let v = 1 + Math.floor(rng() * SYMBOLS)
      // 避开生成即三连
      let guard = 0
      while (causesTriple(g, r, c, v) && guard++ < 50) v = 1 + Math.floor(rng() * SYMBOLS)
      g[r]![c] = v
    }
  }
  return g
}

function causesTriple(g: Grid, r: number, c: number, v: number): boolean {
  if (c >= 2 && g[r]![c - 1] === v && g[r]![c - 2] === v) return true
  if (r >= 2 && g[r - 1]![c] === v && g[r - 2]![c] === v) return true
  return false
}

export function cloneGrid(g: Grid): Grid {
  return g.map((row) => row.slice())
}

export function isAdjacent(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1
}

export function swap(g: Grid, a: [number, number], b: [number, number]): void {
  const t = g[a[0]]![a[1]]!
  g[a[0]]![a[1]] = g[b[0]]![b[1]]!
  g[b[0]]![b[1]] = t
}

/** 标记所有属于 >=3 连珠的格子（横向 + 纵向）。 */
export function findMatches(g: Grid): boolean[][] {
  const mark: boolean[][] = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false))

  for (let r = 0; r < ROWS; r++) {
    let runStart = 0
    for (let c = 1; c <= COLS; c++) {
      const endOfRun = c === COLS || g[r]![c] !== g[r]![runStart] || g[r]![runStart] === 0
      if (endOfRun) {
        if (g[r]![runStart] !== 0 && c - runStart >= 3) {
          for (let k = runStart; k < c; k++) mark[r]![k] = true
        }
        runStart = c
      }
    }
  }

  for (let c = 0; c < COLS; c++) {
    let runStart = 0
    for (let r = 1; r <= ROWS; r++) {
      const endOfRun = r === ROWS || g[r]![c] !== g[runStart]![c] || g[runStart]![c] === 0
      if (endOfRun) {
        if (g[runStart]![c] !== 0 && r - runStart >= 3) {
          for (let k = runStart; k < r; k++) mark[k]![c] = true
        }
        runStart = r
      }
    }
  }
  return mark
}

export function hasMatch(g: Grid): boolean {
  const m = findMatches(g)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (m[r]![c]) return true
  return false
}

/** 消除 → 下落 → 顶部补充新块（一次结算，可能仍残留连珠，由 resolve 级联处理）。 */
function collapseOnce(g: Grid, rng: () => number): number {
  const mark = findMatches(g)
  let removed = 0
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (mark[r]![c]) {
    g[r]![c] = 0
    removed++
  }
  if (removed === 0) return 0

  for (let c = 0; c < COLS; c++) {
    // 自下而上收集存活块
    const survivors: number[] = []
    for (let r = ROWS - 1; r >= 0; r--) if (g[r]![c] !== 0) survivors.push(g[r]![c]!)
    for (let r = ROWS - 1; r >= 0; r--) {
      const idx = ROWS - 1 - r
      g[r]![c] = survivors[idx] ?? 1 + Math.floor(rng() * SYMBOLS)
    }
  }
  return removed
}

export interface ResolveResult {
  grid: Grid
  /** 总消除块数（含连锁） */
  removed: number
  /** 连锁波次数 */
  waves: number
}

/** 交换后结算：不断消除/下落/补充直到稳定。输入会被复制，不修改原棋盘。 */
export function resolve(input: Grid, rng: () => number = Math.random): ResolveResult {
  const g = cloneGrid(input)
  let removed = 0
  let waves = 0
  // 首波有连珠才计分；补充产生的新连珠作为连锁
  let n = collapseOnce(g, rng)
  if (n === 0) return { grid: input, removed: 0, waves: 0 }
  while (n > 0) {
    removed += n * (waves + 1) // 连锁加权
    waves++
    n = collapseOnce(g, rng)
  }
  return { grid: g, removed, waves }
}
