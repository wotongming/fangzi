<script setup lang="ts">
/**
 * 合成宇宙（Merge Cosmos，内部 id merge-planet）—— matter.js 真实物理 + Canvas2D 程序化美术。
 *
 * 玩法：顶部滑轨瞄准投放星球，两颗同级接触合成更高一级（共 19 级，陨石→…→宇宙）；
 * 连锁连击加分；合成宇宙（终极）通关大爆发；球体越过警戒线并持续约 1.75s 判负（瞬时擦过不算）。
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
  isFinal,
  mergeScore,
  rollSpawnTier,
  canDrop,
  createOverline,
  updateOverline,
  clampAim,
  wallAimRange,
  ballRadius,
  gammaToGravityX,
  lerpGravityX,
  planMerges,
  SPAWN_GRACE_MS,
  TIER_COUNT,
  type OverlineState
} from './game/logic'
import { makeStarfield, drawSpaceBackground, paintPlanet, hash01, type Star } from './game/render'
import {
  SAVE_KEY,
  AUTO_SAVE_KEY,
  serializeSave,
  persistSave,
  loadSave,
  readSaveRaw,
  readSaveMeta,
  clearSave,
  formatSaveTime,
  type SavePayload,
  type SaveBounds
} from './game/save'

const props = withDefaults(
  defineProps<{
    difficulty?: string
    paused?: boolean
    muted?: boolean
    vibrate?: boolean
    particle?: 'auto' | 'high' | 'low'
    /** 从选卡「继续游戏」进入：挂载后自动读取本地单槽存档续玩。 */
    resume?: boolean
  }>(),
  { paused: false, muted: false, vibrate: true, particle: 'auto', difficulty: 'normal', resume: false }
)

const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'combo', v: number): void
  (e: 'gameover'): void
}>()

// —— 物理常量（真实细腻、堆叠稳定、不狂弹；摩擦留活口让倾斜时落底球可缓慢滚动）——
const FIXED_MS = 1000 / 60
const POSITION_ITER = 10
const VELOCITY_ITER = 8
const RESTITUTION = 0.22
/** 球体摩擦：偏高可停住，留活口以便横向重力分量下缓慢滚动 */
const BALL_FRICTION = 0.14
/** 地面/墙体摩擦：适中，死区+摩擦保证噪声下静止球不无故滑动 */
const GROUND_FRICTION = 0.22
/** 空气阻尼：回正后让滚动球较快停下，避免惯性长距离滑行（球体无滚动阻力，靠阻尼耗散） */
const FRICTION_AIR = 0.035
const WALL = 26
/** 瞄准球心距墙的极小边距（全宽可投，不被 HUD 缩减）。 */
const AIM_EDGE = 3

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
/** 本场所合成到的最高 tier：驱动动态投放池上沿（见 logic.ts SPAWN_MAX_BY_REACH）。 */
let maxReached = 0
const currentName = ref('')
let aimX = 0
let lastDropAt = -Infinity
let inFlight = false
let overline: OverlineState = createOverline()
let lastMergeAt = -Infinity
let comboTimer: ReturnType<typeof setTimeout> | null = null
let overNotified = false
let lastDropped: Planet | null = null

// —— 重力感应状态（gamma → gravity.x，lerp 平滑；未授权/不支持回退垂直重力）——
let sensorTargetGx = 0
let smoothGx = 0
let keyboardTilt = 0 // -1 左 / 0 平 / +1 右（PC 键盘 A/D 模拟倾斜）
let gravityEnabled = true
let sensorGranted = false

// —— 手动存档（localStorage 单槽，与最高分隔离；重开/再来一局不清档）——
const saveMsg = ref('')
let saveMsgTimer: ReturnType<typeof setTimeout> | null = null

function showSaveMsg(text: string): void {
  saveMsg.value = text
  if (saveMsgTimer) clearTimeout(saveMsgTimer)
  saveMsgTimer = setTimeout(() => (saveMsg.value = ''), 2400)
}

/** 当前视口内的合法位置夹取边界（墙体/安全区）。 */
function saveBounds(): SaveBounds {
  return { minX: WALL + 4, maxX: Math.max(WALL + 4, W - WALL - 4), minY: railH + 8, maxY: Math.max(railH + 8, H - WALL) }
}

