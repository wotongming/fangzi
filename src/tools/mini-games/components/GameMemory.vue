<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type Difficulty = 'easy' | 'normal' | 'hard'
const props = defineProps<{ difficulty: Difficulty }>()
const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'gameover', p: { score: number }): void
}>()

const SYMBOLS = ['🍎', '🍋', '🍇', '🍉', '🍓', '🥝', '🍑', '🥥', '🍒', '🥕', '🌽', '⭐']
const PAIRS: Record<Difficulty, number> = { easy: 6, normal: 8, hard: 12 }

interface Card {
  id: number
  sym: string
  flipped: boolean
  matched: boolean
}

const pairs = computed(() => PAIRS[props.difficulty])
const cards = ref<Card[]>([])
const moves = ref(0)
const seconds = ref(0)
const done = ref(false)
let first: number | null = null
let lock = false
let timer: ReturnType<typeof setInterval> | null = null

function shuffled(): Card[] {
  const chosen = SYMBOLS.slice(0, pairs.value)
  const doubled = [...chosen, ...chosen]
  for (let i = doubled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[doubled[i], doubled[j]] = [doubled[j]!, doubled[i]!]
  }
  return doubled.map((sym, id) => ({ id, sym, flipped: false, matched: false }))
}

function points(): number {
  return Math.max(0, pairs.value * 1000 - moves.value * 10 - seconds.value * 2)
}

function reset() {
  cards.value = shuffled()
  moves.value = 0
  seconds.value = 0
  done.value = false
  first = null
  lock = false
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    if (!done.value) {
      seconds.value++
      emit('score', points())
    }
  }, 1000)
  emit('score', points())
}

function flip(idx: number) {
  if (lock || done.value) return
  const card = cards.value[idx]!
  if (card.flipped || card.matched) return

  card.flipped = true
  if (first === null) {
    first = idx
    return
  }
  const a = first
  first = null
  moves.value++
  emit('score', points())

  if (cards.value[a]!.sym === card.sym) {
    cards.value[a]!.matched = true
    card.matched = true
    if (cards.value.every((c) => c.matched)) {
      done.value = true
      if (timer) clearInterval(timer)
      emit('score', points())
      emit('gameover', { score: points() })
    }
  } else {
    lock = true
    setTimeout(() => {
      cards.value[a]!.flipped = false
      card.flipped = false
      lock = false
    }, 650)
  }
}

onMounted(reset)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
defineExpose({ reset })
</script>

<template>
  <div class="mem">
    <div class="stats">
      <span>步数 <b>{{ moves }}</b></span>
      <span>用时 <b>{{ seconds }}s</b></span>
      <span>已配对 <b>{{ cards.filter((c) => c.matched).length / 2 }}/{{ pairs }}</b></span>
    </div>
    <div class="grid" :class="difficulty === 'hard' ? 'cols-6' : 'cols-4'">
      <button
        v-for="(card, idx) in cards"
        :key="card.id"
        class="card"
        :class="{ up: card.flipped || card.matched, done: card.matched }"
        @click="flip(idx)"
        :aria-label="card.flipped || card.matched ? card.sym : '未翻开的牌'"
      >
        <span class="face front">?</span>
        <span class="face back">{{ card.sym }}</span>
      </button>
    </div>

    <div v-if="done" class="winbar">
      🎉 全部配对完成！{{ moves }} 步 / {{ seconds }} 秒
      <button class="btn btn-primary" @click="reset">再玩一次</button>
    </div>
    <p class="hint">点两张牌找出相同表情；步数越少、用时越短得分越高。</p>
  </div>
</template>

<style scoped>
.mem { display: flex; flex-direction: column; align-items: center; gap: 12px; }
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
.grid { display: grid; gap: 8px; width: min(88vw, 380px); }
.cols-4 { grid-template-columns: repeat(4, 1fr); }
.cols-6 { grid-template-columns: repeat(6, 1fr); width: min(92vw, 420px); }
.card {
  position: relative;
  aspect-ratio: 1;
  border: none;
  padding: 0;
  background: transparent;
  perspective: 600px;
}
.face {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: clamp(20px, 6vw, 30px);
  backface-visibility: hidden;
  transition: transform 0.25s ease;
}
.front { background: var(--brand); color: #fff; font-weight: 800; }
.back { background: var(--surface); border: 1px solid var(--line); transform: rotateY(180deg); }
.card.up .front { transform: rotateY(180deg); }
.card.up .back { transform: rotateY(0); }
.card.done .back { background: var(--brand-soft); border-color: var(--brand); }
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
