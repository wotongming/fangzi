<script setup lang="ts">
/**
 * 霓虹脉冲（Neon Pulse）—— 三轨下落节奏。
 * 纯逻辑见 ./logic；本组件负责 RAF 驱动、轨道渲染、触摸/点击输入，
 * 命中在判定线处用 NeonEngine 爆发粒子、合成音效与振动。全程本地、无网络。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NeonEngine } from '../../engine/neon-engine'
import { NeonAudio, haptic } from '../../audio/synth'
import {
  HIT_Y,
  LANES,
  MAX_MISS,
  hitLane,
  newPulse,
  update,
  type PulseState
} from './logic'

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

const LANE_HUES = [188, 326, 46]
function hueOf(lane: number): number {
  return LANE_HUES[lane] ?? 188
}
const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const st = ref<PulseState>(newPulse(0))
const backend = ref('init')
const flash = ref<number[]>([])
let engine: NeonEngine | null = null
const audio = new NeonAudio()
audio.setMuted(props.muted)
let raf = 0
let last = 0
let ro: ResizeObserver | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null

function burstAt(lane: number, yRatio: number, hue: number, power: number, count = 16): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const r = canvas.getBoundingClientRect()
  engine?.burst((lane + 0.5) / LANES * r.width, yRatio * r.height, {
    count,
    power,
    hue,
    sizeScale: 1
  })
}

function setFlash(lane: number): void {
  flash.value = [lane]
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = []), 160)
}

function loop(now: number): void {
  if (!raf) return
  if (!last) last = now
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  if (!props.paused && !st.value.over) {
    const res = update(st.value, dt)
    if (res.missed > 0) {
      emit('combo', 0)
      audio.pulse(0.55)
      haptic(20, props.vibrate)
      engine?.setShake(4)
    }
    if (st.value.over) {
      emit('score', st.value.score)
      engine?.setShake(10)
      burstAt(1, HIT_Y, 0, 320, 30)
      audio.explode(2)
    }
  }
  raf = requestAnimationFrame(loop)
}

function tapLane(lane: number): void {
  audio.ensure()
  if (props.paused || st.value.over) return
  const r = hitLane(st.value, lane)
  if (r.kind === 'empty') {
    // 空击给极轻反馈，不打断节奏、不扣分。
    audio.blip(0)
    return
  }
  setFlash(lane)
  const perfect = r.kind === 'perfect'
  burstAt(lane, HIT_Y, hueOf(lane), perfect ? 280 : 200, perfect ? 22 : 14)
  engine?.setShake(perfect ? 6 : 3)
  audio.hit(perfect)
  haptic(perfect ? 14 : 8, props.vibrate)
  emit('score', st.value.score)
  emit('combo', st.value.combo)
}

function onPointerDown(e: PointerEvent, lane: number): void {
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  tapLane(lane)
}

function restart(): void {
  st.value = newPulse(st.value.best)
  emit('score', 0)
  emit('combo', 0)
  last = 0
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
    if (p) audio.suspend()
    else {
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
    engine.setPalette([...LANE_HUES])
    backend.value = engine.backendKind
    if (rootEl.value) rootEl.value.dataset.backend = engine.backendKind
  } catch {
    backend.value = 'error'
  }
  ro = new ResizeObserver(() => engine?.resize())
  if (rootEl.value) ro.observe(rootEl.value)
  last = 0
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  raf = 0
  if (flashTimer) clearTimeout(flashTimer)
  ro?.disconnect()
  engine?.dispose()
  engine = null
  audio.close()
})

function noteStyle(lane: number, y: number): Record<string, string> {
  return {
    left: `calc(${(lane / LANES) * 100}% + 6px)`,
    width: `calc(${100 / LANES}% - 12px)`,
    top: `calc(${y * 100}% - 14px)`
  }
}
</script>

<template>
  <div ref="rootEl" class="pulse" data-backend="init">
    <canvas ref="canvasEl" class="fx"></canvas>

    <!-- 三轨触摸区 -->
    <div class="lanes">
      <button
        v-for="lane in LANES"
        :key="lane - 1"
        class="lane"
        :class="{ flash: flash.includes(lane - 1) }"
        @pointerdown="(e) => onPointerDown(e, lane - 1)"
      >
        <span class="lane-glow" :style="{ background: `hsl(${hueOf(lane - 1)},95%,60%)` }" />
      </button>
    </div>

    <!-- 判定线 -->
    <div class="hitline" :style="{ top: `${HIT_Y * 100}%` }">
      <i v-for="lane in LANES" :key="`h${lane}`" :style="{ background: `hsl(${LANE_HUES[lane - 1]},90%,62%)` }" />
    </div>

    <!-- 下落音符 -->
    <div class="notes">
      <i
        v-for="n in st.notes"
        :key="n.id"
        class="note"
        :style="{ ...noteStyle(n.lane, n.y), background: `hsl(${LANE_HUES[n.lane]},95%,60%)`, boxShadow: `0 0 14px hsl(${LANE_HUES[n.lane]},95%,60%)` }"
      />
    </div>

    <!-- 漏击指示 -->
    <div class="miss-dots">
      <i v-for="i in MAX_MISS" :key="i" :class="{ lost: st.misses >= i }" />
    </div>

    <!-- 结束遮罩 -->
    <div v-if="st.over" class="over">
      <div class="over-card">
        <h3>演奏结束</h3>
        <p class="over-score">{{ st.score }}</p>
        <p class="faint">最高 {{ st.best }}</p>
        <button class="over-btn" @pointerdown="restart">↻ 再来一首</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pulse {
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
.lanes {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding:
    calc(env(safe-area-inset-top, 0px) + 56px)
    0
    calc(env(safe-area-inset-bottom, 0px) + 12px);
}
.lane {
  border: 0;
  background: transparent;
  position: relative;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.lane + .lane {
  border-left: 1px solid rgba(140, 170, 255, 0.12);
}
.lane-glow {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
  height: 8px;
  border-radius: 999px;
  opacity: 0.28;
  filter: blur(0.4px);
}
.lane.flash .lane-glow {
  opacity: 0.95;
  box-shadow: 0 0 26px 4px currentColor;
}
.hitline {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  transform: translateY(-50%);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  pointer-events: none;
}
.hitline i {
  margin: 0 10px;
  border-radius: 999px;
  opacity: 0.55;
}
.notes {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.note {
  position: absolute;
  height: 26px;
  border-radius: 10px;
}
.miss-dots {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 62px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  pointer-events: none;
}
.miss-dots i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
}
.miss-dots i.lost {
  background: #ff5f6d;
  box-shadow: 0 0 10px rgba(255, 95, 109, 0.9);
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