/** 序列化并覆盖写入单槽存档；返回是否成功与存档时间标签。 */
function saveGame(): { ok: boolean; covered: boolean; label: string } {
  const balls = [...planets.values()].map((p) => ({
    tier: p.tier,
    x: p.body.position.x,
    y: p.body.position.y,
    angle: p.body.angle,
    vx: p.body.velocity.x,
    vy: p.body.velocity.y,
    av: p.body.angularVelocity
  }))
  const covered = !!readSaveRaw(SAVE_KEY)
  const payload = serializeSave({ score: score.value, combo: combo.value, currentTier, maxReached, balls })
  const ok = persistSave(payload, SAVE_KEY)
  if (ok) {
    showSaveMsg(`已${covered ? '覆盖旧' : '新'}存档 · ${formatSaveTime(payload.savedAt)}`)
  } else {
    showSaveMsg('存档失败（本机存储不可用）')
  }
  return { ok, covered, label: formatSaveTime(payload.savedAt) }
}

/** 是否存在有效存档（供暂停面板「读取存档」禁用态）。 */
function hasSave(): boolean {
  return loadSave(SAVE_KEY, TIER_COUNT, saveBounds()) !== null
}

/** 读取存档元信息（时间标签），无档返回 null。 */
function saveMeta(): { savedAt: number; label: string } | null {
  return readSaveMeta(SAVE_KEY, TIER_COUNT, saveBounds())
}

/** 用校验后的存档重建局面：清旧球、按刚体状态恢复、重置冷却/连击窗口/死亡线。 */
function restoreFromSave(p: SavePayload): void {
  if (engine) {
    for (const pl of planets.values()) Matter.Composite.remove(engine.world, pl.body)
    planets.clear()
  }
  particles = []
  score.value = p.score
  combo.value = Math.max(1, p.combo)
  currentTier = p.currentTier
  syncQueueLabels()
  for (const b of p.balls) {
    const sp = spawnPlanet(b.tier, b.x, b.y, false)
    Matter.Body.setPosition(sp.body, { x: b.x, y: b.y })
    Matter.Body.setAngle(sp.body, b.angle)
    Matter.Body.setVelocity(sp.body, { x: b.vx, y: b.vy })
    Matter.Body.setAngularVelocity(sp.body, b.av)
  }
  // 续玩恢复进度：maxReached 优先用存档字段，兜底取场上球与待投球最高 tier
  maxReached = Math.max(p.maxReached ?? 0, p.currentTier, ...p.balls.map((b) => b.tier))
  // 恢复：可立即投放、连击窗口未触发、死亡线归零、回到进行态
  overline = createOverline()
  overNotified = false
  phase.value = 'play'
  lastDropAt = -Infinity
  inFlight = false
  lastDropped = null
  lastMergeAt = -Infinity
  aimX = W / 2
  const { min, max } = settleRange()
  aimX = clampAim(aimX, min, max)
  emit('score', score.value)
  emit('combo', combo.value)
}

/** 从单槽存档续玩；无效/损坏安全回退 false（不抛错、不白屏）。 */
function loadGame(): boolean {
  const p = loadSave(SAVE_KEY, TIER_COUNT, saveBounds())
  if (!p) return false
  restoreFromSave(p)
  showSaveMsg(`已读取存档 · ${formatSaveTime(p.savedAt)}`)
  return true
}

// —— 自动快照（切后台/页面回收续玩；独立键，绝不覆盖手动存档）——
/** 重挂载时是否弹「继续上一局 / 开始新局」入口。 */
const showAutoResume = ref(false)

function autoSaveNow(): void {
  if (phase.value !== 'play') return
  const balls = [...planets.values()].map((p) => ({
    tier: p.tier,
    x: p.body.position.x,
    y: p.body.position.y,
    angle: p.body.angle,
    vx: p.body.velocity.x,
    vy: p.body.velocity.y,
    av: p.body.angularVelocity
  }))
  // 空局面（还没投过球）不写快照，避免重载弹一个空局入口
  if (!balls.length) return
  const payload = serializeSave({ score: score.value, combo: combo.value, currentTier, maxReached, balls })
  persistSave(payload, AUTO_SAVE_KEY)
}

