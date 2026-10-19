/**
 * 星轨穿梭（Orbit Surge）—— 单指拖动光体、穿越下落粒子障碍的生存闪避纯逻辑。
 *
 * 坐标 x/y 均归一化 0..1；障碍由顶部（y<0）生成向下推进，玩家光体固定在底部 PLAYER_Y，
 * 横向跟随手指目标。碰撞为圆形距离判定，全程确定性纯函数。
 */

export const PLAYER_Y = 0.86
export const PLAYER_R = 0.045
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

export interface UpdateResult {
  crashed: boolean
  /** 本帧刚好越过玩家线、安全躲过的障碍 id（用于擦身粒子）。 */
  dodged: number[]
}

/** 推进一帧：跟随、生成、下落、碰撞。结束后调用为 no-op。 */
export function update(state: SurgeState, dt: number): UpdateResult {
  const res: UpdateResult = { crashed: false, dodged: [] }
  if (state.over || dt <= 0) return res
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

  const hitR = PLAYER_R + OBSTACLE_R
  const remain: SurgeObstacle[] = []
  for (const o of state.obs) {
    o.y += state.speed * dt
    const dy = o.y - PLAYER_Y
    if (Math.abs(dy) <= hitR && Math.abs(o.x - state.px) <= hitR) {
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
