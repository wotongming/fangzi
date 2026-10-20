<script setup lang="ts">
/**
 * 霓虹脉冲（Neon Pulse）—— 三轨下落节奏。
 * 纯逻辑见 ./logic；本组件负责 RAF 驱动、轨道渲染、触摸/点击输入，
 * 命中在判定线处用 NeonEngine 爆发粒子、合成音效与振动。全程本地、无网络。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NeonEngine } from '../../engine/neon-engine'
import { NeonAudio, haptic } from '../../audio/synth'
import { SONGS, midiToFreq, songOf } from './melodies'
import {
  HIT_Y,
  LANES,
  MAX_MISS,
  hitLane,
  newPulse,
  newPulseFromSong,
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

const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'combo', v: number): void
  (e: 'gameover'): void
}>()

const LANE_HUES = [188, 326, 46]
function hueOf(lane: number): number {
  return LANE_HUES[lane] ?? 188
}
const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const st = ref<PulseState>(newPulse(0))
const backend = ref('init')
const flash = ref<number[]>([])
/** 是否处于选曲页（开局前/换曲时）。 */
const picking = ref(true)
/** 当前选中曲目 id；'random' 为原随机脉冲模式。 */
const songId = ref<string>('twinkle')
const songs = SONGS
let engine: NeonEngine | null = null
const audio = new NeonAudio()
audio.setMuted(props.muted)
let raf = 0
let last = 0
let ro: ResizeObserver | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null
let overNotified = false

