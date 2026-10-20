<script setup lang="ts">
/**
 * 合成大星球（Merge Planet）—— matter.js 真实物理 + Canvas2D 程序化美术。
 *
 * 玩法：顶部滑轨瞄准投放星球，两颗同级接触合成更高一级；连锁连击加分；
 * 合成黑洞（终极）通关大爆发；球体越过警戒线并持续约 1.75s 判负（瞬时擦过不算）。
 * 纯玩法判定在 ./game/logic；本组件负责物理世界、渲染、输入、音效与结算。
 * 全部本地打包（matter.js 进本地 chunk 并被 PWA 预缓存），断网可玩，零素材/零版权。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as Matter from 'matter-js'
import { NeonAudio, haptic } from '../../audio/synth'
import {
  TIERS,
  FINAL_TIER,
  COMBO_WINDOW_MS,
  sameTier,
  nextTierIndex,
  isFinal,
  mergeScore,
  rollSpawnTier,
  canDrop,
  createOverline,
  updateOverline,
  clampAim,
  type OverlineState
} from './game/logic'
import { makeStarfield, drawSpaceBackground, paintPlanet, hash01, type Star } from './game/render'

const props = withDefaults(
  defineProps<{
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

// —— 物理常量（真实细腻、堆叠稳定、不狂弹）——
const FIXED_MS = 1000 / 60
const POSITION_ITER = 10
const VELOCITY_ITER = 8
const RESTITUTION = 0.22
const FRICTION = 0.12
const FRICTION_AIR = 0.016
/** 合并允许的最大相对速度（px/帧），高速撞击不合并避免误触发 */
const MERGE_MAX_SPEED = 5
const WALL = 26

interface Planet {
  body: Matter.Body
  tier: number
  bornAt: number
  seed: number
}

const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

let engine: Matter.Engine | null = null
let walls: Matter.Body[] = []
let planets = new Map<number, Planet>()
let stars: Star[] = []
let W = 0
let H = 0
let railH = 0

// —— 对局状态 ——
const phase = ref<'play' | 'win' | 'lose'>('play')
const score = ref(0)
const combo = ref(0)
let currentTier = 0
let nextTier = 1
const currentName = ref('')
const nextName = ref('')
let aimX = 0
let lastDropAt = -Infinity
let inFlight = false
let overline: OverlineState = createOverline()
let lastMergeAt = -Infinity
let comboTimer: ReturnType<typeof setTimeout> | null = null
let overNotified = false
let lastDropped: Planet | null = null

// —— 表现层 ——
interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number; hue: number; size: number
}
let particles: Particle[] = []
let shakeMag = 0
let warnBuzzAt = 0
let raf = 0
let last = 0
let acc = 0
let ro: ResizeObserver | null = null
const audio = new NeonAudio()
audio.setMuted(props.muted)

function cssOf(tier: number): { bg: string; color: string } {
  const t = TIERS[tier]!
  return {
    bg: `radial-gradient(circle at 32% 28%, hsl(${t.hue},${t.sat}%,${Math.min(86, t.light + 20)}%), hsl(${t.hue},${t.sat}%,${t.light}%) 58%, hsl(${t.hue},${t.sat}%,${Math.max(14, t.light - 24)}%))`,
    color: `hsl(${t.hue},${t.sat}%,82%)`
  }
}

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function radiusFor(tier: number): number {
  const t = TIERS[tier]!
  const minR = clampNum(W * 0.04, 11, 18)
  const maxR = clampNum(W * 0.1, 26, 48)
  const f = (t.radius - 0.42) / (1.3 - 0.42)
  return minR + (maxR - minR) * f
}

function syncQueueLabels(): void {
  currentName.value = TIERS[currentTier]?.name ?? ''
  nextName.value = TIERS[nextTier]?.name ?? ''
}

// —— 物理世界搭建 ——
function buildWorld(): void {
  engine = Matter.Engine.create({ positionIterations: POSITION_ITER, velocityIterations: VELOCITY_ITER })
  engine.gravity.y = 1
  rebuildWalls()
}

