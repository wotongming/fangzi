/**
 * 合成大星球（Merge Planet）—— 纯玩法逻辑（无 DOM / Canvas / matter 依赖，可单测）。
 *
 * 负责：11 级进化链定义、同级合并判定与升级结果、计分与连击加成、投放冷却/下落占用、
 * 越顶警戒线持续计时（瞬时擦过不死）、最高分纯函数。物理引擎与画面渲染只消费这里的结论。
 *
 * 美术全部由本游戏渲染层按通用天体概念程序化绘制，不含任何第三方版权 IP 素材。
 */

/** 单个进化层级的静态定义（半径系数 / 基础分 / 渲染配色均为纯数据）。 */
export interface TierDef {
  index: number
  /** 机器 id（与渲染层一一对应） */
  id: string
  /** 中文名（通用天体概念，原创命名） */
  name: string
  /** 相对半径系数（以最大球为 1.0 附近），物理体半径 = 棋盘基准半径 × 该系数 */
  radius: number
  /** 合成出该级时的基础分（未含连击加成） */
  baseScore: number
  /** 主色 HSL（渲染层取色，仅数据） */
  hue: number
  sat: number
  light: number
}

/**
 * 进化链（11 级）：陨石 → 月球 → 水星 → 火星 → 地球 → 海王星 → 天王星 → 土星(带环) → 木星 → 太阳 → 黑洞。
 * 半径逐级增大；分值按等级平方/指数递增；合成第 10 级（黑洞）即通关大爆发结算。
 */
export const TIERS: TierDef[] = [
  { index: 0, id: 'meteorite', name: '陨石', radius: 0.42, baseScore: 10, hue: 24, sat: 14, light: 42 },
  { index: 1, id: 'moon', name: '月球', radius: 0.5, baseScore: 20, hue: 220, sat: 8, light: 66 },
  { index: 2, id: 'mercury', name: '水星', radius: 0.58, baseScore: 30, hue: 28, sat: 18, light: 58 },
  { index: 3, id: 'mars', name: '火星', radius: 0.66, baseScore: 50, hue: 12, sat: 62, light: 52 },
  { index: 4, id: 'earth', name: '地球', radius: 0.74, baseScore: 80, hue: 210, sat: 70, light: 46 },
  { index: 5, id: 'neptune', name: '海王星', radius: 0.82, baseScore: 120, hue: 222, sat: 78, light: 48 },
  { index: 6, id: 'uranus', name: '天王星', radius: 0.9, baseScore: 180, hue: 174, sat: 58, light: 66 },
  { index: 7, id: 'saturn', name: '土星', radius: 1.0, baseScore: 260, hue: 42, sat: 48, light: 66 },
  { index: 8, id: 'jupiter', name: '木星', radius: 1.1, baseScore: 380, hue: 32, sat: 52, light: 64 },
  { index: 9, id: 'sun', name: '太阳', radius: 1.2, baseScore: 550, hue: 44, sat: 96, light: 58 },
  { index: 10, id: 'blackhole', name: '黑洞', radius: 1.3, baseScore: 1000, hue: 262, sat: 70, light: 30 }
]

export const TIER_COUNT = TIERS.length
export const FINAL_TIER = TIER_COUNT - 1

/** 连击窗口：一次合成后在此毫秒内再次合成计入连锁。 */
export const COMBO_WINDOW_MS = 900
/** 投放冷却：一次投放后需等待该毫秒才允许再次投放。 */
export const DROP_COOLDOWN_MS = 380
/** 越顶死亡线：球体越过警戒线并持续该毫秒才判负（瞬时擦过不算）。 */
export const DEATH_LINE_MS = 1750
/** 警戒线持续超过该比例即开始闪烁警告（未到判负）。 */
export const WARNING_RATIO = 0.5
/** 可直接投出的最高初级（开局只在前 4 级里随机）。 */
export const MAX_SPAWN_TIER = 3

/** 同级才合并。 */
export function sameTier(a: number, b: number): boolean {
  return a === b && a >= 0 && a <= FINAL_TIER
}

/** 合成升级：返回上一级 index；已是终极（黑洞）返回 null（不可再合）。 */
export function nextTierIndex(current: number): number | null {
  if (current < 0 || current >= FINAL_TIER) return null
  return current + 1
}

export function isFinal(tier: number): boolean {
  return tier === FINAL_TIER
}

/**
 * 合成计分：基础分 × 连击倍率（第 1 击 ×1，每多一连 ×1.3，四舍五入取整）。
 * combo 从 1 起；非法 combo 按 1 处理。
 */
export function mergeScore(producedTier: number, combo: number): number {
  const tier = TIERS[producedTier]
  if (!tier) return 0
  const c = Number.isFinite(combo) && combo >= 1 ? Math.floor(combo) : 1
  const mult = 1 + 0.3 * (c - 1)
  return Math.round(tier.baseScore * mult)
}

/**
 * 投放随机：只在前 MAX_SPAWN_TIER 级内按权重随机（低级更常见）。
 * 注入 rng() ∈ [0,1)，便于单测复现；不注入时退化为 Math.random。
 */
export function rollSpawnTier(rng: () => number = Math.random): number {
  // 权重：陨石 5、月球 3、水星 2、火星 1（合计 11）。
  const weights = [5, 3, 2, 1]
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rng() * total
  for (let i = 0; i <= MAX_SPAWN_TIER; i++) {
    const w = weights[i] ?? 1
    if (r < w) return i
    r -= w
  }
  return 0
}

