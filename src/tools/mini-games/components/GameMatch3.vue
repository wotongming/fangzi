<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  createGrid,
  isAdjacent,
  swap,
  resolve,
  hasMatch,
  ROWS,
  COLS,
  type Grid
} from '../lib/match3-core'

const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'gameover', p: { score: number }): void
}>()

const COLORS = ['', '#e8706a', '#f2b134', '#5aa9e6', '#6bbf7a', '#9b7ed6']
const grid = ref<Grid>(createGrid())
const score = ref(0)
const moves = ref(0)
const selected = ref<[number, number] | null>(null)
const busy = ref(false)
const flash = ref('')

function reset() {
  grid.value = createGrid()
  score.value = 0
  moves.value = 0
  selected.value = null
  busy.value = false
  emit('score', 0)
}

/** 是否存在一步可消的交换（用于无解时自动洗牌）。 */
function hasPossibleMove(g: Grid): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS) {
        swap(g, [r, c], [r, c + 1])
        const ok = hasMatch(g)
        swap(g, [r, c], [r, c + 1])
        if (ok) return true
      }
      if (r + 1 < ROWS) {
        swap(g, [r, c], [r + 1, c])
        const ok = hasMatch(g)
        swap(g, [r, c], [r + 1, c])
        if (ok) return true
      }
    }
  }
  return false
}

async function onCell(r: number, c: number) {
  if (busy.value) return
  if (!selected.value) {
    selected.value = [r, c]
    return
  }
  const a = selected.value
  selected.value = null
  if (a[0] === r && a[1] === c) return
  if (!isAdjacent(a, [r, c])) {
    // 第二次点的不相邻，则改选为新格子
    selected.value = [r, c]
    return
  }

  busy.value = true
  const testGrid = grid.value.map((row) => row.slice())
  swap(testGrid, a, [r, c])
  if (!hasMatch(testGrid)) {
    flash.value = '这一步不能消除'
    setTimeout(() => (flash.value = ''), 800)
    busy.value = false
    return
  }

  // 合法交换
  swap(grid.value, a, [r, c])
  moves.value++
  await new Promise((res) => setTimeout(res, 140))
  const result = resolve(grid.value)
  grid.value = result.grid
  score.value += result.removed * 20
  emit('score', score.value)

  if (!hasPossibleMove(grid.value)) {
    flash.value = '没有可走的步了，自动洗牌'
    await new Promise((res) => setTimeout(res, 500))
    grid.value = createGrid()
  }
  busy.value = false
}

function cellVal(r: number, c: number): number {
  return grid.value[r]?.[c] ?? 0
}

onMounted(() => emit('score', 0))
defineExpose({ reset })
</script>

<template>
  <div class="m3">
    <div class="stats">
      <span>得分 <b>{{ score }}</b></span>
      <span>步数 <b>{{ moves }}</b></span>
    </div>
    <div class="board" :class="{ busy }">
      <button
        v-for="r in ROWS"
        :key="'r' + r"
        class="mrow"
      >
        <template v-for="c in COLS" :key="c">
          <i
            class="gem"
            :class="{ sel: selected && selected[0] === r - 1 && selected[1] === c - 1 }"
            :style="{ background: cellVal(r - 1, c - 1) ? COLORS[cellVal(r - 1, c - 1)] : 'transparent' }"
            @click="onCell(r - 1, c - 1)"
          />
        </template>
      </button>
    </div>
    <p v-if="flash" class="flash">{{ flash }}</p>
    <p class="hint">点选两个相邻色块交换，横/竖凑齐 3 个及以上同色即可消除，连锁得分翻倍。</p>
  </div>
</template>

<style scoped>
.m3 { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.stats {
  display: flex;
  gap: 18px;
  font-size: 14px;
  color: var(--ink-soft);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 14px;
}
.stats b { color: var(--brand-dark); }
.board {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: min(92vw, 400px);
  aspect-ratio: 1;
  background: var(--brand-soft);
  border-radius: var(--radius);
  padding: 8px;
}
.board.busy { pointer-events: none; }
.mrow { display: flex; gap: 5px; flex: 1; padding: 0; border: none; background: transparent; }
.gem {
  flex: 1;
  border-radius: 8px;
  border: none;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.gem:active { transform: scale(0.92); }
.gem.sel { box-shadow: 0 0 0 3px var(--brand-dark) inset; transform: scale(0.94); }
.flash { color: var(--accent); font-weight: 600; margin: 0; font-size: 14px; }
.hint { color: var(--ink-faint); font-size: 13px; margin: 0; text-align: center; max-width: 400px; }
</style>
