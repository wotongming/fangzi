<script setup lang="ts">
/**
 * 炫光连消（Glow Match）—— GPU 炫光表现层。
 *
 * 玩法判定全部来自 ./logic（复用 match3-core）；本组件只负责：
 * 滑动/拖拽输入、霓虹宝石渲染、在精确格位驱动 NeonEngine 粒子爆发/震屏、合成音效与振动。
 * 棋盘为居中 DOM 网格（清晰可读），特效由全屏 canvas 在其下层渲染，沉浸且不挡操作。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NeonEngine } from '../../engine/neon-engine'
import { NeonAudio, haptic } from '../../audio/synth'
import {
  COLS,
  GEM_HUES,
  ROWS,
  hasPossibleMove,
  newBoard,
  tryMove,
  type BurstCell
} from './logic'
import type { Grid } from '../../lib/match3-core'

const props = withDefaults(
  defineProps<{
    /** 兼容统一难度入参；炫光连消仅一种经典棋盘 */
    difficulty?: string
    paused?: boolean
    muted?: boolean
    vibrate?: boolean
    particle?: 'auto' | 'high' | 'low'
  }>(),
  { paused: false, muted: false, vibrate: true, particle: 'auto', difficulty: 'normal' }
)

const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'combo', v: number): void
  (e: 'gameover'): void
}>()

const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const boardEl = ref<HTMLDivElement | null>(null)
const grid = ref<Grid>(newBoard())
const score = ref(0)
const backend = ref('init')
const invalid = ref(false)
const selected = ref<{ r: number; c: number } | null>(null)

/** 本局目标：消除这么多块即通关结束（避免永无止境）。 */
const TARGET_REMOVED = 60
const removedCount = ref(0)
const finished = ref(false)
const progressPct = computed(() => Math.min(100, Math.round((removedCount.value / TARGET_REMOVED) * 100)))
const removedLeft = computed(() => Math.max(0, TARGET_REMOVED - removedCount.value))
/** 全屏闪光（每次消除点亮，CSS 过渡自动衰减）。 */
const flash = ref(0)
let flashTimer: ReturnType<typeof setTimeout> | null = null
/** 格位爆圈：在被消除格上短暂扩散的光环。 */
const pops = ref<Array<{ id: number; r: number; c: number; hue: number; big: boolean }>>([])
let popSeq = 0
let busy = false
let engine: NeonEngine | null = null
const audio = new NeonAudio()
audio.setMuted(props.muted)
let ro: ResizeObserver | null = null
let comboTimer: ReturnType<typeof setTimeout> | null = null
/** 拖拽起手信息；consumed 表示本次按下已经通过滑动触发过交换，抬起时不再按轻点处理。 */
let down: { r: number; c: number; x: number; y: number } | null = null
let consumed = false
/** 超过该位移即认定为“滑动交换”（px），小于它抬起按“轻点选择”处理。 */
const DRAG_THRESHOLD = 16

const cells = computed(() => {
  const out: Array<{ r: number; c: number; v: number; hue: number; sel: boolean }> = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = grid.value[r]?.[c] ?? 0
      out.push({
        r,
        c,
        v,
        hue: GEM_HUES[(v - 1 + GEM_HUES.length) % GEM_HUES.length] ?? 188,
        sel: !!selected.value && selected.value.r === r && selected.value.c === c
      })
    }
  }
  return out
})

function cellFromPoint(clientX: number, clientY: number): { r: number; c: number } | null {
  const el = boardEl.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const c = Math.floor(((clientX - rect.left) / rect.width) * COLS)
  const r = Math.floor(((clientY - rect.top) / rect.height) * ROWS)
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null
  return { r, c }
}

/** 把棋盘格位换算为全屏 canvas 的 CSS 像素中心。 */
function cellCenter(r: number, c: number): { x: number; y: number } | null {
  const board = boardEl.value
  const canvas = canvasEl.value
  if (!board || !canvas) return null
  const b = board.getBoundingClientRect()
  const cv = canvas.getBoundingClientRect()
  return {
    x: b.left - cv.left + ((c + 0.5) / COLS) * b.width,
    y: b.top - cv.top + ((r + 0.5) / ROWS) * b.height
  }
}

function onPointerDown(e: PointerEvent): void {
  audio.ensure() // 用户手势内解锁音频
  if (finished.value) return
  const cell = cellFromPoint(e.clientX, e.clientY)
  if (!cell) {
    // 点在棋盘外（空白）只收起选中，绝不打断游戏/弹菜单。
    down = null
    selected.value = null
    return
  }
  down = { ...cell, x: e.clientX, y: e.clientY }
  consumed = false
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
}

/** 滑动：超过阈值立即按主轴方向与相邻格交换，短滑也跟手。 */
function cancelPointer(): void {
  down = null
  consumed = false
}

