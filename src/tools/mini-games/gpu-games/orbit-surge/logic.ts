/**
 * 星轨穿梭（Orbit Surge）—— 单指拖动光体、穿越下落粒子障碍的生存闪避纯逻辑。
 *
 * 坐标 x/y 均归一化 0..1；障碍由顶部（y<0）生成向下推进，玩家光体固定在底部 PLAYER_Y，
 * 横向跟随手指目标。全程确定性纯函数。
 *
 * 碰撞判定：x/y 是各向异性的归一化坐标（竖屏上 1 个 y 单位的像素远大于 1 个 x 单位），
 * 不能在归一化空间里用同一个半径判横纵，否则纵向阈值会被屏幕高宽比放大（手机上约 2 倍），
 * 表现为“障碍还在头顶很远就撞死”。因此碰撞一律换算成真实 CSS 像素后做**圆形距离**判定，
 * 半径常量必须与 orbit-surge.vue 中 .orb 直径（玩家 36px / 障碍 34px）保持一致。
 */

export const PLAYER_Y = 0.86
/** 玩家光体半径（CSS 像素）；对应 .orb.player 直径 36px。 */
export const PLAYER_RADIUS_PX = 18
/** 障碍半径（CSS 像素）；对应 .orb.enemy 直径 34px。 */
export const ENEMY_RADIUS_PX = 17
/** 两圆边缘恰好接触时的圆心距（CSS 像素）。 */
export const CONTACT_PX = PLAYER_RADIUS_PX + ENEMY_RADIUS_PX
/** 仅用于障碍在屏外生成/回收的纵向缓冲（归一化，与碰撞无关）。 */
export const OBSTACLE_R = 0.052
/** 横向跟随速度（归一化/秒），越大越跟手。 */
export const FOLLOW_SPEED = 2.4
/** 初始 / 上限下落速度（归一化/秒）。 */
export const START_SPEED = 0.34
export const MAX_SPEED = 0.95
/** 每生存 1 秒得分。 */
export const SCORE_PER_SEC = 100

export interface SurgeObstacle {
  id: number
  x: number
  y: number
}

export interface SurgeState {
  px: number
  target: number
  obs: SurgeObstacle[]
  elapsed: number
  score: number
  best: number
  over: boolean
  speed: number
  nextSpawn: number
  nextId: number
}

export function newSurge(best = 0): SurgeState {
  return {
    px: 0.5,
    target: 0.5,
    obs: [],
    elapsed: 0,
    score: 0,
    best,
    over: false,
    speed: START_SPEED,
    nextSpawn: 0.45,
    nextId: 1
  }
}

export function setTarget(state: SurgeState, x: number): void {
  state.target = Math.max(0, Math.min(1, x))
}

function pickX(): number {
  // 留边距，保证障碍本体完整可见。
  return 0.08 + Math.random() * 0.84
}

export interface SurgeView {
  /** 游戏场 CSS 像素宽。 */
  w: number
  /** 游戏场 CSS 像素高。 */
  h: number
}

export interface UpdateResult {
  crashed: boolean
  /** 本帧刚好越过玩家线、安全躲过的障碍 id（用于擦身粒子）。 */
  dodged: number[]
}

/** 推进一帧：跟随、生成、下落、碰撞。结束后调用为 no-op。view 为游戏场像素尺寸，必传以保证碰撞与视觉一致。 */
export function update(state: SurgeState, dt: number, view: SurgeView): UpdateResult {
  const res: UpdateResult = { crashed: false, dodged: [] }
  if (state.over || dt <= 0) return res
  // 未布局（无有效尺寸）时本帧只推进计时之外的安全逻辑：直接返回，等下一帧拿到尺寸再判碰撞。
  if (!(view.w > 0) || !(view.h > 0)) return res
  state.elapsed += dt
  state.speed = Math.min(MAX_SPEED, START_SPEED + state.elapsed * 0.02)
  state.score = Math.floor(state.elapsed * SCORE_PER_SEC)
  if (state.score > state.best) state.best = state.score

  // 横向平滑跟随目标
  const maxMove = FOLLOW_SPEED * dt
  const d = state.target - state.px
  state.px += Math.abs(d) <= maxMove ? d : Math.sign(d) * maxMove

  // 生成障碍
  while (state.elapsed >= state.nextSpawn) {
    state.obs.push({ id: state.nextId++, x: pickX(), y: -OBSTACLE_R })
    // 速度越快生成越密，但保留可穿越间隔。
    const interval = Math.max(0.42, 0.95 - state.elapsed * 0.012)
    state.nextSpawn += interval
  }

  const contactSq = CONTACT_PX * CONTACT_PX
  const remain: SurgeObstacle[] = []
  for (const o of state.obs) {
    o.y += state.speed * dt
    // 在真实 CSS 像素尺度做圆形距离判定：消除竖屏高宽比对纵向阈值的拉伸。
    const dxPx = (o.x - state.px) * view.w
    const dyPx = (o.y - PLAYER_Y) * view.h
    if (dxPx * dxPx + dyPx * dyPx <= contactSq) {
      res.crashed = true
      // 碰撞的障碍不保留。
      continue
    }
    if (o.y > 1 + OBSTACLE_R) {
      // 已越过底部：若它经过玩家线时是安全的，记一次擦身（近似为越界即躲过）。
      res.dodged.push(o.id)
      continue
    }
    remain.push(o)
  }
  state.obs = remain

  if (res.crashed) {
    state.over = true
    if (state.score > state.best) state.best = state.score
  }
  return res
}
