<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import {
  startBoard,
  move,
  addRandomTile,
  isGameOver,
  type Board,
  type Direction
} from '../lib/2048-core'

const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'gameover', p: { score: number }): void
}>()

const board = ref<Board>(startBoard())
const score = ref(0)
const over = ref(false)
const touched = ref(false)

function reset() {
  board.value = startBoard()
  score.value = 0
  over.value = false
  touched.value = false
  emit('score', 0)
}

function doMove(dir: Direction) {
  if (over.value) return
  const res = move(board.value, dir)
  if (!res.moved) return
  touched.value = true
  addRandomTile(res.board)
  board.value = res.board
  score.value += res.gained
  emit('score', score.value)
  if (isGameOver(res.board)) {
    over.value = true
    emit('gameover', { score: score.value })
  }
}

function onKey(ev: KeyboardEvent) {
  const map: Record<string, Direction> = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right'
  }
  const dir = map[ev.key]
  if (dir) {
    ev.preventDefault()
    doMove(dir)
  }
}

let sx = 0
let sy = 0
function onTouchStart(ev: TouchEvent) {
  const t = ev.touches[0]!
  sx = t.clientX
  sy = t.clientY
}
function onTouchEnd(ev: TouchEvent) {
  const t = ev.changedTouches[0]!
  const dx = t.clientX - sx
  const dy = t.clientY - sy
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
  if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? 'right' : 'left')
  else doMove(dy > 0 ? 'down' : 'up')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  emit('score', 0)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

defineExpose({ reset })
</script>

<template>
  <div class="g2048">
    <div
      class="board"
      tabindex="0"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
      <div v-for="(row, r) in board" :key="r" class="row">
        <div
          v-for="(v, c) in row"
          :key="c"
          class="cell"
          :class="v ? 't' + (v > 2048 ? 'super' : v) : 'empty'"
        >
          <span v-if="v">{{ v }}</span>
        </div>
      </div>

      <div v-if="over" class="overlay">
        <p class="ov-title">游戏结束</p>
        <p class="ov-sub">本局 {{ score }} 分</p>
        <button class="btn btn-primary" @click="reset">再来一局</button>
      </div>
    </div>

    <div class="dpad" aria-label="方向控制">
      <button class="pad up" @click="doMove('up')" aria-label="上">▲</button>
      <button class="pad left" @click="doMove('left')" aria-label="左">◀</button>
      <button class="pad right" @click="doMove('right')" aria-label="右">▶</button>
      <button class="pad down" @click="doMove('down')" aria-label="下">▼</button>
    </div>
    <p class="hint">电脑用方向键 / WASD，手机在棋盘上滑动；相同数字相撞合并，凑出 2048。</p>
  </div>
</template>

<style scoped>
.g2048 {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.board {
  position: relative;
  width: min(86vw, 360px);
  aspect-ratio: 1;
  background: #bbada0;
  border-radius: var(--radius);
  padding: 10px;
  display: grid;
  grid-template-rows: repeat(4, 1fr);
  gap: 10px;
  outline: none;
  touch-action: none;
}
.row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.cell {
  border-radius: var(--radius-sm);
  background: rgba(238, 228, 218, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: clamp(20px, 6vw, 34px);
  color: #776e65;
  user-select: none;
}
.t2 { background: #eee4da; }
.t4 { background: #ede0c8; }
.t8 { background: #f2b179; color: #f9f6f2; }
.t16 { background: #f59563; color: #f9f6f2; }
.t32 { background: #f67c5f; color: #f9f6f2; }
.t64 { background: #f65e3b; color: #f9f6f2; }
.t128 { background: #edcf72; color: #f9f6f2; font-size: clamp(18px, 5vw, 30px); }
.t256 { background: #edcc61; color: #f9f6f2; font-size: clamp(18px, 5vw, 30px); }
.t512 { background: #edc850; color: #f9f6f2; font-size: clamp(18px, 5vw, 30px); }
.t1024 { background: #edc53f; color: #f9f6f2; font-size: clamp(15px, 4.4vw, 26px); }
.t2048 { background: #edc22e; color: #f9f6f2; font-size: clamp(15px, 4.4vw, 26px); box-shadow: 0 0 18px rgba(237, 194, 46, 0.6); }
.tsuper { background: #3c3a32; color: #f9f6f2; font-size: clamp(14px, 4vw, 24px); }
.overlay {
  position: absolute;
  inset: 0;
  background: rgba(238, 228, 218, 0.82);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 2;
}
.ov-title { font-size: 26px; font-weight: 800; color: #776e65; margin: 0; }
.ov-sub { color: #776e65; margin: 0 0 8px; }
.dpad {
  display: grid;
  grid-template-columns: repeat(3, 56px);
  grid-template-rows: repeat(2, 48px);
  gap: 8px;
  justify-content: center;
}
.pad {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: var(--radius-sm);
  font-size: 16px;
  color: var(--brand-dark);
}
.pad:active { background: var(--brand-soft); }
.up { grid-column: 2; grid-row: 1; }
.left { grid-column: 1; grid-row: 2; }
.down { grid-column: 2; grid-row: 2; }
.right { grid-column: 3; grid-row: 2; }
.hint { color: var(--ink-faint); font-size: 13px; text-align: center; margin: 0; max-width: 360px; }
</style>