async function onPointerMove(e: PointerEvent): Promise<void> {
  if (!down || consumed || busy) return
  const dx = e.clientX - down.x
  const dy = e.clientY - down.y
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  consumed = true
  const start = { r: down.r, c: down.c }
  down = null
  let target: { r: number; c: number } | null = null
  if (Math.abs(dx) > Math.abs(dy)) {
    const c = start.c + (dx > 0 ? 1 : -1)
    if (c >= 0 && c < COLS) target = { r: start.r, c }
  } else {
    const r = start.r + (dy > 0 ? 1 : -1)
    if (r >= 0 && r < ROWS) target = { r, c: start.c }
  }
  selected.value = null
  if (target) await attemptMove([start.r, start.c], [target.r, target.c])
}

/** 轻点：点选宝石 → 再点相邻格交换；点同格/空白取消选择。不再唤出任何菜单。 */
async function onPointerUp(e: PointerEvent): Promise<void> {
  if (!down) return
  down = null
  if (consumed || busy) {
    consumed = false
    return
  }
  const cell = cellFromPoint(e.clientX, e.clientY)
  if (!cell) {
    selected.value = null
    return
  }
  const cur = selected.value
  if (!cur) {
    selected.value = { r: cell.r, c: cell.c }
    haptic(6, props.vibrate)
    return
  }
  if (cur.r === cell.r && cur.c === cell.c) {
    selected.value = null
    return
  }
  const adjacent = Math.abs(cur.r - cell.r) + Math.abs(cur.c - cell.c) === 1
  if (adjacent) {
    selected.value = null
    await attemptMove([cur.r, cur.c], [cell.r, cell.c])
  } else {
    // 点到非相邻格：改为选中新格，而不是无效抖动。
    selected.value = { r: cell.r, c: cell.c }
    haptic(6, props.vibrate)
  }
}

/** 触发一次全屏闪光：先点亮再迅速衰减（连锁越强越亮）。 */
function triggerFlash(strength: number): void {
  flash.value = Math.max(flash.value, strength)
  if (flashTimer) clearTimeout(flashTimer)
  // 下一帧把值清零，交给 CSS transition 做淡出
  requestAnimationFrame(() => {
    flashTimer = setTimeout(() => (flash.value = 0), 40)
  })
}

/** 在首波被消除格上生成扩散爆圈，动画结束后移除。 */
function spawnPops(cells: BurstCell[], big: boolean): void {
  const born = cells.map((cell) => ({ id: ++popSeq, r: cell.r, c: cell.c, hue: cell.hue, big }))
  pops.value.push(...born)
  const ids = new Set(born.map((p) => p.id))
  setTimeout(() => {
    pops.value = pops.value.filter((p) => !ids.has(p.id))
  }, big ? 620 : 460)
}

async function attemptMove(a: [number, number], b: [number, number]): Promise<void> {
  if (busy || finished.value) return
  const result = tryMove(grid.value, a, b)
  if (!result.ok) {
    invalid.value = true
    setTimeout(() => (invalid.value = false), 220)
    haptic(12, props.vibrate)
    return
  }

  busy = true
  grid.value = result.swapped
  await new Promise((res) => setTimeout(res, 130))

  const big = result.waves >= 2
  // 强化视觉冲击：粒子更多更猛 + 格位扩散爆圈 + 全屏闪光 + 更强震屏
  spawnPops(result.cells, big)
  for (const cell of result.cells) {
    const pos = cellCenter(cell.r, cell.c)
    if (pos) {
      engine?.burst(pos.x, pos.y, {
        count: big ? 26 : 18,
        power: 260 + result.waves * 70,
        hue: cell.hue,
        sizeScale: big ? 1.5 : 1.2,
        life: big ? 0.8 : 0.6
      })
    }
  }
  // 连锁时在棋盘中心再补一圈大爆发
  if (big) {
    const mid = cellCenter(Math.floor(ROWS / 2), Math.floor(COLS / 2))
    if (mid) engine?.burst(mid.x, mid.y, { count: 30, power: 420 + result.waves * 40, sizeScale: 1.6, life: 0.9 })
  }
  engine?.setShake(big ? 12 + result.waves * 4 : 7)
  triggerFlash(big ? 0.55 + Math.min(0.3, result.waves * 0.06) : 0.28)
  if (big) {
    audio.explode(result.waves)
    haptic([18, 40, 18], props.vibrate)
  } else {
    audio.blip(result.waves - 1)
    haptic(10, props.vibrate)
  }

  grid.value = result.grid
  score.value += result.gained
  removedCount.value += result.removed
  emit('score', score.value)
  if (big) {
    emit('combo', result.waves)
    if (comboTimer) clearTimeout(comboTimer)
    comboTimer = setTimeout(() => emit('combo', 0), 1100)
  }

  // 达成目标 → 通关结束：盛大庆祝爆发 + 上报落最佳分
  if (removedCount.value >= TARGET_REMOVED) {
    removedCount.value = TARGET_REMOVED
    finished.value = true
    selected.value = null
    triggerFlash(0.85)
    engine?.setShake(16)
    for (let k = 0; k < 5; k++) {
      const rr = Math.floor(Math.random() * ROWS)
      const cc = Math.floor(Math.random() * COLS)
      const pos = cellCenter(rr, cc)
      if (pos) engine?.burst(pos.x, pos.y, { count: 26, power: 460, sizeScale: 1.6, life: 1 })
    }
    audio.explode(5)
    haptic([20, 50, 20, 50, 20], props.vibrate)
    emit('gameover')
    busy = false
    return
  }

  if (!hasPossibleMove(grid.value)) {
    grid.value = newBoard()
    const mid = cellCenter(Math.floor(ROWS / 2), Math.floor(COLS / 2))
    if (mid) engine?.burst(mid.x, mid.y, { count: 26, power: 320 })
  }
  busy = false
}