function rebuildWalls(): void {
  if (!engine) return
  for (const w of walls) Matter.Composite.remove(engine.world, w)
  walls = []
  const opt = { isStatic: true, friction: 0.1, restitution: 0.1, label: 'wall' }
  const left = Matter.Bodies.rectangle(-WALL / 2, H / 2, WALL, H * 3, opt)
  const right = Matter.Bodies.rectangle(W + WALL / 2, H / 2, WALL, H * 3, opt)
  const bottom = Matter.Bodies.rectangle(W / 2, H + WALL / 2, W * 3, WALL, opt)
  walls = [left, right, bottom]
  Matter.Composite.add(engine.world, walls)
}

function spawnPlanet(tier: number, x: number, y: number, pop = true): Planet {
  const r = radiusFor(tier)
  const body = Matter.Bodies.circle(x, y, r, {
    label: 'planet',
    friction: FRICTION,
    frictionAir: FRICTION_AIR,
    restitution: RESTITUTION,
    density: 0.0014,
    plugin: { tier }
  })
  const seed = Math.floor(body.id * 977 + tier * 31)
  if (!pop) Matter.Body.setVelocity(body, { x: 0, y: 0 })
  const p: Planet = { body, tier, bornAt: performance.now(), seed }
  planets.set(body.id, p)
  Matter.Composite.add(engine!.world, body)
  return p
}

// —— 合并扫描（每固定步后，处理同级重叠 + 低速）——
function scanMerges(): void {
  if (!engine) return
  const list = [...planets.values()]
  const remove = new Set<number>()
  const now = performance.now()
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!
    if (remove.has(a.body.id)) continue
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!
      if (remove.has(b.body.id)) continue
      if (!sameTier(a.tier, b.tier)) continue
      const dx = a.body.position.x - b.body.position.x
      const dy = a.body.position.y - b.body.position.y
      const ra = radiusFor(a.tier)
      const rb = radiusFor(b.tier)
      const dist = Math.hypot(dx, dy)
      // 相切/微渗透即合并（matter 会把完全重叠解到相切，给足接触容差）
      if (dist > (ra + rb) * 1.06) continue
      const rvx = a.body.velocity.x - b.body.velocity.x
      const rvy = a.body.velocity.y - b.body.velocity.y
      if (Math.hypot(rvx, rvy) > MERGE_MAX_SPEED) continue

      const produced = nextTierIndex(a.tier)
      if (produced === null) continue
      const mx = (a.body.position.x + b.body.position.x) / 2
      const my = (a.body.position.y + b.body.position.y) / 2
      remove.add(a.body.id)
      remove.add(b.body.id)

      // 连击窗口内连锁
      combo.value = now - lastMergeAt <= COMBO_WINDOW_MS ? combo.value + 1 : 1
      lastMergeAt = now
      const gained = mergeScore(produced, combo.value)
      score.value += gained
      emit('score', score.value)
      emit('combo', combo.value)
      if (comboTimer) clearTimeout(comboTimer)
      comboTimer = setTimeout(() => emit('combo', 0), 1100)

      burst(mx, my, produced, combo.value)
      audio.blip(Math.min(9, combo.value - 1))
      haptic(combo.value > 1 ? [14, 30, 14] : 10, props.vibrate)
      shakeMag = Math.min(14, 5 + combo.value * 2)

      Matter.Composite.remove(engine.world, a.body)
      Matter.Composite.remove(engine.world, b.body)
      planets.delete(a.body.id)
      planets.delete(b.body.id)

      const np = spawnPlanet(produced, mx, my)
      Matter.Body.setVelocity(np.body, { x: (rvx) * -0.02, y: -0.6 })

      if (isFinal(produced)) {
        onWin(mx, my)
        return
      }
      break
    }
  }
}

function burst(x: number, y: number, tier: number, combo: number): void {
  const t = TIERS[tier]!
  const n = Math.min(34, 14 + combo * 4)
  for (let i = 0; i < n; i++) {
    const a = hash01(i * 13 + tier * 7) * Math.PI * 2
    const sp = 60 + hash01(i * 17 + combo) * 220
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40,
      life: 0,
      maxLife: 0.5 + hash01(i * 3) * 0.35,
      hue: t.hue,
      size: 1.5 + hash01(i * 5) * 2.5
    })
  }
}

function onWin(x: number, y: number): void {
  phase.value = 'win'
  overNotified = true
  for (let k = 0; k < 6; k++) burst(x, y, FINAL_TIER, 5)
  shakeMag = 18
  audio.explode(5)
  audio.tone(523.25, true)
  haptic([20, 50, 20, 50, 20], props.vibrate)
  emit('score', score.value)
  emit('gameover')
}

