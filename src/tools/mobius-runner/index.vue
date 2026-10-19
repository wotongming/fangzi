<script setup lang="ts">
/**
 * 莫比环 MÖBIUS —— 工具主界面
 * 纯前端、零后端、离线；进入对局即系统全屏沉浸；一指（点按/空格）翻转。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import manifest from './manifest'
import { useToolBilling } from '../../composables/useToolBilling'
import { useImmersive } from '../../composables/useImmersive'
import { useSeo } from '../../composables/useSeo'
import { hasWebGL2, quickGpuGuess } from '../../../reusable-module/gpu-detect/gpu-detect'
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
import {
  loadState,
  recordRunResult,
  saveSettings,
  saveState,
  defaultSettings
} from './game/storage'
import type { GameState, Settings as GameSettings, FxTier } from './game/types'
import type { MobiusRenderer, Fidelity } from './three/MobiusRenderer'

useSeo({
  title: '莫比环 MÖBIUS · 一指翻转 3D 莫比乌斯光带跑酷 - 方子',
  description:
    '你是一道光，沿无限半扭转的莫比乌斯光带奔跑，点一下翻到另一面穿过闸门缺口；每圈半扭转，正反面真正对调。连击倍率、贴边擦过、慢动作震屏，全屏沉浸、离线可玩、无需登录。',
  type: 'WebApplication',
  keywords: ['莫比环', '莫比乌斯', '3d跑酷', '一指翻转', '炫光小游戏', 'three.js', '离线游戏', 'hypercasual'],
  jsonLd: {
    name: '莫比环 MÖBIUS',
    applicationCategory: 'Game',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' }
  }
})

type Phase = 'menu' | 'loading' | 'playing' | 'paused' | 'dead' | 'unsupported'

const billing = useToolBilling(manifest.id)
const imm = useImmersive()
const priceText = billing.priceText(billing.plan.priceCents ?? 0)
const proOwned = computed(() => billing.isOwned('freemium-pro') || billing.isOwned('buyout'))

const stageRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const phase = ref<Phase>('menu')
const loadingMsg = ref('正在点亮光带…')
const best = ref(0)
const totalShards = ref(0)
const runs = ref(0)
const settings = ref<GameSettings>(defaultSettings())
const tutorialSeen = ref(false)
const showTutorial = ref(false)
const showPaywall = ref(false)
const buying = ref(false)
const payMsg = ref('')

const score = ref(0)
const multiplier = ref(1)
const peakMult = ref(1)
const reviveUsed = ref(false)
const twistWarn = ref(false)
const isNewBest = ref(false)
const canReviveNow = computed(() => phase.value === 'dead' && proOwned.value && !reviveUsed.value)

const THEMES = [
  { key: 'aurora', name: '极光', pro: false },
  { key: 'ember', name: '熔火', pro: true },
  { key: 'violet', name: '幽紫', pro: true }
]
const activeTheme = ref('aurora')

let renderer: MobiusRenderer | null = null
let rendererLoaded = false
let state: GameState | null = null
const audio = new MobiusAudio()
let raf = 0
let last = 0
let acc = 0
// 擦过/完美对齐触发的短暂慢动作（juice）。只缩放“喂给固定步长累加器的实时 dt”，
// 不改变 STEP，逻辑仍确定性、跨刷新率一致；结束后累加器自然补步（有 guard 上限）。
let slowT = 0
let slowDur = 1
let slowMin = 1
const SLOW_SCALE_NEAR = 0.42
const SLOW_SCALE_PERFECT = 0.6
const SLOW_DUR_NEAR = 0.22
const SLOW_DUR_PERFECT = 0.14
let wakeLock: { release: () => Promise<void> } | null = null
let resizeObs: ResizeObserver | null = null

// 用函数读取状态，避免 TS 因 step() 内部改 status 而把字面量类型窄化死
const isRunning = (s: GameState): boolean => s.status === 'running'
const isDead = (s: GameState): boolean => s.status === 'dead'

function resolveFidelity(s: GameSettings): Fidelity {
  if (s.fx === 'high') return 'high'
  if (s.fx === 'low') return 'low'
  const desktop = typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 820px)').matches
  return s.reduceMotion || !desktop || quickGpuGuess() !== 'webgpu' ? 'low' : 'high'
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
      fidelity: resolveFidelity(settings.value),
      reduceMotion: settings.value.reduceMotion
    })
    renderer.setPalette(activeTheme.value)
    rendererLoaded = true
    return true
  } catch (e) {
    console.error('mobius renderer init failed', e)
    phase.value = 'unsupported'
    return false
  }
}

function triggerSlow(scale: number, dur: number): void {
  // 连续擦过时刷新慢动作：取更强（更小）的缩放、更长的窗口
  slowMin = Math.min(slowMin, scale)
  if (dur >= slowT) {
    slowT = dur
    slowDur = dur
  }
}
function slowScaleNow(): number {
  // 慢动作窗口内时间缩放从 slowMin 线性回升到 1
  if (slowT <= 0 || slowDur <= 0) return 1
  const k = slowT / slowDur // 1 -> 0
  return slowMin + (1 - slowMin) * (1 - k)
}

function beginGame(): void {
  state = createRun({})
  startRun(state)
  score.value = 0
  multiplier.value = 1
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
  phase.value = 'playing'
  last = performance.now()
  void requestWakeLock()
}

async function onPrimaryStart(): Promise<void> {
  audio.resume()
  void imm.enter()
  if (!rendererLoaded) {
    phase.value = 'loading'
    loadingMsg.value = '正在点亮光带…'
    const ok = await ensureRenderer()
    if (!ok) return
  } else {
    await ensureRenderer()
  }
  if (!tutorialSeen.value) {
    showTutorial.value = true
    phase.value = 'menu'
    return
  }
  beginGame()
}

function closeTutorialAndPlay(): void {
  tutorialSeen.value = true
  void saveState({ tutorialSeen: true })
  beginGame()
}

/** 对局中点击画面（canvas）= 翻转；面板/按钮在上层会自行拦截，不会穿透 */
function onCanvasTap(): void {
  audio.resume()
  if (phase.value === 'playing' && state) flip(state)
}

