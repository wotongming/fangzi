<script setup lang="ts">
/**
 * 星轨穿梭（Orbit Surge）—— 单指在屏幕任意位置按住/拖动，光体横向跟随，
 * 穿越不断加速下落的粒子障碍。障碍为 DOM 霓虹体，环境星流与撞击爆发走 NeonEngine。
 * 全程本地、无网络。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NeonEngine } from '../../engine/neon-engine'
import { NeonAudio, haptic } from '../../audio/synth'
import { PLAYER_Y, newSurge, setTarget, update, type SurgeState } from './logic'

const props = withDefaults(
  defineProps<{
    paused?: boolean
    muted?: boolean
    vibrate?: boolean
    particle?: 'auto' | 'high' | 'low'
  }>(),
  { paused: false, muted: false, vibrate: true, particle: 'auto' }
)

const emit = defineEmits<{ (e: 'score', v: number): void; (e: 'combo', v: number): void }>()

const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const fieldEl = ref<HTMLDivElement | null>(null)
const st = ref<SurgeState>(newSurge(0))
const backend = ref('init')
let engine: NeonEngine | null = null
const audio = new NeonAudio()
audio.setMuted(props.muted)
let raf = 0
let last = 0
let lastScore = -1
let starAcc = 0
let ro: ResizeObserver | null = null
let dragging = false
let alive = true
/** 游戏场 CSS 像素尺寸，用于把归一化坐标换算成像素做精确碰撞（ResizeObserver 维护）。 */
let viewW = 0
let viewH = 0

function measureView(): void {
  const el = fieldEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  viewW = r.width
  viewH = r.height
}

function xFromEvent(clientX: number): number {
  const el = fieldEl.value
  if (!el) return 0.5
  const r = el.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
}

function onDown(e: PointerEvent): void {
  audio.ensure()
  if (st.value.over) return
  dragging = true
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  setTarget(st.value, xFromEvent(e.clientX))
}
function onMove(e: PointerEvent): void {
  if (!dragging || st.value.over) return
  setTarget(st.value, xFromEvent(e.clientX))
}
function onUp(): void {
  dragging = false
}

/** 用引擎在顶部持续生成向下的微弱光粒，形成“穿越星场”的速度感（纯 GPU，无素材）。 */
function emitStarfield(dt: number): void {
  const canvas = canvasEl.value
  if (!canvas || !engine) return
  starAcc += dt
  const interval = 0.05
  while (starAcc >= interval) {
    starAcc -= interval
    const r = canvas.getBoundingClientRect()
    engine.burst(Math.random() * r.width, 4, {
      count: 1,
      power: 70 + Math.random() * 60,
      hue: 200 + Math.random() * 80,
      radial: false,
      dir: Math.PI / 2,
      sizeScale: 0.5,
      life: 1.1
    })
  }
}

function loop(now: number): void {
  if (!raf) return
  if (!last) last = now
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  if (!props.paused && !st.value.over) {
    emitStarfield(dt)
    const res = update(st.value, dt, { w: viewW, h: viewH })
    if (st.value.score !== lastScore) {
      lastScore = st.value.score
      emit('score', st.value.score)
    }
    if (res.crashed) {
      const canvas = canvasEl.value
      if (canvas) {
        const r = canvas.getBoundingClientRect()
        engine?.burst(st.value.px * r.width, PLAYER_Y * r.height, {
          count: 40,
          power: 360,
          sizeScale: 1.2
        })
      }
      engine?.setShake(12)
      audio.explode(3)
      haptic([20, 40, 20], props.vibrate)
    }
  }
  raf = requestAnimationFrame(loop)
}

function restart(): void {
  st.value = newSurge(st.value.best)
  lastScore = 0
  emit('score', 0)
  emit('combo', 0)
  last = 0
  dragging = false
  audio.ensure()
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
      dragging = false
      audio.suspend()
    } else {
      audio.ensure()
      last = 0
    }
  }
)