function burstAt(lane: number, yRatio: number, hue: number, power: number, count = 16): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const r = canvas.getBoundingClientRect()
  engine?.burst(((lane + 0.5) / LANES) * r.width, yRatio * r.height, {
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
  if (!props.paused && !picking.value && !st.value.over) {
    const res = update(st.value, dt)
    if (res.missed > 0) {
      emit('combo', 0)
      audio.pulse(0.55)
      haptic(20, props.vibrate)
      engine?.setShake(4)
    }
    if (st.value.over && !overNotified) {
      overNotified = true
      emit('score', st.value.score)
      emit('gameover')
      engine?.setShake(10)
      burstAt(1, HIT_Y, st.value.win ? 152 : 0, 320, 30)
      audio.explode(2)
    }
  }
  raf = requestAnimationFrame(loop)
}

function tapLane(lane: number): void {
  audio.ensure()
  if (props.paused || picking.value || st.value.over) return
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
  // 谱面模式：命中即奏响对应旋律音符；随机模式沿用命中音效。
  if (st.value.mode === 'song' && r.note?.midi != null) {
    audio.tone(midiToFreq(r.note.midi), perfect)
  } else {
    audio.hit(perfect)
  }
  haptic(perfect ? 14 : 8, props.vibrate)
  emit('score', st.value.score)
  emit('combo', st.value.combo)
}

function onPointerDown(e: PointerEvent, lane: number): void {
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  tapLane(lane)
}

/** 按所选曲目（或随机模式）开局。 */
function startGame(id: string): void {
  audio.ensure()
  songId.value = id
  overNotified = false
  if (id === 'random') {
    st.value = newPulse(st.value.best)
  } else {
    const song = songOf(id)
    st.value = newPulseFromSong(st.value.best, song.name, song.notes, song.beat)
  }
  picking.value = false
  emit('score', 0)
  emit('combo', 0)
  last = 0
}

/** 再来一首：沿用当前模式重开。 */
function restart(): void {
  startGame(songId.value)
}

/** 返回选曲页。 */
function backToPicker(): void {
  picking.value = true
  st.value = newPulse(st.value.best)
  emit('score', 0)
  emit('combo', 0)
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

    <!-- 漏击指示（仅随机模式显示 3 心） -->
    <div v-if="st.mode === 'random'" class="miss-dots">
      <i v-for="i in MAX_MISS" :key="i" :class="{ lost: st.misses >= i }" />
    </div>
    <!-- 谱面模式：当前曲名 -->
    <div v-else-if="!picking" class="song-tag">♪ {{ st.songName }}</div>

    <!-- 选曲页 -->
    <div v-if="picking" class="picker">
      <div class="picker-card">
        <h3 class="picker-title">霓虹脉冲</h3>
        <p class="picker-sub">跟着经典旋律的节奏点按光轨</p>
        <div class="song-list">
          <button
            v-for="s in songs"
            :key="s.id"
            type="button"
            class="song-btn"
            :class="{ active: songId === s.id }"
            @pointerdown="startGame(s.id)"
          >
            <span class="song-name">♪ {{ s.name }}</span>
            <span class="song-desc">{{ s.desc }}</span>
          </button>
          <button
            type="button"
            class="song-btn random"
            :class="{ active: songId === 'random' }"
            @pointerdown="startGame('random')"
          >
            <span class="song-name">∞ 自由脉冲</span>
            <span class="song-desc">随机节奏 · 无限下落</span>
          </button>
        </div>
        <p class="picker-note">经典曲目均为公有领域旋律，由本机实时合成演奏</p>
      </div>
    </div>

    <!-- 结束遮罩 -->
    <div v-else-if="st.over" class="over">
      <div class="over-card">
        <h3>{{ st.win ? '演奏完成 🎵' : '演奏结束' }}</h3>
        <p class="over-score">{{ st.score }}</p>
        <p class="faint">最高 {{ st.best }}</p>
        <div class="over-actions">
          <button class="over-btn" @pointerdown="restart">↻ 再来一首</button>
          <button class="over-btn ghost" @pointerdown="backToPicker">♫ 换一首</button>
        </div>
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
.over-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.over-btn {
  padding: 12px 26px;
  border-radius: 999px;
  border: 1px solid rgba(150, 190, 255, 0.4);
  background: linear-gradient(135deg, rgba(90, 140, 255, 0.35), rgba(180, 90, 255, 0.35));
  color: #fff;
  font-size: 16px;
}
.over-btn.ghost {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(150, 190, 255, 0.22);
  color: #cdd9f5;
}

/* 当前曲名 */
.song-tag {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 60px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 14px;
  letter-spacing: 1px;
  color: #d7e6ff;
  text-shadow: 0 0 10px rgba(120, 170, 255, 0.8);
  pointer-events: none;
  white-space: nowrap;
}

/* 选曲页 */
.picker {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    calc(env(safe-area-inset-top, 0px) + 20px)
    18px
    calc(env(safe-area-inset-bottom, 0px) + 20px);
  background: radial-gradient(circle at 50% 30%, rgba(40, 30, 80, 0.82), rgba(6, 8, 20, 0.94));
  backdrop-filter: blur(6px);
  overflow-y: auto;
}
.picker-card {
  width: min(92vw, 420px);
  text-align: center;
  color: #eaf2ff;
}
.picker-title {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  background: linear-gradient(90deg, #37e0ff, #b06cff, #ff5cc8);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.picker-sub {
  margin: 6px 0 18px;
  color: #aebfe0;
  font-size: 14px;
}
.song-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.song-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 13px 18px;
  border-radius: 16px;
  border: 1px solid rgba(140, 180, 255, 0.22);
  background: rgba(255, 255, 255, 0.05);
  color: #eaf2ff;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}
.song-btn:active {
  transform: scale(0.97);
}
.song-btn.active {
  border-color: rgba(120, 200, 255, 0.8);
  background: linear-gradient(135deg, rgba(70, 140, 255, 0.28), rgba(180, 90, 255, 0.28));
  box-shadow: 0 0 22px rgba(120, 120, 255, 0.35);
}
.song-name {
  font-size: 17px;
  font-weight: 700;
}
.song-desc {
  font-size: 12.5px;
  color: #9fb4d8;
}
.song-btn.random .song-name {
  color: #b9a8ff;
}
.picker-note {
  margin: 16px 0 0;
  font-size: 11.5px;
  color: #7e8fb3;
  line-height: 1.5;
}
</style>