function pauseGame(): void {
  if (phase.value !== 'playing' || !state) return
  pauseRun(state)
  phase.value = 'paused'
  releaseWakeLock()
}
function resumeGame(): void {
  if (phase.value !== 'paused' || !state) return
  resumeRun(state)
  phase.value = 'playing'
  last = performance.now()
  void requestWakeLock()
}

function exitToMenu(): void {
  phase.value = 'menu'
  state = null
  showPaywall.value = false
  showTutorial.value = false
  void imm.exit()
  releaseWakeLock()
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
    void requestWakeLock()
  }
}

async function buyPro(): Promise<void> {
  if (buying.value) return
  buying.value = true
  payMsg.value = ''
  try {
    await billing.buy('freemium-pro')
    showPaywall.value = false
    if (state && revive(state, true)) {
      reviveUsed.value = true
      phase.value = 'playing'
      last = performance.now()
      void requestWakeLock()
    }
  } catch (e) {
    payMsg.value = '下单未完成，可稍后重试；免费版仍可无限畅玩。'
    console.error(e)
  } finally {
    buying.value = false
  }
}

async function applySetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]): Promise<void> {
  const patch = { [key]: value } as Partial<GameSettings>
  settings.value = await saveSettings(patch)
  audio.setMuted(settings.value.muted)
  if (renderer) {
    renderer.setFidelity(resolveFidelity(settings.value))
    renderer.setReduceMotion(settings.value.reduceMotion)
  }
}

function chooseTheme(key: string, pro: boolean): void {
  if (pro && !proOwned.value) {
    showPaywall.value = true
    return
  }
  activeTheme.value = key
  renderer?.setPalette(key)
}