/** 再来一局：清空棋盘/分数/目标进度（组件内重置，无需退出）。 */
function playAgain(): void {
  grid.value = newBoard()
  score.value = 0
  removedCount.value = 0
  finished.value = false
  selected.value = null
  pops.value = []
  flash.value = 0
  busy = false
  emit('score', 0)
  emit('combo', 0)
  haptic(8, props.vibrate)
}

watch(
  () => props.muted,
  (m) => audio.setMuted(m)
)

watch(
  () => props.particle,
  (p) => engine?.setManual(p)
)

watch(
  () => props.paused,
  (p) => {
    if (p) {
      selected.value = null
      down = null
      engine?.stop()
      audio.suspend()
    } else {
      audio.ensure()
      engine?.start()
    }
  }
)

onMounted(async () => {
  const canvas = canvasEl.value
  const root = rootEl.value
  if (!canvas) return
  engine = new NeonEngine(canvas, {
    manual: props.particle,
    beat: () => audio.beat(),
    onBackend: (k) => (backend.value = k)
  })
  try {
    await engine.init()
    engine.setPalette([...GEM_HUES])
    engine.start()
    if (root) root.dataset.backend = engine.backendKind
    backend.value = engine.backendKind
  } catch {
    backend.value = 'error'
  }

  ro = new ResizeObserver(() => engine?.resize())
  if (rootEl.value) ro.observe(rootEl.value)
})

onBeforeUnmount(() => {
  if (comboTimer) clearTimeout(comboTimer)
  if (flashTimer) clearTimeout(flashTimer)
  ro?.disconnect()
  engine?.dispose()
  engine = null
  audio.close()
})
</script>

<template>
  <div ref="rootEl" class="glow" data-backend="init">
    <canvas ref="canvasEl" class="fx"></canvas>

    <!-- 目标进度 HUD -->
    <div class="goal-hud">
      <div class="goal-label">目标：消除 {{ TARGET_REMOVED }} 块 · 还差 <b>{{ removedLeft }}</b></div>
      <div class="goal-bar"><i :style="{ width: progressPct + '%' }" /></div>
    </div>

    <div class="board-wrap">
      <div
        ref="boardEl"
        class="board"
        :class="{ invalid, done: finished }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="cancelPointer"
      >
        <template v-for="cell in cells" :key="cell.r + '-' + cell.c">
          <i
            class="gem"
            :class="{ sel: cell.sel }"
            :style="{
              background: cell.v
                ? `radial-gradient(circle at 32% 28%, hsl(${cell.hue},100%,78%), hsl(${cell.hue},95%,56%) 55%, hsl(${cell.hue},90%,46%))`
                : 'transparent',
              boxShadow: cell.v ? `0 0 10px hsla(${cell.hue},100%,62%,0.85), inset 0 0 6px hsla(${cell.hue},100%,85%,0.7)` : 'none'
            }"
          />
        </template>
        <!-- 格位扩散爆圈 -->
        <span
          v-for="p in pops"
          :key="p.id"
          class="pop"
          :class="{ big: p.big }"
          :style="{
            left: ((p.c + 0.5) / COLS) * 100 + '%',
            top: ((p.r + 0.5) / ROWS) * 100 + '%',
            borderColor: `hsl(${p.hue},100%,68%)`,
            boxShadow: `0 0 18px hsl(${p.hue},100%,66%)`
          }"
        />
      </div>
    </div>

    <!-- 全屏闪光 -->
    <div class="flash" :style="{ opacity: flash }" />

    <!-- 通关结算 -->
    <div v-if="finished" class="result">
      <div class="result-card">
        <div class="result-title">通关！</div>
        <p class="result-sub">已消除 {{ removedCount }} 块炫光宝石</p>
        <div class="result-score">{{ score }}</div>
        <button type="button" class="result-btn" @click="playAgain">↻ 再来一局</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.glow {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.fx {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}
.board-wrap {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    calc(env(safe-area-inset-top, 0px) + 92px)
    calc(env(safe-area-inset-right, 0px) + 14px)
    calc(env(safe-area-inset-bottom, 0px) + 20px)
    calc(env(safe-area-inset-left, 0px) + 14px);
  pointer-events: none;
}
.board {
  position: relative;
  pointer-events: auto;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  gap: 4px;
  width: min(86vw, 56vh, 440px);
  aspect-ratio: 1 / 1;
  padding: 8px;
  border-radius: 18px;
  background: rgba(10, 14, 30, 0.46);
  border: 1px solid rgba(130, 170, 255, 0.18);
  box-shadow: 0 0 40px rgba(60, 120, 255, 0.18) inset;
  touch-action: none;
}
.board.invalid {
  animation: nudge 0.2s ease;
}
.board.done {
  filter: saturate(0.7) brightness(0.55);
}
/* 目标进度 HUD */
.goal-hud {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 46px);
  left: 50%;
  transform: translateX(-50%);
  width: min(86vw, 440px);
  z-index: 6;
  text-align: center;
  pointer-events: none;
}
.goal-label {
  font-size: 13px;
  letter-spacing: 0.5px;
  color: #cfe0ff;
  text-shadow: 0 0 8px rgba(80, 150, 255, 0.7);
  margin-bottom: 5px;
}
.goal-label b {
  color: #ffe27a;
  font-size: 15px;
}
.goal-bar {
  height: 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
  border: 1px solid rgba(140, 180, 255, 0.25);
}
.goal-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #37e0ff, #8a5cff 55%, #ff5cc8);
  box-shadow: 0 0 12px rgba(120, 120, 255, 0.9);
  transition: width 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
