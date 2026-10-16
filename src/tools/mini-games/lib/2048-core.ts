/**
 * 2048 纯逻辑内核（无 DOM、可单测）。
 * 棋盘为 4×4 二维数组，0 表示空格；所有移动均返回新棋盘，不修改入参。
 */

export type Board = number[][]
export type Direction = 'up' | 'down' | 'left' | 'right'

export const SIZE = 4

export function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0))
}

export function cloneBoard(b: Board): Board {
  return b.map((row) => row.slice())
}

export function listEmpty(b: Board): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (b[r]![c] === 0) out.push([r, c])
  return out
}

/**
 * 在随机空格放入 2（90%）或 4（10%）。
 * rng 可注入，便于测试与可复现局。
 * @returns 是否成功放入
 */
export function addRandomTile(b: Board, rng: () => number = Math.random): boolean {
  const empties = listEmpty(b)
  if (empties.length === 0) return false
  const [r, c] = empties[Math.floor(rng() * empties.length)]!
  b[r]![c] = rng() < 0.9 ? 2 : 4
  return true
}

export function startBoard(rng: () => number = Math.random): Board {
  const b = emptyBoard()
  addRandomTile(b, rng)
  addRandomTile(b, rng)
  return b
}

/** 单行向左压缩并合并（每颗棋子每步最多合并一次）：[2,2,2,2] -> [4,4,0,0] */
function slideRowLeft(row: number[]): { row: number[]; gained: number } {
  const compact = row.filter((v) => v !== 0)
  let gained = 0
  for (let i = 0; i < compact.length - 1; i++) {
    if (compact[i] === compact[i + 1]) {
      compact[i] = compact[i]! * 2
      gained += compact[i]!
      compact.splice(i + 1, 1)
    }
  }
  while (compact.length < SIZE) compact.push(0)
  return { row: compact, gained }
}

function transpose(b: Board): Board {
  const out = emptyBoard()
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out[c]![r] = b[r]![c]!
  return out
}

function reverseRows(b: Board): Board {
  return b.map((row) => row.slice().reverse())
}

export interface MoveResult {
  board: Board
  gained: number
  moved: boolean
}

function sameBoard(a: Board, b: Board): boolean {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (a[r]![c] !== b[r]![c]) return false
  return true
}

/** 朝指定方向移动；moved=false 表示该方向无可移动。 */
export function move(b: Board, dir: Direction): MoveResult {
  let work = cloneBoard(b)
  let gained = 0

  const applyLeft = (grid: Board): Board =>
    grid.map((row) => {
      const res = slideRowLeft(row)
      gained += res.gained
      return res.row
    })

  if (dir === 'left') {
    work = applyLeft(work)
  } else if (dir === 'right') {
    work = reverseRows(applyLeft(reverseRows(work)))
  } else if (dir === 'up') {
    work = transpose(applyLeft(transpose(work)))
  } else {
    work = transpose(reverseRows(applyLeft(reverseRows(transpose(work)))))
  }

  return { board: work, gained, moved: !sameBoard(b, work) }
}

/** 是否还能移动：存在空格，或上下左右相邻有相同棋子。 */
export function canMove(b: Board): boolean {
  if (listEmpty(b).length > 0) return true
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = b[r]![c]!
      if (c + 1 < SIZE && b[r]![c + 1] === v) return true
      if (r + 1 < SIZE && b[r + 1]![c] === v) return true
    }
  }
  return false
}

export function isGameOver(b: Board): boolean {
  return !canMove(b)
}

export function maxTile(b: Board): number {
  let m = 0
  for (const row of b) for (const v of row) if (v > m) m = v
  return m
}