async function requestWakeLock(): Promise<void> {
  try {
    type NavWl = Navigator & { wakeLock?: { request: () => Promise<{ release: () => Promise<void> }> } }
    const wl = (navigator as NavWl).wakeLock
    if (wl) wakeLock = await wl.request()
  } catch {
    wakeLock = null
  }
}
function releaseWakeLock(): void {
  if (wakeLock) void wakeLock.release().catch(() => {})
  wakeLock = null
}

function onKey(e: KeyboardEvent): void {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault()
    if (phase.value === 'playing') onCanvasTap()
    else if (phase.value === 'menu' || phase.value === 'dead') void onPrimaryStart()
  } else if (e.code === 'Escape') {
    if (phase.value === 'playing') pauseGame()
    else if (phase.value === 'paused') resumeGame()
  }
}
function onVisibility(): void {
  if (document.hidden && phase.value === 'playing') pauseGame()
}

function consumeEvents(): void {
  if (!state) return
  const comboLevel = state.combo
  for (const ev of state.events) {
    switch (ev) {
      case 'flip':
        audio.flip()
        vibrate(12, settings.value.vibrate)
        break
      case 'gate':
        audio.gate()
        break
      case 'near':
        audio.near()
        vibrate([10, 30, 10], settings.value.vibrate)
        if (!settings.value.reduceMotion) triggerSlow(SLOW_SCALE_NEAR, SLOW_DUR_NEAR)
        break
      case 'perfect':
        audio.perfect(comboLevel)
        vibrate([8, 20, 8, 20, 8], settings.value.vibrate)
        if (!settings.value.reduceMotion) triggerSlow(SLOW_SCALE_PERFECT, SLOW_DUR_PERFECT)
        break
      case 'collect':
        audio.collect()
        break
      case 'twist-in':
        audio.twist()
        break
      case 'death':
        audio.death()
        vibrate([40, 40, 80], settings.value.vibrate)
        break
      default:
        break
    }
  }
}

async function onDeath(): Promise<void> {
  if (!state || phase.value === 'dead') return
  phase.value = 'dead'
  releaseWakeLock()
  const finalScore = displayScore(state)
  const r = await recordRunResult(finalScore, state.shardsRun)
  best.value = r.best
  isNewBest.value = r.isNewBest
  const rec = await loadState()
  runs.value = rec.runs ?? 0
  totalShards.value = rec.totalShards ?? 0
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  if (!state || !renderer) return
  const realDt = Math.min(0.1, (now - last) / 1000 || 0)
  last = now

  if (phase.value === 'playing' && state && isRunning(state)) {
    if (slowT > 0) slowT = Math.max(0, slowT - realDt)
    if (slowT === 0) slowMin = 1
    const dt = realDt * slowScaleNow() // 慢动作只缩放喂给固定步长的实时 dt
    acc += dt
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
    score.value = displayScore(state)
    multiplier.value = state.multiplier
    peakMult.value = Math.max(peakMult.value, state.multiplier)
    reviveUsed.value = state.reviveUsed
    twistWarn.value = state.twistAhead !== null && state.twistAhead <= 12
    if (isDead(state)) void onDeath()
  }
  renderer.render(state, Math.min(1, acc / STEP))
}