/**
 * 投放闸门：冷却未到 / 上一颗仍在下落占用中，都不允许再投。
 * inFlight 由物理层判断（已投球尚未落地/未进入稳定堆叠）。
 */
export function canDrop(now: number, lastDropAt: number, inFlight: boolean, cooldownMs: number = DROP_COOLDOWN_MS): boolean {
  if (inFlight) return false
  return now - lastDropAt >= cooldownMs
}

/** 越顶计时状态机：anyAbove 表示本帧是否有球体越过警戒线；离开即清零，持续累计才死。 */
export interface OverlineState {
  /** 连续越过的累计毫秒 */
  timer: number
  dead: boolean
}

export function createOverline(): OverlineState {
  return { timer: 0, dead: false }
}

export interface OverlineTick {
  dead: boolean
  /** 已进入警告（持续过半）但尚未判负，用于警戒线闪烁+提示音 */
  warning: boolean
}

export function updateOverline(
  st: OverlineState,
  anyAbove: boolean,
  dtMs: number,
  thresholdMs: number = DEATH_LINE_MS
): OverlineTick {
  if (st.dead) return { dead: true, warning: true }
  if (!anyAbove) {
    st.timer = 0
    return { dead: false, warning: false }
  }
  st.timer += dtMs
  if (st.timer >= thresholdMs) {
    st.dead = true
    return { dead: true, warning: true }
  }
  return { dead: false, warning: st.timer >= thresholdMs * WARNING_RATIO }
}

/** 瞄准横坐标夹取到墙体范围内（纯函数，组件传入墙内边距）。 */
export function clampAim(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return (min + max) / 2
  if (min > max) return (min + max) / 2
  return Math.min(max, Math.max(min, x))
}

/** 局部坐标矩形（x/y 左上角，w/h 宽高），用于顶部 HUD 避让。 */
export interface Rect2 {
  x: number
  y: number
  w: number
  h: number
}

/** 两矩形是否相交（pad 为额外外扩间距，用于保守判空）。 */
export function rectsOverlap(a: Rect2, b: Rect2, pad = 0): boolean {
  return (
    a.x <= b.x + b.w + pad &&
    b.x <= a.x + a.w + pad &&
    a.y <= b.y + b.h + pad &&
    b.y <= a.y + a.h + pad
  )
}

/** 待投球与避让 HUD 之间的水平呼吸间距（px），避免发光边缘贴住文字。 */
export const AIM_HUD_GAP = 10

export interface AimRange {
  min: number
  max: number
}

/**
 * 计算待投球瞄准中心 X 的允许区间（纯函数，组件实测 HUD 包围盒后传入）。
 *
 * - 球完整包围盒 = 半径 + 发光外扩 reach，在顶部滑轨带内水平移动；
 * - 仅当 HUD 与滑轨带在垂直方向也相交时才做水平避让，HUD 按中心落在左/右半屏归为左/右边界；
 * - 依据 HUD **实际包围盒**避让（胶囊随长星球名变宽会自动内缩），不写死小常数；
 * - 避让后若区间被压没（min>max，窄屏/HUD 过宽），回退为墙内居中可投，保证至少一个可投点，
 *   且不把左右可投范围过度压缩。
 */
export function planAimRange(opts: {
  width: number
  radius: number
  glow: number
  wallPad: number
  bandY: number
  bandH: number
  avoid?: Rect2[]
}): AimRange {
  const reach = Math.max(0, opts.radius) + Math.max(0, opts.glow)
  const band: Rect2 = { x: 0, y: opts.bandY, w: opts.width, h: opts.bandH }
  let min = opts.wallPad + reach
  let max = opts.width - opts.wallPad - reach
  // 画布过窄导致墙内区间非法：直接居中兜底
  if (min > max) {
    const c = opts.width / 2
    return { min: c, max: c }
  }
  for (const hud of opts.avoid ?? []) {
    if (!rectsOverlap(band, hud, AIM_HUD_GAP)) continue
    const center = hud.x + hud.w / 2
    if (center >= opts.width / 2) {
      // 右侧 HUD（如「下一个」胶囊）：球右缘 ≤ HUD 左缘 - gap
      const limit = hud.x - reach - AIM_HUD_GAP
      if (limit < max) max = limit
    } else {
      // 左侧 HUD（如左上分数）：球左缘 ≥ HUD 右缘 + gap
      const limit = hud.x + hud.w + reach + AIM_HUD_GAP
      if (limit > min) min = limit
    }
  }
  // 避让后区间被压没：不压没可投范围，回退墙内居中
  if (min > max) {
    const c = (opts.wallPad + reach + opts.width - opts.wallPad - reach) / 2
    return { min: c, max: c }
  }
  return { min, max }
}

/** 最高分纯函数：返回新最高分与是否刷新纪录（持久化由宿主 storage 负责）。 */
export function recordBest(prev: number, score: number): { best: number; isNewBest: boolean } {
  const p = Number.isFinite(prev) && prev >= 0 ? Math.floor(prev) : 0
  const s = Number.isFinite(score) && score >= 0 ? Math.floor(score) : 0
  const best = Math.max(p, s)
  return { best, isNewBest: s > p }
}
