<script setup lang="ts">
/**
 * 炫光连消（Glow Match）—— GPU 炫光表现层。
 *
 * 玩法判定全部来自 ./logic（复用 match3-core）；本组件只负责：
 * 滑动/拖拽输入、霓虹宝石渲染、在精确格位驱动 NeonEngine 粒子爆发/震屏、合成音效与振动。
 * 棋盘为居中 DOM 网格（清晰可读），特效由全屏 canvas 在其下层渲染，沉浸且不挡操作。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NeonEngine } from '../../engine/neon-engine'
import { NeonAudio, haptic } from '../../audio/synth'
import { NEON_STAGE_KEY } from '../../components/neonStageKey'
import {
  COLS,
  GEM_HUES,
  ROWS,
  hasPossibleMove,
  newBoard,
  tryMove
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
}>()

const stageApi = inject(NEON_STAGE_KEY, null)
const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const boardEl = ref<HTMLDivElement | null>(null)
const grid = ref<Grid>(newBoard())
const score = ref(0)
const backend = ref('init')
const invalid = ref(false)
let busy = false
let engine: NeonEngine | null = null
const audio = new NeonAudio()
audio.setMuted(props.muted)
let ro: ResizeObserver | null = null
let comboTimer: ReturnType<typeof setTimeout> | null = null
let down: { r: number; c: number; x: number; y: number } | null = null

const cells = computed(() => {
  const out: Array<{ r: number; c: number; v: number; hue: number }> = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = grid.value[r]?.[c] ?? 0
      out.push({ r, c, v, hue: GEM_HUES[(v - 1 + GEM_HUES.length) % GEM_HUES.length] ?? 188 })
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
  const cell = cellFromPoint(e.clientX, e.clientY)
  if (!cell) return
  down = { ...cell, x: e.clientX, y: e.clientY }
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
}

async function onPointerUp(e: PointerEvent): Promise<void> {
  if (!down || busy) {
    down = null
    return
  }
  const start = down
  down = null
  const end = cellFromPoint(e.clientX, e.clientY)
  let target: { r: number; c: number } | null = null
  if (end && (end.r !== start.r || end.c !== start.c)) {
    target = end
  } else {
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.hypot(dx, dy) < 10) {
      // 轻点（未拖动）→ 唤出控制浮层，不触发消除
      stageApi?.toggleMenu()
      return
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      const c = start.c + (dx > 0 ? 1 : -1)
      if (c >= 0 && c < COLS) target = { r: start.r, c }
    } else {
      const r = start.r + (dy > 0 ? 1 : -1)
      if (r >= 0 && r < ROWS) target = { r, c: start.c }
    }
  }
  if (!target) return
  await attemptMove([start.r, start.c], [target.r, target.c])
}

async function attemptMove(a: [number, number], b: [number, number]): Promise<void> {
  if (busy) return
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

  // 精确格位粒子爆发 + 连锁震屏/音效
  for (const cell of result.cells) {
    const pos = cellCenter(cell.r, cell.c)
    if (pos) {
      engine?.burst(pos.x, pos.y, {
        count: 12,
        power: 200 + result.waves * 40,
        hue: cell.hue,
        sizeScale: 1
      })
    }
  }
  engine?.setShake(5 + result.waves * 4)
  if (result.waves >= 2) {
    audio.explode(result.waves)
    haptic([14, 30, 14], props.vibrate)
  } else {
    audio.blip(result.waves - 1)
    haptic(10, props.vibrate)
  }

  grid.value = result.grid
  score.value += result.gained
  emit('score', score.value)
  if (result.waves >= 2) {
    emit('combo', result.waves)
    if (comboTimer) clearTimeout(comboTimer)
    comboTimer = setTimeout(() => emit('combo', 0), 1100)
  }

  if (!hasPossibleMove(grid.value)) {
    grid.value = newBoard()
    const mid = cellCenter(Math.floor(ROWS / 2), Math.floor(COLS / 2))
    if (mid) engine?.burst(mid.x, mid.y, { count: 26, power: 320 })
  }
  busy = false
}

watch(
  () => props.muted,
  (m) => audio.setMuted(m)
)

watch(
  () => props.paused,
  (p) => {
    if (p) {
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
  ro?.disconnect()
  engine?.dispose()
  engine = null
  audio.close()
})
</script>

<template>
  <div ref="rootEl" class="glow" data-backend="init">
    <canvas ref="canvasEl" class="fx"></canvas>
    <div class="board-wrap">
      <div
        ref="boardEl"
        class="board"
        :class="{ invalid }"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
      >
        <template v-for="cell in cells" :key="cell.r + '-' + cell.c">
          <i
            class="gem"
            :style="{
              background: cell.v
                ? `radial-gradient(circle at 32% 28%, hsl(${cell.hue},100%,78%), hsl(${cell.hue},95%,56%) 55%, hsl(${cell.hue},90%,46%))`
                : 'transparent',
              boxShadow: cell.v ? `0 0 10px hsla(${cell.hue},100%,62%,0.85), inset 0 0 6px hsla(${cell.hue},100%,85%,0.7)` : 'none'
            }"
          />
        </template>
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
    calc(env(safe-area-inset-top, 0px) + 64px)
    calc(env(safe-area-inset-right, 0px) + 14px)
    calc(env(safe-area-inset-bottom, 0px) + 20px)
    calc(env(safe-area-inset-left, 0px) + 14px);
  pointer-events: none;
}
.board {
  pointer-events: auto;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  gap: 4px;
  width: min(86vw, 58vh, 440px);
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
.gem {
  border-radius: 22%;
  transition: transform 0.12s ease;
}
.gem:active {
  transform: scale(0.9);
}
@keyframes nudge {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}
</style>
