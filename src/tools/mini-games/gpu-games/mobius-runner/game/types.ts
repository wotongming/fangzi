/**
 * 莫比环 MÖBIUS —— 纯逻辑类型定义
 * 本文件及同目录 rng/geometry/difficulty/logic 不得 import three 或 DOM，保证可在 node:test 直测。
 */

/** 玩家所在面（相对当前弧长处的局部带面法向量）：0=+N 侧，1=-N 侧 */
export type Face = 0 | 1

export type RunStatus = 'ready' | 'running' | 'dead' | 'paused'

export type FxTier = 'auto' | 'high' | 'low'

export interface Settings {
  /** 静音 */
  muted: boolean
  /** 震动（移动端） */
  vibrate: boolean
  /** 特效档 */
  fx: FxTier
  /** 降低动态（关闭相机翻滚/bloom/大幅震屏） */
  reduceMotion: boolean
}

/** 闸门：横跨带宽、仅占一面的墙，另一面为可通过的缺口 */
export interface Gate {
  /** 闸门所在弧长（米） */
  u: number
  /** 墙所在面；另一面即缺口 */
  wallFace: Face
  /** 缺口是否会随弧长移动（预留） */
  kind: 'solid' | 'moving'
  /** 玩家是否已越过本闸（结算去重） */
  passed: boolean
}

/** 光屑：在指定弧长的某一面，玩家该时刻处于该面即收集 */
export interface Shard {
  u: number
  face: Face
  taken: boolean
  /** 是否已结算（越过即标记，避免重复计数） */
  passed: boolean
}

/** 单步产生的反馈事件，供渲染/音效/震屏消费 */
export type GameEvent =
  | 'flip'
  | 'gate'
  | 'perfect'
  | 'near'
  | 'collect'
  | 'death'
  | 'revive'
  | 'twist-in'
  | 'twist-out'

export interface GameState {
  seed: number
  status: RunStatus
  /** 已前进弧长（米） */
  distance: number
  /** 当前速度（米/秒） */
  speed: number
  /** 玩家所在面 */
  face: Face
  /** 闸门队列（仅保留玩家附近窗口） */
  gates: Gate[]
  /** 光屑队列 */
  shards: Shard[]
  /** 下一个待生成闸门的弧长 */
  nextGateU: number
  /** 下一个待生成光屑的弧长 */
  nextShardU: number
  /** 本局得分 */
  score: number
  /** 连续“有风格通过”数 */
  combo: number
  /** 当前倍率（1..MULT_CAP） */
  multiplier: number
  /** 本局收集光屑 */
  shardsRun: number
  /** 最近一次翻转时的弧长（用于判定擦门/完美时机） */
  lastFlipU: number
  /** 上一帧是否处于扭转区（边沿检测用） */
  inTwist: boolean
  /** 无敌剩余秒数（续命后短暂无敌） */
  invincible: number
  /** 本局是否已使用续命 */
  reviveUsed: boolean
  /** 本步产生的事件（每步清空） */
  events: GameEvent[]
  /** 距前方扭转区起点（米），无则 null（相机/UI/音效预告） */
  twistAhead: number | null
  /** 死亡弧长，便于结算面板/测试 */
  deathAt: number | null
}

export interface RunOptions {
  seed?: number
  /** 测试用：从指定弧长开始（并据此预生成闸门） */
  startDistance?: number
}

/** 向量三元组（不依赖 three 的纯数值标架） */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 弧长处的局部 Frenet 标架 */
export interface Frame {
  center: Vec3
  tangent: Vec3
  /** 带宽横向方向 */
  across: Vec3
  /** 带面法向（随半扭转 0→π 连续旋转） */
  normal: Vec3
  /** 当前累计扭转角（弧度） */
  twist: number
}