function onLose(): void {
  if (overNotified) return
  overNotified = true
  phase.value = 'lose'
  shakeMag = 10
  audio.explode(2)
  haptic([18, 40], props.vibrate)
  emit('score', score.value)
  emit('gameover')
}

// —— 投放 ——
function settleRange(): { min: number; max: number } {
  const r = radiusFor(currentTier)
  return { min: WALL + r, max: W - WALL - r }
}

function tryDrop(): void {
  if (phase.value !== 'play' || props.paused) return
  const now = performance.now()
  if (!canDrop(now, lastDropAt, inFlight)) return
  const { min, max } = settleRange()
  aimX = clampAim(aimX, min, max)
  const y = railH + radiusFor(currentTier) + 6
  const p = spawnPlanet(currentTier, aimX, y)
  lastDropped = p
  lastDropAt = now
  inFlight = true
  audio.blip(0)
  haptic(6, props.vibrate)
  currentTier = nextTier
  nextTier = rollSpawnTier()
  syncQueueLabels()
}

function aimTo(clientX: number): void {
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return
  const { min, max } = settleRange()
  aimX = clampAim(clientX - rect.left, min, max)
}

let dragging = false
function onPointerDown(e: PointerEvent): void {
  audio.ensure()
  if (phase.value !== 'play') return
  dragging = true
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  aimTo(e.clientX)
}
function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  aimTo(e.clientX)
}
function onPointerUp(): void {
  if (!dragging) return
  dragging = false
  tryDrop()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    aimX = clampAim(aimX - 16, settleRange().min, settleRange().max)
    e.preventDefault()
  } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    aimX = clampAim(aimX + 16, settleRange().min, settleRange().max)
    e.preventDefault()
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    audio.ensure()
    tryDrop()
  }
}

// —— 主循环：固定步长 + 子步 ——
function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  if (!last) last = now
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.05) dt = 0.05

  if (!props.paused && phase.value === 'play') {
    acc += dt * 1000
    let guard = 0
    while (acc >= FIXED_MS && guard++ < 8) {
      // 子步 ×2，抑制高速小球穿透
      Matter.Engine.update(engine!, FIXED_MS / 2)
      Matter.Engine.update(engine!, FIXED_MS / 2)
      acc -= FIXED_MS
      scanMerges()
    }
    // 落地占用释放
    if (inFlight && lastDropped) {
      const sp = lastDropped.body.speed
      const y = lastDropped.body.position.y
      const flown = now - lastDropped.bornAt
      if ((y > railH + 170 && sp < 2.5) || flown > 1200) {
        inFlight = false
        lastDropped = null
      }
    }
    // 越顶判定（debugAbove 为 E2E 接缝，模拟持续越线以走真实持续计时状态机）
    let anyAbove = debugAbove
    const lineY = railH + (H - railH) * 0.12
    if (!anyAbove) {
      for (const p of planets.values()) {
        if (p.body.position.y < lineY) { anyAbove = true; break }
      }
    }
    const r = updateOverline(overline, anyAbove, dt * 1000)
    if (r.warning && !r.dead && now - warnBuzzAt > 480) {
      warnBuzzAt = now
      audio.blip(0)
    }
    if (r.dead) onLose()
  }

  updateParticles(dt)
  shakeMag *= Math.exp(-7 * dt)
  render(now / 1000)
}

function updateParticles(dt: number): void {
  for (const p of particles) {
    p.life += dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vy += 160 * dt
    p.vx *= 0.98
  }
  particles = particles.filter((p) => p.life < p.maxLife)
}