function clearAutoSave(): void {
  clearSave(AUTO_SAVE_KEY)
}

function hasAutoSave(): boolean {
  return !!readSaveRaw(AUTO_SAVE_KEY)
}

/** 弹层「继续上一局」：读自动快照并恢复；失败则清掉并开新局。 */
function resumeAutoSave(): void {
  const p = loadSave(AUTO_SAVE_KEY, TIER_COUNT, saveBounds())
  showAutoResume.value = false
  if (!p) {
    clearAutoSave()
    reset()
    return
  }
  restoreFromSave(p)
  showSaveMsg('已恢复上次对局')
}

/** 弹层「开始新局」：丢弃自动快照，重开。 */
function discardAutoSave(): void {
  clearAutoSave()
  showAutoResume.value = false
  reset()
}

function onVisibilityOrHide(): void {
  if (document.hidden) autoSaveNow()
}

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

/** 某级物理像素半径：交给布局纯函数按容器短边换算（最大球直径 ≤ 短边 0.34）。 */
function radiusFor(tier: number): number {
  const shortEdge = Math.min(W, H)
  return ballRadius(tier, shortEdge)
}

function syncQueueLabels(): void {
  currentName.value = TIERS[currentTier]?.name ?? ''
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
  const opt = { isStatic: true, friction: GROUND_FRICTION, restitution: 0.1, label: 'wall' }
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
    friction: BALL_FRICTION,
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

// —— 合并扫描：同级接触即合（不以整体相对速度为门槛），planMerges 去重 + 保护期 + 延迟生成 ——
function scanMerges(): void {
  if (!engine) return
  const now = performance.now()
  const nodes = [...planets.values()].map((p) => ({
    id: p.body.id,
    tier: p.tier,
    bornAt: p.bornAt,
    x: p.body.position.x,
    y: p.body.position.y,
    r: radiusFor(p.tier)
  }))
  const pairs = planMerges(nodes, now, SPAWN_GRACE_MS)
  if (!pairs.length) return

  // 先统一移除被合并的两球、计分/连击/粒子（新球在循环结束后再生成，本帧不二次合并）
  const producedList: Array<{ produced: number; mx: number; my: number }> = []
  for (const pair of pairs) {
    const a = planets.get(pair.a)
    const b = planets.get(pair.b)
    if (!a || !b) continue
    combo.value = now - lastMergeAt <= COMBO_WINDOW_MS ? combo.value + 1 : 1
    lastMergeAt = now
    const gained = mergeScore(pair.produced, combo.value)
    score.value += gained
    emit('score', score.value)
    emit('combo', combo.value)
    if (comboTimer) clearTimeout(comboTimer)
    comboTimer = setTimeout(() => emit('combo', 0), 1100)

    burst(pair.mx, pair.my, pair.produced, combo.value)
    audio.blip(Math.min(9, combo.value - 1))
    haptic(combo.value > 1 ? [14, 30, 14] : 10, props.vibrate)
    shakeMag = Math.min(14, 5 + combo.value * 2)

    Matter.Composite.remove(engine.world, a.body)
    Matter.Composite.remove(engine.world, b.body)
    planets.delete(a.body.id)
    planets.delete(b.body.id)
    producedList.push({ produced: pair.produced, mx: pair.mx, my: pair.my })
  }

  // 循环结束后再生成高一级球，避免本帧连锁二次合并（连锁靠后续自然碰撞）
  for (const { produced, mx, my } of producedList) {
    if (produced > maxReached) maxReached = produced
    const np = spawnPlanet(produced, mx, my)
    Matter.Body.setVelocity(np.body, { x: 0, y: -0.6 })
    if (isFinal(produced)) {
      onWin(mx, my)
      return
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
  clearAutoSave()
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
  clearAutoSave()
  shakeMag = 10
  audio.explode(2)
  haptic([18, 40], props.vibrate)
  emit('score', score.value)
  emit('gameover')
}

// —— 投放：全宽可投，球心只受墙体约束，不被 HUD 缩减 ——
function settleRange(): { min: number; max: number } {
  return wallAimRange(W, radiusFor(currentTier), AIM_EDGE)
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
  // 不展示「下一个」预告：投出后按当前进度动态投放池随机生成当前球
  currentTier = rollSpawnTier(maxReached)
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
  // 瞄准：仅 ←/→（鼠标移动也可瞄准）
  if (e.key === 'ArrowLeft') {
    aimX = clampAim(aimX - 16, settleRange().min, settleRange().max)
    e.preventDefault()
  } else if (e.key === 'ArrowRight') {
    aimX = clampAim(aimX + 16, settleRange().min, settleRange().max)
    e.preventDefault()
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    audio.ensure()
    tryDrop()
    return
  }
  // 倾斜（PC 无传感器，用 A/D 模拟重力左/右倾；与瞄准键区分）
  if (e.key === 'a' || e.key === 'A') keyboardTilt = -1
  else if (e.key === 'd' || e.key === 'D') keyboardTilt = 1
}

function onKeyUp(e: KeyboardEvent): void {
  if ((e.key === 'a' || e.key === 'A') && keyboardTilt === -1) keyboardTilt = 0
  else if ((e.key === 'd' || e.key === 'D') && keyboardTilt === 1) keyboardTilt = 0
}

// —— 重力感应：gamma → target.gravity.x，lerp 平滑；未授权/不支持回退垂直重力 ——
function currentTargetGx(): number {
  if (!gravityEnabled) return 0
  // PC 键盘倾斜优先；移动端已授权时用传感器
  if (keyboardTilt !== 0) return keyboardTilt * 0.6
  if (sensorGranted) return sensorTargetGx
  return 0
}

function applyGravity(): void {
  if (!engine) return
  const target = currentTargetGx()
  smoothGx = lerpGravityX(smoothGx, target)
  engine.gravity.x = smoothGx
  engine.gravity.y = 1
}

function onOrientation(e: DeviceOrientationEvent): void {
  if (!sensorGranted) return
  sensorTargetGx = gammaToGravityX(e.gamma ?? 0)
}

type DOEPermission = 'granted' | 'denied' | 'default'
interface DOEWithRequest extends DeviceOrientationEvent {
  requestPermission?: () => Promise<DOEPermission>
}

/** iOS13+ 在用户手势内请求传感器权限；非 iOS 直接视为可挂。成功返回 true。 */
async function requestSensor(): Promise<boolean> {
  const doe = DeviceOrientationEvent as unknown as DOEWithRequest
  try {
    if (typeof doe.requestPermission === 'function') {
      const res = await doe.requestPermission()
      if (res !== 'granted') {
        sensorGranted = false
        return false
      }
    }
    sensorGranted = true
    window.addEventListener('deviceorientation', onOrientation)
    return true
  } catch {
    sensorGranted = false
    return false
  }
}

/**
 * 菜单开关切换：开启时（iOS）在用户手势内授权；granted 才开，否则回退为关并轻提示。
 * 返回当前是否处于开启。
 */
async function toggleGravity(): Promise<boolean> {
  if (!gravityEnabled) {
    const ok = await requestSensor()
    if (!ok) {
      gravityEnabled = false
      sensorTargetGx = 0
      showSaveMsg('重力感应：未授权或不可用')
      return false
    }
    gravityEnabled = true
    return true
  }
  gravityEnabled = false
  sensorTargetGx = 0
  return false
}

/** 非 iOS（无需 requestPermission）：有传感器能力即挂监听，静默回退垂直；iOS 等菜单手势授权。 */
function autoAttachSensor(): void {
  const doe = DeviceOrientationEvent as unknown as DOEWithRequest
  if (typeof doe.requestPermission === 'function') return
  sensorGranted = true
  window.addEventListener('deviceorientation', onOrientation)
}

// —— 主循环：固定步长 + 子步 ——
function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  if (!last) last = now
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.05) dt = 0.05

  applyGravity()

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
  maxReached = 0
  currentTier = rollSpawnTier(maxReached)
  syncQueueLabels()
  emit('score', 0)
  emit('combo', 0)
  clearAutoSave()
}

// —— E2E/调试接缝：window.__mergePlanet（不暴露任何 UI，仅供自动化确定性校验）——
let debugAbove = false
function exposeDebug(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__mergePlanet = {
    spawn: (tier: number, x?: number, y?: number) => {
      if (tier > maxReached) maxReached = tier
      const p = spawnPlanet(tier, x ?? aimX, y ?? railH + 46)
      return p.body.id
    },
    maxReached: () => maxReached,
    nextSpawnTier: () => rollSpawnTier(maxReached),
    score: () => score.value,
    phase: () => phase.value,
    // 测试接缝：直接触发满级(宇宙)通关结算（物理逐级可达性由纯逻辑链单测覆盖）
    showWin: () => onWin(W / 2, H * 0.5),
    reset,
    aim: (x: number) => {
      const { min, max } = settleRange()
      aimX = clampAim(x, min, max)
    },
    holdAbove: (on: boolean) => {
      debugAbove = on
    },
    // 测试接缝：注入设备 gamma 倾角（绕过授权），读取平滑后的 world.gravity.x
    setGamma: (gamma: number) => {
      sensorGranted = true
      sensorTargetGx = gammaToGravityX(gamma)
    },
    setKeyboardTilt: (v: number) => {
      keyboardTilt = v
    },
    gravityX: () => (engine ? engine.gravity.x : 0),
    // 测试接缝：直接取某球当前 x（倾斜滚动位移断言用）
    planetX: (id: number) => planets.get(id)?.body.position.x ?? null,
    planetY: (id: number) => planets.get(id)?.body.position.y ?? null,
    // 存档/读档测试接缝
    saveGame,
    loadGame,
    hasSave,
    saveMeta,
    gravityEnabled: () => gravityEnabled,
    toggleGravity,
    currentTier: () => currentTier,
    boardCount: () => planets.size,
    boardTiers: () => [...planets.values()].map((p) => p.tier).sort((a, b) => a - b),
    // 自动快照测试接缝
    autoSaveNow,
    clearAutoSave,
    hasAutoSave,
    showAutoResume: () => showAutoResume.value
  }
}

// —— 顶部样式绑定（无「下一个」预告）——
const aimStyle = ref<Record<string, string>>({})
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
  guideStyle.value = {
    left: `${aimX}px`,
    top: `${railH}px`,
    height: `${Math.max(0, H - railH)}px`
  }
}