onMounted(async () => {
  const canvas = canvasEl.value
  if (!canvas) return
  engine = new NeonEngine(canvas, { manual: props.particle, beat: () => audio.beat() })
  try {
    await engine.init()
    engine.setPalette([190, 264, 326, 46])
    backend.value = engine.backendKind
    if (rootEl.value) {
      rootEl.value.dataset.backend = engine.backendKind
      rootEl.value.dataset.px = '0.5'
    }
  } catch {
    backend.value = 'error'
  }
  ro = new ResizeObserver(() => {
    measureView()
    engine?.resize()
  })
  measureView()
  if (rootEl.value) ro.observe(rootEl.value)
  // 同步 px 给 E2E/调试读（组件卸载后停止，避免 rAF 泄漏）。
  const sync = (): void => {
    if (!alive) return
    if (rootEl.value) rootEl.value.dataset.px = st.value.px.toFixed(3)
    requestAnimationFrame(sync)
  }
  requestAnimationFrame(sync)
  last = 0
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  alive = false
  raf = 0
  ro?.disconnect()
  engine?.dispose()
  engine = null
  audio.close()
})
</script>

<template>
  <div ref="rootEl" class="surge" data-backend="init" data-px="0.5">
    <canvas ref="canvasEl" class="fx"></canvas>

    <div
      ref="fieldEl"
      class="field"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <!-- 下落障碍（DOM 固定 34px，判定半径在纯逻辑里按归一化计算，二者解耦） -->
      <i
        v-for="o in st.obs"
        :key="o.id"
        class="orb enemy"
        :style="{
          left: `${o.x * 100}%`,
          top: `calc(${o.y * 100}% - 17px)`
        }"
      />
      <!-- 玩家光体 -->
      <i
        class="orb player"
        :style="{
          left: `calc(${st.px * 100}% - 18px)`,
          top: `calc(${PLAYER_Y * 100}% - 18px)`
        }"
      />
    </div>

    <p v-if="!st.over" class="hint">按住并左右拖动，躲避光障</p>

    <div v-if="st.over" class="over">
      <div class="over-card">
        <h3>撞碎了</h3>
        <p class="over-score">{{ st.score }}</p>
        <p class="faint">最高 {{ st.best }}</p>
        <button class="over-btn" @pointerdown="restart">↻ 再来一局</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.surge {
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
.field {
  position: absolute;
  inset: 0;
  touch-action: none;
}
.orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.orb.player {
  width: 36px;
  height: 36px;
  background: radial-gradient(circle at 35% 30%, #eafaff, #39d0ff 55%, #1b7cff);
  box-shadow:
    0 0 22px rgba(80, 200, 255, 0.95),
    0 0 46px rgba(60, 140, 255, 0.5);
}
.orb.enemy {
  background: radial-gradient(circle at 36% 32%, #ffe9f6, #ff5fb0 55%, #b026ff);
  box-shadow:
    0 0 18px rgba(255, 95, 176, 0.9),
    0 0 40px rgba(176, 38, 255, 0.55);
  /* 尺寸用 vmin 会随视口短边变化，这里用固定像素保证判定与观感一致（覆盖内联 vmin）。 */
  width: 34px;
  height: 34px;
  transform: translateX(-50%);
  margin-left: 0;
}
.hint {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
  left: 0;
  right: 0;
  text-align: center;
  color: rgba(200, 220, 255, 0.5);
  font-size: 13px;
  pointer-events: none;
}
.over {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 6, 13, 0.72);
  backdrop-filter: blur(6px);
}
.over-card {
  text-align: center;
  color: #eaf2ff;
  padding: 24px 34px;
}
.over-card h3 {
  margin: 0 0 6px;
  font-size: 20px;
}
.over-score {
  font-size: 52px;
  font-weight: 800;
  margin: 4px 0;
  text-shadow: 0 0 18px rgba(120, 200, 255, 0.8);
}
.faint {
  color: #9fb4d8;
  margin: 0 0 16px;
}
.over-btn {
  padding: 12px 26px;
  border-radius: 999px;
  border: 1px solid rgba(150, 190, 255, 0.4);
  background: linear-gradient(135deg, rgba(90, 140, 255, 0.35), rgba(180, 90, 255, 0.35));
  color: #fff;
  font-size: 16px;
}
</style>