// —— 渲染 ——
function render(timeSec: number): void {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || W === 0) return
  ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0)
  drawSpaceBackground(ctx, W, H, stars, timeSec)

  ctx.save()
  if (shakeMag > 0.2) {
    ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag)
  }

  // 警戒线（warning 时闪烁）
  const lineY = railH + (H - railH) * 0.12
  const warn = overline.timer > 0 && !overline.dead
  ctx.save()
  if (warn) {
    const blink = 0.45 + 0.4 * Math.sin(timeSec * 10)
    ctx.globalAlpha = blink
  }
  ctx.strokeStyle = 'rgba(255,96,96,0.7)'
  ctx.setLineDash([10, 8])
  ctx.lineWidth = 2
  ctx.shadowColor = 'rgba(255,80,80,0.8)'
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(WALL, lineY)
  ctx.lineTo(W - WALL, lineY)
  ctx.stroke()
  ctx.restore()

  // 星球（出生弹动缩放）
  for (const p of planets.values()) {
    const age = timeSec * 1000 - p.bornAt
    const pop = elasticPop(age)
    paintPlanet(ctx, p.tier, p.body.position.x, p.body.position.y, radiusFor(p.tier), {
      popScale: pop,
      timeSec,
      seed: p.seed
    })
  }

  // 粒子（加法辉光）
  ctx.globalCompositeOperation = 'lighter'
  for (const p of particles) {
    const k = 1 - p.life / p.maxLife
    ctx.globalAlpha = k * 0.9
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
    g.addColorStop(0, `hsla(${p.hue},100%,78%,0.9)`)
    g.addColorStop(1, `hsla(${p.hue},100%,60%,0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.restore()
  bindChrome()
}

function elasticPop(ageMs: number): number {
  if (ageMs < 0) return 1
  const T = 280
  if (ageMs >= T) return 1
  const k = ageMs / T
  return 1 + Math.sin(k * Math.PI) * 0.22 * (1 - k)
}

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2)
}

function resize(): void {
  const root = rootEl.value
  const canvas = canvasEl.value
  if (!root || !canvas) return
  const rect = root.getBoundingClientRect()
  W = rect.width
  H = rect.height
  railH = Math.min(84, Math.max(64, H * 0.1))
  canvas.width = Math.round(W * dpr())
  canvas.height = Math.round(H * dpr())
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`
  stars = makeStarfield(W, H)
  if (engine) rebuildWalls()
  if (!aimX) aimX = W / 2
  const { min, max } = settleRange()
  aimX = clampAim(aimX, min, max)
}

function reset(): void {
  if (engine) {
    for (const p of planets.values()) Matter.Composite.remove(engine.world, p.body)
    planets.clear()
  }
  score.value = 0
  combo.value = 0
  phase.value = 'play'
  overline = createOverline()
  overNotified = false
  lastMergeAt = -Infinity
  lastDropAt = -Infinity
  inFlight = false
  lastDropped = null
  particles = []
  currentTier = rollSpawnTier()
  nextTier = rollSpawnTier()
  syncQueueLabels()
  emit('score', 0)
  emit('combo', 0)
}

// —— E2E/调试接缝：window.__mergePlanet（不暴露任何 UI，仅供自动化确定性校验）——
let debugAbove = false
function exposeDebug(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__mergePlanet = {
    spawn: (tier: number, x?: number) => {
      const p = spawnPlanet(tier, x ?? aimX, railH + 46)
      return p.body.id
    },
    score: () => score.value,
    phase: () => phase.value,
    reset,
    aim: (x: number) => {
      const { min, max } = settleRange()
      aimX = clampAim(x, min, max)
    },
    holdAbove: (on: boolean) => {
      debugAbove = on
    }
  }
}

// —— 结算卡片样式绑定 ——
const aimStyle = ref<Record<string, string>>({})
const nextStyle = ref<Record<string, string>>({})
const guideStyle = ref<Record<string, string>>({})
function bindChrome(): void {
  const r = radiusFor(currentTier)
  const c = cssOf(currentTier)
  aimStyle.value = {
    left: `${aimX}px`,
    width: `${r * 2}px`,
    height: `${r * 2}px`,
    background: c.bg,
    marginLeft: `${-r}px`
  }
  const n = radiusFor(nextTier)
  const nc = cssOf(nextTier)
  nextStyle.value = {
    width: `${n * 1.6}px`,
    height: `${n * 1.6}px`,
    background: nc.bg
  }
  guideStyle.value = {
    left: `${aimX}px`,
    top: `${railH}px`,
    height: `${Math.max(0, H - railH)}px`
  }
}

watch(() => props.muted, (m) => audio.setMuted(m))
watch(
  () => props.paused,
  (p) => {
    if (p) {
      dragging = false
      audio.suspend()
    } else {
      audio.ensure()
    }
  }
)

onMounted(() => {
  buildWorld()
  currentTier = rollSpawnTier()
  nextTier = rollSpawnTier()
  syncQueueLabels()
  resize()
  aimX = W / 2
  exposeDebug()
  ro = new ResizeObserver(() => resize())
  if (rootEl.value) ro.observe(rootEl.value)
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (comboTimer) clearTimeout(comboTimer)
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
  if (engine) {
    Matter.Engine.clear(engine)
    engine = null
  }
  audio.close()
})
</script>

<template>
  <div
    ref="rootEl"
    class="mp"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="dragging = false"
  >
    <canvas ref="canvasEl" class="mp-canvas" />

    <!-- 顶部瞄准滑轨（待投球固定在顶部安全区，手指不压堆叠区） -->
    <div class="mp-rail">
      <div class="mp-next">
        <span class="mp-next-label">下一个</span>
        <span class="mp-mini" :style="nextStyle" />
        <span class="mp-next-name">{{ nextName }}</span>
      </div>
      <div class="mp-aim" :style="aimStyle">
        <span class="mp-aim-name">{{ currentName }}</span>
      </div>
    </div>
    <!-- 落点引导线（从顶部滑轨向下标出落点列） -->
    <div class="mp-guide" :style="guideStyle" />

    <!-- 结算 -->
    <div v-if="phase !== 'play'" class="mp-result">
      <div class="mp-card">
        <div class="mp-title">{{ phase === 'win' ? '黑洞诞生 · 通关！' : '堆叠过高 · 本局结束' }}</div>
        <p class="mp-sub">
          {{ phase === 'win' ? '你把一颗星球一路合成到了终极黑洞' : '星球越过警戒线太久，再放低一点、堆稳一点' }}
        </p>
        <div class="mp-score">{{ score }}</div>
        <button type="button" class="mp-btn" @click="reset">↻ 再来一局</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  background: #070b1c;
}
.mp-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