onMounted(async () => {
  const rec = await loadState()
  best.value = rec.best ?? 0
  totalShards.value = rec.totalShards ?? 0
  runs.value = rec.runs ?? 0
  settings.value = { ...defaultSettings(), ...(rec.settings ?? {}) }
  tutorialSeen.value = rec.tutorialSeen === true
  audio.setMuted(settings.value.muted)

  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  if (stageRef.value && 'ResizeObserver' in window) {
    resizeObs = new ResizeObserver(() => renderer?.resize())
    resizeObs.observe(stageRef.value)
  }
  // 菜单态先持有一个静止世界；点击开始时才懒加载 three 渲染器
  state = createRun({})
  last = performance.now()
  raf = requestAnimationFrame(loop)

  // 只读调试钩子（E2E 用；不参与任何判定，不暴露写接口）
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
  document.removeEventListener('visibilitychange', onVisibility)
  resizeObs?.disconnect()
  releaseWakeLock()
  if (imm.active.value) void imm.exit()
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <div ref="stageRef" class="mr-stage">
    <canvas ref="canvasRef" class="mr-canvas" @pointerdown="onCanvasTap"></canvas>

    <!-- 游戏内极简 HUD（仅对局/暂停/死亡显示，菜单不占屏） -->
    <div v-if="phase === 'playing' || phase === 'paused' || phase === 'dead'" class="hud">
      <div class="hud-top">
        <div class="hud-score">
          <span class="score-num">{{ score }}</span>
          <span v-if="peakMult > 1" class="mult">×{{ peakMult }}</span>
        </div>
        <button
          v-if="phase === 'playing'"
          class="icon-btn"
          aria-label="暂停"
          @pointerdown.stop
          @click.stop="pauseGame"
        >❚❚</button>
      </div>
      <transition name="pop">
        <div v-if="twistWarn && phase === 'playing'" class="twist-warn">扭转带 · 准备翻转</div>
      </transition>
      <div v-if="phase === 'playing'" class="tap-hint">点按任意处 · 翻转</div>
    </div>

    <!-- 主菜单 -->
    <section v-if="phase === 'menu' || phase === 'loading'" class="panel menu">
      <h1 class="logo">莫比环<span class="en">MÖBIUS</span></h1>
      <p class="tagline">沿半扭转光带奔跑，点一下翻到另一面穿过缺口。<br />每过一圈，正反两面会真正对调。</p>
      <button class="cta" :disabled="phase === 'loading'" @click="onPrimaryStart">
        {{ phase === 'loading' ? loadingMsg : best > 0 ? '再来一局' : '开始奔跑' }}
      </button>
      <div class="meta-row">
        <span class="chip">最高分 <b>{{ best }}</b></span>
        <span class="chip">已跑 <b>{{ runs }}</b> 局</span>
        <span v-if="!proOwned" class="chip pro">专业版 {{ priceText }} 买断</span>
        <span v-else class="chip owned">✓ 专业版已解锁</span>
      </div>
      <p class="foot-note">免费即可无限畅玩 · 离线运行 · 分数仅存本机</p>
    </section>

    <!-- 新手教学 -->
    <section v-if="showTutorial" class="panel tutorial">
      <h2>30 秒上手</h2>
      <ul>
        <li><b>点按屏幕 / 按空格</b>：从光带一面翻到另一面。</li>
        <li>闸门只挡住<b>一面</b>，在亮着的<b>缺口面</b>穿过即可。</li>
        <li>遇到<b>扭转光带</b>时空间会翻转——你所在的面会和对面对调，提前看好缺口。</li>
        <li>贴边擦过、临门翻转有<b>连击倍率</b>；撞墙即结束，可立即重开。</li>
      </ul>
      <button class="cta" @click="closeTutorialAndPlay">我知道了，开跑</button>
    </section>

    <!-- 暂停 -->
    <section v-if="phase === 'paused'" class="panel">
      <h2>已暂停</h2>
      <button class="cta" @click="resumeGame">继续</button>
      <button class="ghost" @click="beginGame">重新开始</button>
      <div class="settings">
        <label>
          <input
            type="checkbox"
            :checked="settings.muted"
            @change="applySetting('muted', ($event.target as HTMLInputElement).checked)"
          /> 静音
        </label>
        <label>
          <input
            type="checkbox"
            :checked="settings.vibrate"
            @change="applySetting('vibrate', ($event.target as HTMLInputElement).checked)"
          /> 震动
        </label>
        <label>
          <input
            type="checkbox"
            :checked="settings.reduceMotion"
            @change="applySetting('reduceMotion', ($event.target as HTMLInputElement).checked)"
          /> 降低动态（少眩晕）
        </label>
        <label>
          特效
          <select
            :value="settings.fx"
            @change="applySetting('fx', ($event.target as HTMLSelectElement).value as FxTier)"
          >
            <option value="auto">自动</option>
            <option value="high">高</option>
            <option value="low">低（省电）</option>
          </select>
        </label>
      </div>
      <div class="themes">
        <button
          v-for="t in THEMES"
          :key="t.key"
          class="theme-chip"
          :class="{ on: activeTheme === t.key, locked: t.pro && !proOwned }"
          @click="chooseTheme(t.key, t.pro)"
        >{{ t.name }}<i v-if="t.pro">🔒</i></button>
      </div>
      <button class="ghost" @click="exitToMenu">返回菜单</button>
    </section>

    <!-- 结算 -->
    <section v-if="phase === 'dead'" class="panel dead">
      <h2>{{ isNewBest ? '新纪录！' : '本局结束' }}</h2>
      <div class="big-score">{{ score }}</div>
      <p class="faint">最高分 {{ best }} · 倍率峰值 ×{{ peakMult }}</p>
      <button v-if="canReviveNow" class="cta revive" @click="doRevive">🛡 光盾续命（本局一次）</button>
      <button class="cta" @click="beginGame">立刻重开</button>
      <button v-if="!proOwned" class="ghost" @click="showPaywall = true">解锁专业版 · 每局续命 + 炫彩皮肤</button>
      <button class="ghost" @click="exitToMenu">返回菜单</button>
    </section>

    <!-- 专业版付费墙 -->
    <section v-if="showPaywall" class="panel paywall">
      <h2>莫比环专业版</h2>
      <ul class="perks">
        <li>🛡 每局限一次「光盾续命」</li>
        <li>🎨 熔火 / 幽紫 炫彩主题皮肤</li>
        <li>✨ 专属流光拖尾与徽章</li>
        <li>🆕 后续新模式与关卡持续解锁</li>
      </ul>
      <p class="faint">核心玩法永久免费，分数离线保存在本机。</p>
      <button class="cta" :disabled="buying" @click="buyPro">{{ buying ? '下单中…' : `一次买断 ${priceText}` }}</button>
      <p v-if="payMsg" class="pay-msg">{{ payMsg }}</p>
      <button class="ghost" @click="showPaywall = false">先玩免费版</button>
    </section>

    <!-- 无 WebGL 兜底 -->
    <section v-if="phase === 'unsupported'" class="panel">
      <h2>当前设备暂不支持 3D 渲染</h2>
      <p class="faint">莫比环需要 WebGL。请使用较新的 Chrome / Edge / Safari，并开启硬件加速后重试。</p>
      <button class="ghost" @click="exitToMenu">返回</button>
    </section>
  </div>
</template>

<style scoped>
.mr-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 70vh;
  overflow: hidden;
  border-radius: 16px;
  background: #05060f;
  color: #eaf2ff;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.mr-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* HUD */
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  padding: max(10px, env(safe-area-inset-top)) 14px max(10px, env(safe-area-inset-bottom));
}
.hud-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hud-score {
  display: flex;
  align-items: baseline;
  gap: 8px;
  text-shadow: 0 0 12px rgba(80, 200, 255, 0.6);
}
.score-num {
  font-size: clamp(28px, 6vw, 44px);
  font-weight: 800;
  letter-spacing: 1px;
}
.mult {
  color: #ffd166;
  font-weight: 800;
  font-size: clamp(16px, 3.4vw, 22px);
}
.icon-btn {
  pointer-events: auto;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(150, 200, 255, 0.35);
  background: rgba(10, 16, 36, 0.5);
  color: #cfe6ff;
  font-size: 14px;
  backdrop-filter: blur(6px);
}
.twist-warn {
  position: absolute;
  top: 18%;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(255, 90, 160, 0.18);
  border: 1px solid rgba(255, 90, 160, 0.6);
  color: #ffd0e4;
  font-weight: 700;
  letter-spacing: 2px;
}
.tap-hint {
  position: absolute;
  bottom: calc(max(18px, env(safe-area-inset-bottom)) + 2%);
  left: 0;
  right: 0;
  text-align: center;
  color: rgba(210, 232, 255, 0.7);
  letter-spacing: 3px;
  font-size: 14px;
  animation: breathe 1.6s ease-in-out infinite;
}
@keyframes breathe {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.95; }
}
.pop-enter-active, .pop-leave-active { transition: opacity 0.25s; }
.pop-enter-from, .pop-leave-to { opacity: 0; }