/**
 * 左上分数 HUD  legibility：球可贴全宽，视觉重叠时靠「更小字号 + 半透明圆角衬底」保证分数可读，
 * 而不是缩减可投范围。仅本会话临时调整宿主 HUD，卸载时还原。
 */
let savedHudStyle: Record<string, string> | null = null
function hostHudEl(): HTMLElement | null {
  return document.querySelector('.hud-left') as HTMLElement | null
}
function styleHostHud(): void {
  const el = hostHudEl()
  if (!el) return
  savedHudStyle = {
    fontSize: el.style.fontSize,
    padding: el.style.padding,
    borderRadius: el.style.borderRadius,
    background: el.style.background,
    backdropFilter: el.style.backdropFilter,
    zIndex: el.style.zIndex
  }
  el.style.fontSize = '22px'
  el.style.padding = '3px 10px'
  el.style.borderRadius = '999px'
  el.style.background = 'rgba(12,18,38,0.62)'
  el.style.backdropFilter = 'blur(6px)'
  // 分数衬底置于待投球上层：最左贴边时分数仍可读，而不是限制投放范围
  el.style.zIndex = '30'
}
function restoreHostHud(): void {
  const el = hostHudEl()
  if (el && savedHudStyle) {
    el.style.fontSize = savedHudStyle.fontSize ?? ''
    el.style.padding = savedHudStyle.padding ?? ''
    el.style.borderRadius = savedHudStyle.borderRadius ?? ''
    el.style.background = savedHudStyle.background ?? ''
    el.style.backdropFilter = savedHudStyle.backdropFilter ?? ''
    el.style.zIndex = savedHudStyle.zIndex ?? ''
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

// 切后台/页面回收：写自动快照（页面可能被系统直接杀掉，hidden/pagehide 尽量触发）
let autoSaveTimer: ReturnType<typeof setInterval> | null = null
function onPageHide(): void {
  autoSaveNow()
}

onMounted(() => {
  buildWorld()
  currentTier = rollSpawnTier(maxReached)
  syncQueueLabels()
  resize()
  aimX = W / 2
  exposeDebug()
  // 重挂载：若存在未完成的自动快照，弹「继续上一局 / 开始新局」（手动选卡 resume 直接读档、不弹）
  if (!props.resume && hasAutoSave()) showAutoResume.value = true
  if (props.resume) loadGame()
  styleHostHud()
  autoAttachSensor()
  ro = new ResizeObserver(() => resize())
  if (rootEl.value) ro.observe(rootEl.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  document.addEventListener('visibilitychange', onVisibilityOrHide)
  window.addEventListener('pagehide', onPageHide)
  // 进行中每 15s 节流快照，兜底系统回收未触发 hidden/pagehide 的场景
  autoSaveTimer = setInterval(autoSaveNow, 15000)
  raf = requestAnimationFrame(loop)
})

// 暴露给宿主暂停面板：存档 / 读取存档 / 查询存档状态 / 重力感应开关（重开不清档由组件 reset 保证）
defineExpose({
  saveGame,
  loadGame,
  hasSave,
  saveMeta,
  gravityEnabled: () => gravityEnabled,
  toggleGravity
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (comboTimer) clearTimeout(comboTimer)
  if (saveMsgTimer) clearTimeout(saveMsgTimer)
  if (autoSaveTimer) clearInterval(autoSaveTimer)
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('deviceorientation', onOrientation)
  document.removeEventListener('visibilitychange', onVisibilityOrHide)
  window.removeEventListener('pagehide', onPageHide)
  restoreHostHud()
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

    <!-- 顶部瞄准滑轨（待投球固定在顶部安全区，手指不压堆叠区；全宽可投） -->
    <div class="mp-rail">
      <div class="mp-aim" :style="aimStyle">
        <span class="mp-aim-name">{{ currentName }}</span>
      </div>
    </div>

    <!-- 落点引导线（从顶部滑轨向下标出落点列） -->
    <div class="mp-guide" :style="guideStyle" />

    <!-- 存档/读档轻提示（底部居中，自动隐去） -->
    <transition name="mp-toast">
      <div v-if="saveMsg" class="mp-toast">{{ saveMsg }}</div>
    </transition>

    <!-- 自动快照恢复入口：切后台/页面回收后重挂载时询问 -->
    <div v-if="showAutoResume" class="mp-result">
      <div class="mp-card">
        <div class="mp-title">检测到未完成对局</div>
        <p class="mp-sub">上次切出时已自动保存进度，要继续吗？</p>
        <button type="button" class="mp-btn" @click="resumeAutoSave">▶ 继续上一局</button>
        <button type="button" class="mp-btn mp-btn-ghost" @click="discardAutoSave">开始新局</button>
      </div>
    </div>

    <!-- 结算 -->
    <div v-if="phase !== 'play'" class="mp-result">
      <div class="mp-card">
        <div class="mp-title">{{ phase === 'win' ? '宇宙诞生 · 通关！' : '堆叠过高 · 本局结束' }}</div>
        <p class="mp-sub">
          {{ phase === 'win' ? '你把一颗陨石一路合成到了终极宇宙' : '星球越过警戒线太久，再放低一点、堆稳一点' }}
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

.mp-toast {
  position: absolute;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 36px);
  transform: translateX(-50%);
  z-index: 12;
  padding: 9px 18px;
  border-radius: 999px;
  background: rgba(16, 22, 44, 0.82);
  border: 1px solid rgba(140, 180, 255, 0.3);
  color: #dce8ff;
  font-size: 13px;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  pointer-events: none;
}
.mp-toast-enter-active,
.mp-toast-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.mp-toast-enter-from,
.mp-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

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
.mp-btn + .mp-btn {
  margin-left: 10px;
}
.mp-btn-ghost {
  background: transparent;
  color: #cfe0ff;
  border: 1px solid rgba(150, 190, 255, 0.4);
  box-shadow: none;
}
</style>