/* 顶部滑轨窄横条：待投球在安全区水平跟随，手指不遮落点 */
.mp-rail {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 6px);
  left: 0;
  right: 0;
  height: 76px;
  pointer-events: none;
  z-index: 5;
}
.mp-next {
  position: absolute;
  top: 8px;
  right: calc(env(safe-area-inset-right, 0px) + 14px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(16, 22, 44, 0.5);
  border: 1px solid rgba(140, 180, 255, 0.2);
  backdrop-filter: blur(6px);
}
.mp-next-label {
  font-size: 11px;
  color: #a9bde6;
}
.mp-mini {
  border-radius: 50%;
  box-shadow: 0 0 10px rgba(150, 190, 255, 0.5);
}
.mp-next-name {
  font-size: 12px;
  color: #d8e6ff;
}
.mp-aim {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  border-radius: 50%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  box-shadow: 0 0 18px rgba(150, 200, 255, 0.45), inset 0 0 8px rgba(255, 255, 255, 0.25);
}
.mp-aim-name {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  padding-bottom: 6px;
  white-space: nowrap;
}
.mp-guide {
  position: absolute;
  width: 2px;
  margin-left: -1px;
  background: linear-gradient(180deg, rgba(160, 210, 255, 0.55), rgba(160, 210, 255, 0.06));
  pointer-events: none;
  z-index: 4;
}

.mp-result {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 8, 20, 0.6);
  backdrop-filter: blur(3px);
  padding: 20px;
}
.mp-card {
  text-align: center;
  padding: 30px 34px 26px;
  border-radius: 22px;
  background: linear-gradient(160deg, rgba(28, 34, 66, 0.96), rgba(16, 20, 42, 0.96));
  border: 1px solid rgba(140, 180, 255, 0.35);
  box-shadow: 0 0 50px rgba(120, 90, 255, 0.4);
  animation: mpcardin 0.4s cubic-bezier(0.18, 0.9, 0.32, 1.2);
}
@keyframes mpcardin {
  from { opacity: 0; transform: scale(0.82) translateY(16px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.mp-title {
  font-size: 26px;
  font-weight: 800;
  background: linear-gradient(90deg, #37e0ff, #8a5cff, #ff9a5c);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.mp-sub {
  margin: 8px 0 2px;
  color: #cdd9f5;
  font-size: 14px;
}
.mp-score {
  font-size: 46px;
  font-weight: 800;
  color: #ffe27a;
  text-shadow: 0 0 18px rgba(255, 226, 122, 0.55);
  line-height: 1.2;
}
.mp-btn {
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
</style>