/* 格位扩散爆圈 */
.pop {
  position: absolute;
  width: 12%;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 3px solid #fff;
  transform: translate(-50%, -50%) scale(0.4);
  pointer-events: none;
  z-index: 5;
  animation: popring 0.46s cubic-bezier(0.16, 0.84, 0.3, 1) forwards;
}
.pop.big {
  border-width: 4px;
  animation-duration: 0.62s;
}
@keyframes popring {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(0.4); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(2.7); }
}
/* 全屏闪光 */
.flash {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
  background: radial-gradient(circle at 50% 46%, rgba(255, 255, 255, 0.95), rgba(180, 220, 255, 0.5) 42%, rgba(120, 90, 255, 0) 78%);
  opacity: 0;
  transition: opacity 0.42s ease-out;
}
/* 通关结算 */
.result {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 8, 20, 0.55);
  backdrop-filter: blur(3px);
  padding: 20px;
}
.result-card {
  text-align: center;
  padding: 30px 34px 26px;
  border-radius: 22px;
  background: linear-gradient(160deg, rgba(28, 34, 66, 0.96), rgba(16, 20, 42, 0.96));
  border: 1px solid rgba(140, 180, 255, 0.35);
  box-shadow: 0 0 50px rgba(120, 90, 255, 0.45);
  animation: cardin 0.4s cubic-bezier(0.18, 0.9, 0.32, 1.2);
}
@keyframes cardin {
  from { opacity: 0; transform: scale(0.82) translateY(16px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.result-title {
  font-size: 30px;
  font-weight: 800;
  background: linear-gradient(90deg, #37e0ff, #8a5cff, #ff5cc8);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.result-sub { margin: 8px 0 2px; color: #cdd9f5; font-size: 14px; }
.result-score {
  font-size: 46px;
  font-weight: 800;
  color: #ffe27a;
  text-shadow: 0 0 18px rgba(255, 226, 122, 0.55);
  line-height: 1.2;
}
.result-btn {
  margin-top: 16px;
  border: 0;
  border-radius: 999px;
  padding: 12px 30px;
  font-size: 16px;
  font-weight: 700;
  color: #0a0e1e;
  background: linear-gradient(90deg, #37e0ff, #8a5cff);
  box-shadow: 0 6px 22px rgba(90, 120, 255, 0.5);
  cursor: pointer;
}
.gem {
  border-radius: 22%;
  transition:
    transform 0.12s ease,
    filter 0.12s ease,
    outline-color 0.12s ease;
  outline: 2px solid transparent;
  outline-offset: 1px;
}
.gem:active {
  transform: scale(0.9);
}
.gem.sel {
  transform: scale(1.08);
  outline-color: rgba(255, 255, 255, 0.95);
  filter: brightness(1.18) saturate(1.15);
}
@keyframes nudge {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}
</style>
