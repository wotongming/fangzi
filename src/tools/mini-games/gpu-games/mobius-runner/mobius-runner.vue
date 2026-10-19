<script setup lang="ts">
/**
 * 莫比环跑酷（Möbius Runner）—— 并入「小游戏合集」的 GPU 游戏舞台组件。
 * 契约与 glow-match / neon-pulse / orbit-surge 一致：
 * props: paused / muted / vibrate / particle；emits: score / combo / gameover。
 * 外层 FocusStage 已提供全屏、HUD 暂停、WakeLock、特效档位与退出，本组件只管玩法与浮层。
 * 纯前端、零后端、离线；主角为可选的原创卡通奔跑小人。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { manifest } from '../../manifest'
import { useToolBilling } from '@/composables/useToolBilling'
import { hasWebGL2, quickGpuGuess } from '../../../../../reusable-module/gpu-detect/gpu-detect'
import {
  createRun,
  startRun,
  pauseRun,
  resumeRun,
  step,
  flip,
  revive,
  displayScore,
  STEP
} from './game/logic'
import { MobiusAudio, vibrate } from './game/audio'
import { loadState, recordRunResult, saveState } from './game/storage'
import type { GameState } from './game/types'
import { CHARACTERS, DEFAULT_CHARACTER_ID, characterOf } from './game/characters'
import type { MobiusRenderer, Fidelity } from './three/MobiusRenderer'

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

const billing = useToolBilling(manifest.id)
const proOwned = computed(() => billing.isOwned('freemium-pro') || billing.isOwned('buyout'))

type Phase = 'menu' | 'loading' | 'playing' | 'dead' | 'unsupported'
const canvasRef = ref<HTMLCanvasElement | null>(null)
const phase = ref<Phase>('menu')
const loadingMsg = ref('正在点亮光带…')
const showTutorial = ref(false)
const showChars = ref(false)
const showPaywall = ref(false)
const buying = ref(false)
const payMsg = ref('')

const score = ref(0)
const peakMult = ref(1)
const reviveUsed = ref(false)
const twistWarn = ref(false)
const isNewBest = ref(false)
const best = ref(0)
const runs = ref(0)
const characterId = ref(DEFAULT_CHARACTER_ID)
const currentChar = computed(() => characterOf(characterId.value))
const canReviveNow = computed(() => phase.value === 'dead' && proOwned.value && !reviveUsed.value)

let state: GameState | null = null
let renderer: MobiusRenderer | null = null
let rendererLoaded = false
const audio = new MobiusAudio()
audio.setMuted(props.muted)
let raf = 0
let last = 0
let acc = 0
let resizeObs: ResizeObserver | null = null

// 擦过/完美慢动作（只缩放喂给固定步长的实时 dt，不改 STEP，保持确定性）
let slowT = 0
let slowDur = 1
let slowMin = 1
const SLOW_SCALE_NEAR = 0.42
const SLOW_SCALE_PERFECT = 0.6
const SLOW_DUR_NEAR = 0.22
const SLOW_DUR_PERFECT = 0.14

const isRunning = (s: GameState): boolean => s.status === 'running'
const isDead = (s: GameState): boolean => s.status === 'dead'

function resolveFidelity(): Fidelity {
  if (props.particle === 'high') return 'high'
  if (props.particle === 'low') return 'low'
  const desktop = typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 820px)').matches
  return !desktop || quickGpuGuess() !== 'webgpu' ? 'low' : 'high'
}

async function ensureRenderer(): Promise<boolean> {
  if (renderer) {
    renderer.resize()
    return true
  }
  if (!canvasRef.value || !hasWebGL2()) {
    phase.value = 'unsupported'
    return false
  }
  try {
    const mod = await import('./three/MobiusRenderer')
    if (!canvasRef.value) return false
    renderer = new mod.MobiusRenderer(canvasRef.value, {
      fidelity: resolveFidelity(),
      reduceMotion: false,
      characterId: characterId.value
    })
    rendererLoaded = true
    return true
  } catch (e) {
    console.error('mobius runner renderer init failed', e)
    phase.value = 'unsupported'
    return false
  }
}

function triggerSlow(scale: number, dur: number): void {
  slowMin = Math.min(slowMin, scale)
  if (dur >= slowT) {
    slowT = dur
    slowDur = dur
  }
}
function slowScaleNow(): number {
  if (slowT <= 0 || slowDur <= 0) return 1
  const k = slowT / slowDur
  return slowMin + (1 - slowMin) * (1 - k)
}

function beginGame(): void {
  state = createRun({})
  startRun(state)
  score.value = 0
  peakMult.value = 1
  isNewBest.value = false
  reviveUsed.value = false
  twistWarn.value = false
  acc = 0
  slowT = 0
  slowDur = 1
  slowMin = 1
  showPaywall.value = false
  showTutorial.value = false
  showChars.value = false
  phase.value = 'playing'
  last = performance.now()
}

async function onPrimaryStart(): Promise<void> {
  audio.resume()
  if (!rendererLoaded) {
    phase.value = 'loading'
    loadingMsg.value = '正在点亮光带…'
    const ok = await ensureRenderer()
    if (!ok) return
  } else {
    await ensureRenderer()
  }
  const rec = await loadState()
  if (!rec.introDone) {
    showTutorial.value = true
    phase.value = 'menu'
    return
  }
  beginGame()
}

function closeTutorialAndPlay(): void {
  void saveState({ introDone: true })
  beginGame()
}

function onCanvasTap(): void {
  audio.resume()
  if (phase.value === 'playing' && !props.paused && state) flip(state)
}

async function doRevive(): Promise<void> {
  if (!state || !proOwned.value) {
    showPaywall.value = true
    return
  }
  if (revive(state, true)) {
    reviveUsed.value = true
    phase.value = 'playing'
    last = performance.now()
  }
}

async function buyPro(): Promise<void> {
  if (buying.value) return
  buying.value = true
  payMsg.value = ''
  try {
    await billing.buy('freemium-pro')
    showPaywall.value = false
  } catch {
    payMsg.value = '下单未完成，可稍后再试；免费角色与核心玩法不受影响。'
  } finally {
    buying.value = false
  }
}

function pickCharacter(id: string, pro: boolean): void {
  if (pro && !proOwned.value) {
    showPaywall.value = true
    return
  }
  characterId.value = id
  renderer?.setCharacter(id)
  void saveState({ characterId: id })
}

function consumeEvents(): void {
  if (!state) return
  const comboLevel = state.combo
  for (const ev of state.events) {
    switch (ev) {
      case 'flip':
        audio.flip()
        vibrate(12, props.vibrate)
        break
      case 'gate':
        audio.gate()
        break
      case 'near':
        audio.near()
        vibrate([10, 30, 10], props.vibrate)
        triggerSlow(SLOW_SCALE_NEAR, SLOW_DUR_NEAR)
        break
      case 'perfect':
        audio.perfect(comboLevel)
        vibrate([8, 20, 8, 20, 8], props.vibrate)
        triggerSlow(SLOW_SCALE_PERFECT, SLOW_DUR_PERFECT)
        break
      case 'collect':
        audio.collect()
        break
      case 'twist-in':
        audio.twist()
        break
      case 'death':
        audio.death()
        vibrate([40, 40, 80], props.vibrate)
        break
      default:
        break
    }
  }
}

async function onDeath(): Promise<void> {
  if (!state || phase.value === 'dead') return
  phase.value = 'dead'
  const finalScore = displayScore(state)
  const r = await recordRunResult(finalScore, state.shardsRun)
  best.value = r.best
  isNewBest.value = r.isNewBest
  runs.value = (await loadState()).runs ?? 0
  emit('gameover')
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  if (!state || !renderer) return
  const realDt = Math.min(0.1, (now - last) / 1000 || 0)
  last = now

  if (phase.value === 'playing' && !props.paused && isRunning(state)) {
    if (slowT > 0) slowT = Math.max(0, slowT - realDt)
    if (slowT === 0) slowMin = 1
    acc += realDt * slowScaleNow()
    let guard = 0
    while (acc >= STEP && guard++ < 24) {
      step(state, STEP)
      acc -= STEP
      if (isDead(state)) {
        acc = 0
        break
      }
    }
    consumeEvents()
    const sc = displayScore(state)
    score.value = sc
    emit('score', sc)
    peakMult.value = Math.max(peakMult.value, state.multiplier)
    emit('combo', state.multiplier)
    reviveUsed.value = state.reviveUsed
    twistWarn.value = state.twistAhead !== null && state.twistAhead <= 12
    if (isDead(state)) void onDeath()
  }
  renderer.render(state, Math.min(1, acc / STEP))
}

function onKey(e: KeyboardEvent): void {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    if (phase.value === 'playing') {
      e.preventDefault()
      onCanvasTap()
    }
  }
}

watch(
  () => props.muted,
  (m) => audio.setMuted(m)
)
watch(
  () => props.particle,
  () => renderer?.setFidelity(resolveFidelity())
)
watch(
  () => props.paused,
  (p) => {
    if (!state) return
    if (p) {
      if (state.status === 'running') pauseRun(state)
    } else if (phase.value === 'playing') {
      if (state.status === 'paused') resumeRun(state)
      last = performance.now()
    }
  }
)

onMounted(async () => {
  const rec = await loadState()
  best.value = rec.best ?? 0
  runs.value = rec.runs ?? 0
  characterId.value = rec.characterId ?? DEFAULT_CHARACTER_ID
  // 菜单态先建一个静止世界（角色待机动画），three 仍异步加载，不阻塞合集首屏
  state = createRun({})
  await ensureRenderer()
  if (canvasRef.value && 'ResizeObserver' in window) {
    resizeObs = new ResizeObserver(() => renderer?.resize())
    resizeObs.observe(canvasRef.value)
  }
  window.addEventListener('keydown', onKey)
  last = performance.now()
  raf = requestAnimationFrame(loop)

  // 只读调试钩子（E2E 用，不参与判定）
  ;(window as unknown as { __mobius?: unknown }).__mobius = {
    getStatus: () => state?.status ?? null,
    getFace: () => state?.face ?? null,
    getDistance: () => state?.distance ?? 0,
    getScore: () => (state ? displayScore(state) : 0)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKey)
  resizeObs?.disconnect()
  renderer?.dispose()
  renderer = null
  audio.setMuted(true)
})
</script>

<template>
  <div class="mb-run">
    <canvas ref="canvasRef" class="run-canvas" @pointerdown="onCanvasTap"></canvas>

    <!-- 对局内：扭转预告（分数/暂停由外层 FocusStage HUD 提供，不重复占屏） -->
    <transition name="fade">
      <div v-if="twistWarn && phase === 'playing' && !paused" class="twist-warn">扭转带 · 准备翻转</div>
    </transition>
    <div v-if="phase === 'playing' && !paused" class="tap-hint">点按任意处 · 翻转</div>

    <!-- 主菜单 / 角色选择 -->
    <section v-if="phase === 'menu' || phase === 'loading'" class="panel" @pointerdown.stop>
      <h1 class="logo">莫比环跑酷</h1>
      <p class="tagline">沿半扭转光带奔跑，点一下翻到另一面穿过缺口；每过一圈，正反面真正对调。</p>

      <button class="char-pick" @click="showChars = !showChars">
        <span class="char-dot" :style="{ background: currentChar.cssHex.suit }" />
        当前角色：<b>{{ currentChar.name }}</b>
        <i>{{ showChars ? '收起' : '更换' }}</i>
      </button>

      <transition name="sheet">
        <div v-if="showChars" class="char-grid">
          <button
            v-for="c in CHARACTERS"
            :key="c.id"
            class="char-card"
            :class="{ on: c.id === characterId, locked: c.pro && !proOwned }"
            @click="pickCharacter(c.id, c.pro)"
          >
            <span class="cc-avatar" :style="{ background: c.cssHex.suit }">
              <span class="cc-ear" :style="{ background: c.cssHex.hair }" />
            </span>
            <span class="cc-name">{{ c.name }}</span>
            <span v-if="c.pro && !proOwned" class="cc-lock">🔒</span>
            <span v-else-if="c.id === characterId" class="cc-ok">✓</span>
          </button>
        </div>
      </transition>

      <button class="cta" :disabled="phase === 'loading'" @click="onPrimaryStart">
        {{ phase === 'loading' ? loadingMsg : best > 0 ? '再来一局' : '开始奔跑' }}
      </button>
      <div class="meta-row">
        <span class="chip">最高分 <b>{{ best }}</b></span>
        <span class="chip">已跑 <b>{{ runs }}</b> 局</span>
      </div>
      <p class="foot-note">免费即可无限畅玩 · 离线运行 · 分数仅存本机</p>
    </section>

    <!-- 新手教学 -->
    <section v-if="showTutorial" class="panel" @pointerdown.stop>
      <h2>30 秒上手</h2>
      <ul class="tips">
        <li><b>点按屏幕 / 按空格</b>：操控小人从光带一面翻到另一面。</li>
        <li>闸门只挡住<b>一面</b>，在亮着的<b>缺口面</b>穿过即可。</li>
        <li>遇到<b>扭转光带</b>空间会翻转——你所在的面会和对面对调，提前看好缺口。</li>
        <li>贴边擦过、临门翻转有<b>连击倍率</b>；撞墙即结束，可立即重开。</li>
      </ul>
      <button class="cta" @click="closeTutorialAndPlay">我知道了，开跑</button>
    </section>

    <!-- 结算 -->
    <section v-if="phase === 'dead'" class="panel" @pointerdown.stop>
      <h2>{{ isNewBest ? '新纪录！' : '本局结束' }}</h2>
      <div class="big-score">{{ score }}</div>
      <p class="faint">最高分 {{ best }} · 倍率峰值 ×{{ peakMult }}</p>
      <button v-if="canReviveNow" class="cta revive" @click="doRevive">🛡 光盾续命（本局一次）</button>
      <button class="cta" @click="beginGame">立刻重开</button>
      <button v-if="!proOwned" class="ghost" @click="showPaywall = true">解锁专业版 · 续命 + 更多角色</button>
    </section>

    <!-- 专业版付费墙（舞台内简版，购买与小游戏合集专业版一致） -->
    <section v-if="showPaywall" class="panel" @pointerdown.stop>
      <h2>小游戏专业版</h2>
      <ul class="tips">
        <li>🛡 莫比环每局限一次「光盾续命」</li>
        <li>🧑‍🎤 解锁火焰仔、紫影侠等更多原创角色</li>
        <li>🎮 霓虹脉冲、星轨穿梭、数字华容道等全部专业版游戏</li>
      </ul>
      <button class="cta" :disabled="buying" @click="buyPro">
        {{ buying ? '下单中…' : `一次买断 ${billing.priceText(billing.plan.priceCents ?? 0)}` }}
      </button>
      <p v-if="payMsg" class="pay-msg">{{ payMsg }}</p>
      <button class="ghost" @click="showPaywall = false">返回</button>
    </section>

    <!-- 无 WebGL 兜底 -->
    <section v-if="phase === 'unsupported'" class="panel" @pointerdown.stop>
      <h2>当前设备暂不支持 3D 渲染</h2>
      <p class="faint">莫比环跑酷需要 WebGL。请使用较新的 Chrome / Edge / Safari，并开启硬件加速后重试。</p>
    </section>
  </div>
</template>

<style scoped>
.mb-run {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #05060f;
  color: #eaf2ff;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.run-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.twist-warn {
  position: absolute;
  top: 16%;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(255, 90, 160, 0.18);
  border: 1px solid rgba(255, 90, 160, 0.6);
  color: #ffd0e4;
  font-weight: 700;
  letter-spacing: 2px;
  pointer-events: none;
}
.tap-hint {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 26px);
  left: 0;
  right: 0;
  text-align: center;
  color: rgba(210, 232, 255, 0.7);
  letter-spacing: 3px;
  font-size: 14px;
  animation: breathe 1.6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes breathe {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.95; }
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.sheet-enter-active, .sheet-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; transform: translateY(-6px); }

.panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 22px 20px calc(22px + env(safe-area-inset-bottom));
  background: radial-gradient(120% 90% at 50% 0%, rgba(20, 34, 70, 0.66), rgba(5, 6, 15, 0.9));
  backdrop-filter: blur(3px);
}
.logo {
  font-size: clamp(32px, 8vw, 54px);
  font-weight: 900;
  margin: 0;
  letter-spacing: 3px;
  background: linear-gradient(90deg, #6fe7ff, #b07bff, #ff6aa9);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tagline {
  color: #c6dcff;
  line-height: 1.7;
  font-size: 14px;
  max-width: 430px;
  margin: 0;
}
.cta {
  min-width: 210px;
  padding: 14px 26px;
  border: none;
  border-radius: 16px;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #04101f;
  background: linear-gradient(90deg, #63e6ff, #7aa8ff);
  box-shadow: 0 8px 30px rgba(90, 180, 255, 0.4);
}
.cta:disabled { opacity: 0.7; }
.cta.revive {
  background: linear-gradient(90deg, #ffd166, #ff8a5c);
  box-shadow: 0 8px 30px rgba(255, 170, 90, 0.4);
}
.ghost {
  min-width: 190px;
  padding: 10px 18px;
  border-radius: 12px;
  border: 1px solid rgba(150, 200, 255, 0.3);
  background: rgba(18, 28, 54, 0.6);
  color: #cfe6ff;
  font-size: 14px;
}
.char-pick {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(150, 200, 255, 0.3);
  background: rgba(18, 28, 54, 0.6);
  color: #dcebff;
  font-size: 14px;
}
.char-pick b { color: #9fe8ff; }
.char-pick i { font-style: normal; color: #8fb6e8; font-size: 12px; margin-left: 2px; }
.char-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.7);
}
.char-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  max-width: 460px;
  width: 100%;
}
@media (max-width: 420px) {
  .char-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.char-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 10px 6px;
  border-radius: 14px;
  border: 1px solid rgba(150, 200, 255, 0.22);
  background: rgba(255, 255, 255, 0.05);
  color: #dbe7ff;
}
.char-card.on { border-color: #6fe7ff; box-shadow: 0 0 14px rgba(111, 231, 255, 0.35); }
.char-card.locked { opacity: 0.85; }
.cc-avatar {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 50% 50% 46% 46%;
  border: 2px solid rgba(255, 255, 255, 0.65);
}
.cc-ear {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 12px;
  border-radius: 6px 6px 2px 2px;
}
.cc-name { font-size: 11px; line-height: 1.2; }
.cc-lock, .cc-ok { position: absolute; top: 4px; right: 6px; font-size: 11px; }
.cc-ok { color: #8fffc0; }
.meta-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.chip {
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(40, 60, 110, 0.55);
  border: 1px solid rgba(140, 190, 255, 0.25);
  color: #cfe2ff;
}
.chip b { color: #8fe3ff; }
.foot-note { color: rgba(190, 215, 255, 0.55); font-size: 12px; margin: 2px 0 0; }
.tips {
  text-align: left;
  max-width: 440px;
  margin: 0;
  padding-left: 20px;
  line-height: 1.9;
  color: #d7e7ff;
  font-size: 14px;
}
.tips b { color: #9fe8ff; }
.big-score {
  font-size: clamp(52px, 15vw, 88px);
  font-weight: 900;
  color: #ffe08a;
  text-shadow: 0 0 30px rgba(255, 200, 90, 0.5);
  line-height: 1;
}
.faint { color: rgba(200, 222, 255, 0.66); margin: 0; }
.pay-msg { color: #ffb4b4; font-size: 13px; margin: 0; }
</style>
