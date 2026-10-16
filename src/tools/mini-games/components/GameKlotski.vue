<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type Difficulty = 'easy' | 'normal'
const props = defineProps<{ difficulty: Difficulty }>()
const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'gameover', p: { score: number }): void
}>()

const n = computed(() => (props.difficulty === 'easy' ? 3 : 4))
const tiles = ref<number[]>([])
const moves = ref(0)
const seconds = ref(0)
const won = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

function solvedBoard(size: number): number[] {
  const arr = Array.from({ length: size * size }, (_, i) => (i + 1) % (size * size))
  return arr // 1..n²-1, 末尾 0
}

function isSolved(arr: number[], size: number): boolean {
  for (let i = 0; i < size * size - 1; i++) if (arr[i] !== i + 1) return false
  return arr[size * size - 1] === 0
}

/** 从已解局面执行大量随机合法步，保证一定可还原（且不会恰好回到初始）。 */
function shuffled(size: number): number[] {
  const arr = solvedBoard(size)
  let zero = arr.indexOf(0)
  let prevZero = -1
  const steps = size === 3 ? 120 : 240
  for (let s = 0; s < steps; s++) {
    const r = Math.floor(zero / size)
    const c = zero % size
    const cand: number[] = []
    if (r > 0) cand.push(zero - size)
    if (r < size - 1) cand.push(zero + size)
    if (c > 0) cand.push(zero - 1)
    if (c < size - 1) cand.push(zero + 1)
    const options = cand.filter((p) => p !== prevZero)
    const pick = options[Math.floor(Math.random() * options.length)]!
    ;[arr[zero], arr[pick]] = [arr[pick]!, arr[zero]!]
    prevZero = zero
    zero = pick
  }
  return isSolved(arr, size) ? shuffled(size) : arr
}

function points(): number {
  const base = n.value === 3 ? 3000 : 6000
  const movePenalty = n.value === 3 ? 15 : 10
  return Math.max(0, base - moves.value * movePenalty - seconds.value * 2)
}

function reset() {
  tiles.value = shuffled(n.value)
  moves.value = 0
  seconds.value = 0
  won.value = false
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    if (!won.value) {
      seconds.value++
      emit('score', points())
    }
  }, 1000)
  emit('score', points())
}

function trySlide(idx: number) {
  if (won.value) return
  const zero = tiles.value.indexOf(0)
  const zr = Math.floor(zero / n.value)
  const zc = zero % n.value
  const tr = Math.floor(idx / n.value)
  const tc = idx % n.value
  const adjacent = (zr === tr && Math.abs(zc - tc) === 1) || (zc === tc && Math.abs(zr - tr) === 1)
  if (!adjacent) return
  tiles.value[zero] = tiles.value[idx]!
  tiles.value[idx] = 0
  moves.value++
  emit('score', points())
  if (isSolved(tiles.value, n.value)) {
    won.value = true
    if (timer) clearInterval(timer)
    emit('score', points())
    emit('gameover', { score: points() })
  }
}

onMounted(reset)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
defineExpose({ reset })
</script>

<template>
  <div class="kl">
    <div class="stats">
      <span>步数 <b>{{ moves }}</b></span>
      <span>用时 <b>{{ seconds }}s</b></span>
    </div>
    <div class="board" :class="difficulty === 'easy' ? 'n3' : 'n4'">
      <button
        v-for="(v, idx) in tiles"
        :key="idx"
        class="tile"
        :class="{ empty: v === 0 }"
        @click="trySlide(idx)"
      >
        {{ v || '' }}
      </button>
    </div>
    <div v-if="won" class="winbar">
      🎉 复原成功！{{ moves }} 步 / {{ seconds }} 秒
      <button class="btn btn-primary" @click="reset">再来一局</button>
    </div>
    <p class="hint">点击与空格相邻的数字块滑动，把数字按 1→{{ n * n - 1 }} 顺序排好。</p>
  </div>
</template>

<style scoped>
.kl { display: flex; flex-direction: column; align-items: center; gap: 12px; }
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
  display: grid;
  gap: 8px;
  width: min(86vw, 360px);
  aspect-ratio: 1;
  background: #bbada0;
  border-radius: var(--radius);
  padding: 10px;
}
.n3 { grid-template-columns: repeat(3, 1fr); }
.n4 { grid-template-columns: repeat(4, 1fr); }
.tile {
  border: none;
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: clamp(22px, 7vw, 34px);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tile:not(.empty):active { background: #d3e6dc; }
.tile.empty { background: rgba(238, 228, 218, 0.35); }
.n4 .tile { font-size: clamp(18px, 6vw, 28px); }
.winbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  background: var(--brand-soft);
  color: var(--brand-dark);
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-weight: 600;
}
.hint { color: var(--ink-faint); font-size: 13px; margin: 0; text-align: center; }
</style>
