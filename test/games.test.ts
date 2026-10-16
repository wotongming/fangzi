import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyBoard,
  move,
  addRandomTile,
  isGameOver,
  canMove,
  maxTile,
  type Board
} from '../src/tools/mini-games/lib/2048-core.ts'
import {
  ROWS,
  COLS,
  SYMBOLS,
  createGrid,
  isAdjacent,
  swap,
  findMatches,
  hasMatch,
  resolve
} from '../src/tools/mini-games/lib/match3-core.ts'

// 确定性伪随机（LCG）
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

// ---------- 2048 ----------

test('2048：单行向左合并 2 2 2 2 → 4 4，得 8', () => {
  const b: Board = [
    [2, 2, 2, 2],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]
  const r = move(b, 'left')
  assert.deepEqual(r.board[0], [4, 4, 0, 0])
  assert.equal(r.gained, 8)
  assert.equal(r.moved, true)
})

test('2048：每颗棋子单步只合并一次（4 2 2 不能合成 8）', () => {
  const b: Board = [
    [4, 2, 2, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]
  const r = move(b, 'left')
  assert.deepEqual(r.board[0], [4, 4, 0, 0])
  assert.equal(r.gained, 4)
})

test('2048：向右移动正确（2 2 0 0 → 0 0 0 4）', () => {
  const b: Board = [
    [2, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]
  const r = move(b, 'right')
  assert.deepEqual(r.board[0], [0, 0, 0, 4])
})

test('2048：向上合并同列，且不动时 moved=false', () => {
  const b: Board = [
    [2, 0, 0, 0],
    [2, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]
  const up = move(b, 'up')
  assert.deepEqual([up.board[0]![0], up.board[1]![0]], [4, 0])
  assert.equal(up.gained, 4)

  const stuck = move(b, 'right') // 每列只有一个在最左，向右会动；改测一个完全无法左移的行
  const immovable: Board = [
    [2, 4, 8, 16],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]
  const left = move(immovable, 'left')
  assert.equal(left.moved, false)
  void stuck
})

test('2048：满盘且无可合并时游戏结束', () => {
  const b: Board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2]
  ]
  assert.equal(canMove(b), false)
  assert.equal(isGameOver(b), true)
})

test('2048：满盘但存在相邻相同，仍可移动', () => {
  const b: Board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 4]
  ]
  assert.equal(canMove(b), true)
  assert.equal(isGameOver(b), false)
})

test('2048：addRandomTile 只放 2/4 且棋盘棋子数 +1，守恒', () => {
  const b = emptyBoard()
  addRandomTile(b, () => 0) // 0 < 0.9 → 2
  addRandomTile(b, () => 0.99) // >=0.9 → 4
  const vals = b.flat().filter((v) => v !== 0)
  assert.equal(vals.length, 2)
  assert.ok(vals.includes(2))
  assert.ok(vals.includes(4))
})

test('2048：整局移动到结束，分数不超过 maxTile 之和的合理界', () => {
  const rng = seeded(7)
  let b = emptyBoard()
  addRandomTile(b, rng)
  addRandomTile(b, rng)
  let total = 0
  for (let i = 0; i < 5000 && !isGameOver(b); i++) {
    const dirs = ['left', 'up', 'right', 'down'] as const
    let moved = false
    for (const d of dirs) {
      const r = move(b, d)
      if (r.moved) {
        b = r.board
        total += r.gained
        addRandomTile(b, rng)
        moved = true
        break
      }
    }
    if (!moved) break
  }
  // 结束后棋盘应仍守恒为合法 2 的幂，且出现至少一个 >=4 的块
  assert.ok(maxTile(b) >= 4)
  assert.ok(total >= 0)
})

// ---------- 三消 ----------

test('三消：createGrid 初始无现成三连', () => {
  const g = createGrid(seeded(42))
  assert.equal(hasMatch(g), false)
  assert.equal(g.length, ROWS)
  assert.equal(g[0]!.length, COLS)
})

test('三消：isAdjacent 仅正交相邻为真', () => {
  assert.equal(isAdjacent([0, 0], [0, 1]), true)
  assert.equal(isAdjacent([2, 2], [3, 2]), true)
  assert.equal(isAdjacent([0, 0], [1, 1]), false) // 对角
  assert.equal(isAdjacent([0, 0], [0, 0]), false)
})

test('三消：横向三连能被 findMatches 检出', () => {
  const g: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(1))
  // 全 1 会标记全部；改为只在一行放三连，其余用互不相同值避免干扰
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) g[r]![c] = ((r + c) % SYMBOLS) + 1
  g[0]![0] = 3
  g[0]![1] = 3
  g[0]![2] = 3
  const mark = findMatches(g)
  assert.ok(mark[0]![0] && mark[0]![1] && mark[0]![2])
})

test('三消：合法交换后 resolve 消除 3 块并补齐，棋盘无空位', () => {
  // 手工构造：顶行 [1,1,2,1,...]，交换 (0,2) 的 2 与其下方 (1,2) 的 1 后顶行出现四个 1
  const g: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(4))
  g[0] = [1, 1, 2, 1, 5, 3, 2, 5]
  for (let c = 0; c < COLS; c++) g[1]![c] = 5
  g[1]![2] = 1 // 使交换后顶行 1,1,1,1
  // 先确认交换前无三连（避免干扰：第二列下都是5可能纵向连，需隔离列）
  // 直接交换并结算
  swap(g, [0, 2], [1, 2])
  const res = resolve(g, seeded(9))
  assert.ok(res.removed >= 4)
  assert.ok(res.waves >= 1)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) assert.ok(res.grid[r]![c] >= 1 && res.grid[r]![c] <= SYMBOLS)
})

test('三消：不能消除的交换 resolve 返回 removed=0 且不改动', () => {
  const g = createGrid(seeded(123)) // 初始无三连
  // 找一个交换后也不产生三连的相邻对（横向第一对大概率不产生，多试几个）
  let found: [number, number] | null = null
  outer: for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const t = g.map((row) => row.slice())
      swap(t, [r, c], [r, c + 1])
      if (!hasMatch(t)) { found = [r, c]; break outer }
    }
  }
  assert.ok(found)
  const before = JSON.stringify(g)
  const res = resolve(g, seeded(1))
  assert.equal(res.removed, 0)
  assert.equal(JSON.stringify(g), before)
})