/* 面板 */
.panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 24px 22px calc(24px + env(safe-area-inset-bottom));
  background: radial-gradient(120% 90% at 50% 0%, rgba(20, 34, 70, 0.72), rgba(5, 6, 15, 0.92));
  backdrop-filter: blur(3px);
}
.menu { gap: 16px; }
.logo {
  font-size: clamp(34px, 9vw, 60px);
  font-weight: 900;
  margin: 0;
  letter-spacing: 4px;
  background: linear-gradient(90deg, #6fe7ff, #b07bff, #ff6aa9);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 30px rgba(120, 160, 255, 0.25);
}
.logo .en {
  display: block;
  font-size: 0.32em;
  letter-spacing: 10px;
  color: #9fc4ff;
  -webkit-text-fill-color: #9fc4ff;
  margin-top: 4px;
}
.tagline {
  color: #c6dcff;
  line-height: 1.7;
  font-size: 15px;
  max-width: 440px;
  margin: 0;
}
.cta {
  min-width: 220px;
  padding: 15px 28px;
  border: none;
  border-radius: 16px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #04101f;
  background: linear-gradient(90deg, #63e6ff, #7aa8ff);
  box-shadow: 0 8px 30px rgba(90, 180, 255, 0.4);
  cursor: pointer;
}
.cta:disabled { opacity: 0.7; cursor: default; }
.cta.revive {
  background: linear-gradient(90deg, #ffd166, #ff8a5c);
  box-shadow: 0 8px 30px rgba(255, 170, 90, 0.4);
}
.ghost {
  min-width: 200px;
  padding: 11px 20px;
  border-radius: 12px;
  border: 1px solid rgba(150, 200, 255, 0.3);
  background: rgba(18, 28, 54, 0.6);
  color: #cfe6ff;
  font-size: 15px;
  cursor: pointer;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.chip {
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(40, 60, 110, 0.55);
  border: 1px solid rgba(140, 190, 255, 0.25);
  color: #cfe2ff;
}
.chip b { color: #8fe3ff; }
.chip.pro { color: #ffd9a8; border-color: rgba(255, 190, 120, 0.4); }
.chip.owned { color: #a6f5c9; border-color: rgba(120, 240, 180, 0.4); }
.foot-note { color: rgba(190, 215, 255, 0.55); font-size: 12px; margin: 4px 0 0; }

.tutorial ul, .perks {
  text-align: left;
  max-width: 460px;
  margin: 0;
  padding-left: 20px;
  line-height: 2;
  color: #d7e7ff;
  font-size: 15px;
}
.tutorial b { color: #9fe8ff; }

.big-score {
  font-size: clamp(56px, 16vw, 96px);
  font-weight: 900;
  color: #ffe08a;
  text-shadow: 0 0 30px rgba(255, 200, 90, 0.5);
  line-height: 1;
}
.faint { color: rgba(200, 222, 255, 0.66); margin: 0; }
.pay-msg { color: #ffb4b4; font-size: 13px; margin: 0; }

.settings {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  justify-content: center;
  color: #cfe2ff;
  font-size: 14px;
}
.settings label { display: inline-flex; align-items: center; gap: 6px; }
.themes { display: flex; gap: 10px; }
.theme-chip {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(150, 200, 255, 0.3);
  background: rgba(18, 28, 54, 0.6);
  color: #cfe6ff;
  cursor: pointer;
}
.theme-chip.on { border-color: #6fe7ff; color: #aef0ff; box-shadow: 0 0 14px rgba(111, 231, 255, 0.4); }
.theme-chip.locked { opacity: 0.8; }
.theme-chip i { font-style: normal; margin-left: 6px; font-size: 11px; }

/* 沉浸全屏：工具页外壳已隐藏顶栏/Tab，铺满安全区 */
:global(.runner-immersive) .mr-stage {
  min-height: calc(100dvh - 24px);
  border-radius: 20px;
}
@media (min-width: 820px) {
  .mr-stage { min-height: 78vh; }
}
</style>
