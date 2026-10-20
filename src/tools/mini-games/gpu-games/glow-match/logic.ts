/**
 * 炫光连消 —— 玩法判定（复用 ../../lib/match3-core 纯逻辑内核，仅替换表现层）。
 *
 * 与 DOM 三消共用同一套交换/消除/下落/连锁规则与计分口径（removed 已含连锁加权，
 * 得分 = removed * 20），保证排行榜分数可比；本文件额外给出首波被消除格子的坐标与色相，
 * 供 GPU 表现层在精确位置爆发粒子。
 */
import {
  cloneGrid,
  createGrid,
  findMatches,
  hasMatch,
  isAdjacent,
  resolve,
  swap,
  COLS,
  ROWS,
  type Grid
} from '../../lib/match3-core'

/** 5 种宝石对应的霓虹色相（与表现层 CSS/粒子共用）。 */
export const GEM_HUES = [188, 46, 326, 152, 264] as const
export const SCORE_PER = 20

export interface BurstCell {
  r: number
  c: number
  hue: number
}

export interface MoveResult {
  ok: boolean
  /** 交换后、结算前的棋盘（用于“交换动画”中间态） */
  swapped: Grid
  /** 结算稳定后的棋盘 */
  grid: Grid
  /** 本次得分（含连锁加权）；无效步为 0 */
  gained: number
  /** 本次实际消除的格子总数（用于目标进度统计）；无效步为 0 */
  removed: number
  /** 连锁波次数 */
  waves: number
  /** 首波被消除的格子（用于粒子定位） */
  cells: BurstCell[]
}

function hueAt(v: number): number {
  return GEM_HUES[(v - 1 + GEM_HUES.length) % GEM_HUES.length] ?? 188
}

/** 尝试一次交换；返回是否合法及结算结果。不修改输入棋盘。 */
export function tryMove(input: Grid, a: [number, number], b: [number, number]): MoveResult {
  const empty: MoveResult = { ok: false, swapped: input, grid: input, gained: 0, removed: 0, waves: 0, cells: [] }
  if (!isAdjacent(a, b)) return empty
  const swapped = cloneGrid(input)
  swap(swapped, a, b)
  if (!hasMatch(swapped)) return empty

  const mark = findMatches(swapped)
  const cells: BurstCell[] = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (mark[r]?.[c]) {
        const v = swapped[r]?.[c] ?? 0
        if (v > 0) cells.push({ r, c, hue: hueAt(v) })
      }
    }
  }

  const res = resolve(swapped)
  return {
    ok: true,
    swapped,
    grid: res.grid,
    gained: res.removed * SCORE_PER,
    removed: res.count,
    waves: res.waves,
    cells
  }
}

/** 是否仍存在一步可消交换（无解时洗牌）。 */
export function hasPossibleMove(g: Grid): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS) {
        const t = cloneGrid(g)
        swap(t, [r, c], [r, c + 1])
        if (hasMatch(t)) return true
      }
      if (r + 1 < ROWS) {
        const t = cloneGrid(g)
        swap(t, [r, c], [r + 1, c])
        if (hasMatch(t)) return true
      }
    }
  }
  return false
}

export function newBoard(): Grid {
  return createGrid()
}

export { ROWS, COLS }
