/**
 * 合成大星球（Merge Planet）—— 单槽手动存档（纯逻辑，无 DOM / matter 依赖，可单测）。
 *
 * - 单一存档槽：再次存档覆盖旧档；与最高分（IndexedDB `fz-mini-games-v1`）完全隔离，
 *   读档 / 重开 / 存档都不清空、不错误改写最高分。
 * - localStorage（数据量小、零网络依赖、完全离线）；JSON 带 version / tool / chain / 时间戳。
 * - 反序列化严格校验：版本/结构损坏、tier 越界、位置非法、负分一律安全回退（视为无有效存档），
 *   绝不白屏或抛错；19 级表以后增减，旧档因 chain/version 不符被安全忽略而不崩。
 *
 * 物理引擎与组件只负责把刚体状态喂给这里、把校验后的结果重建回来。
 */

/** localStorage key（与最高分 key 并列、互不影响）。 */
export const SAVE_KEY = 'fangzi:merge-planet:save:v1'
/** 存档结构版本。 */
export const SAVE_VERSION = 1
/** 进化表标识：链条/规模变化后改动它，旧档因标识不符被安全忽略。 */
export const CHAIN_ID = 'merge-planet:tiers:19:v1'
export const TOOL_ID = 'merge-planet'

/** 单颗球的可序列化刚体状态（像素坐标，恢复时再按当前视口夹取）。 */
export interface SavedBall {
  tier: number
  x: number
  y: number
  angle: number
  vx: number
  vy: number
  av: number
}

/** 存档文件整体结构。 */
export interface SavePayload {
  version: number
  tool: string
  chain: string
  /** 存档时间戳 ms（epoch） */
  savedAt: number
  score: number
  /** 连击计数保留；连击窗口计时在恢复时重置为未触发（调用方清 lastMergeAt）。 */
  combo: number
  /** 顶部当前待投球 tier；未来投放照常随机，只存当前待投。 */
  currentTier: number
  balls: SavedBall[]
}

/** 序列化输入（组件从物理世界采集）。 */
export interface SerializeInput {
  score: number
  combo: number
  currentTier: number
  balls: SavedBall[]
}

/** 位置夹取边界（由组件按当前墙体/安全区给出）。 */
export interface SaveBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 序列化当前局面（savedAt 默认取当前 epoch，可注入便于单测）。 */
export function serializeSave(input: SerializeInput, savedAt: number = Date.now()): SavePayload {
  const balls = (input.balls ?? [])
    .filter(
      (b) =>
        b &&
        Number.isInteger(b.tier) &&
        isFiniteNum(b.x) &&
        isFiniteNum(b.y)
    )
    .map((b) => ({
      tier: Math.floor(b.tier),
      x: b.x,
      y: b.y,
      angle: isFiniteNum(b.angle) ? b.angle : 0,
      vx: isFiniteNum(b.vx) ? b.vx : 0,
      vy: isFiniteNum(b.vy) ? b.vy : 0,
      av: isFiniteNum(b.av) ? b.av : 0
    }))
  return {
    version: SAVE_VERSION,
    tool: TOOL_ID,
    chain: CHAIN_ID,
    savedAt: isFiniteNum(savedAt) && savedAt > 0 ? Math.floor(savedAt) : Date.now(),
    score: isFiniteNum(input.score) && input.score >= 0 ? Math.floor(input.score) : 0,
    combo: isFiniteNum(input.combo) && input.combo >= 1 ? Math.floor(input.combo) : 1,
    currentTier: Number.isInteger(input.currentTier) ? Math.floor(input.currentTier) : 0,
    balls
  }
}

/** 夹取数值到 [lo,hi]。 */
function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export interface ValidateResult {
  ok: boolean
  payload: SavePayload | null
  /** 因非法被丢弃的球数量。 */
  dropped: number
}

/**
 * 严格校验并清洗未知来源的存档原始对象。
 * - 版本/tool/chain 不符、JSON 结构损坏 → ok=false；
 * - tier 非整数或越界、位置非有限 → 丢弃该球；位置越界先 clamp 到场地内，仍非法丢弃；
 * - score/combo 非负有限，否则回退安全默认；整体绝不抛错。
 */
export function validateSave(raw: unknown, tierCount: number, bounds: SaveBounds): ValidateResult {
  const fail: ValidateResult = { ok: false, payload: null, dropped: 0 }
  if (!raw || typeof raw !== 'object') return fail
  const r = raw as Record<string, unknown>
  if (r.version !== SAVE_VERSION) return fail
  if (r.tool !== TOOL_ID) return fail
  if (r.chain !== CHAIN_ID) return fail
  if (!isFiniteNum(r.savedAt) || r.savedAt <= 0) return fail

  const score = isFiniteNum(r.score) && (r.score as number) >= 0 ? Math.floor(r.score as number) : 0
  const combo = isFiniteNum(r.combo) && (r.combo as number) >= 1 ? Math.floor(r.combo as number) : 1
  const currentTier =
    Number.isInteger(r.currentTier) && (r.currentTier as number) >= 0 && (r.currentTier as number) < tierCount
      ? Math.floor(r.currentTier as number)
      : 0

  let dropped = 0
  const balls: SavedBall[] = []
  if (Array.isArray(r.balls)) {
    for (const item of r.balls) {
      const b = item as Partial<SavedBall> | null
      if (!b || !Number.isInteger(b.tier)) { dropped++; continue }
      const tier = Math.floor(b.tier as number)
      if (tier < 0 || tier >= tierCount) { dropped++; continue }
      if (!isFiniteNum(b.x) || !isFiniteNum(b.y)) { dropped++; continue }
      const x = clampNum(b.x, bounds.minX, bounds.maxX)
      const y = clampNum(b.y, bounds.minY, bounds.maxY)
      balls.push({
        tier,
        x,
        y,
        angle: isFiniteNum(b.angle) ? b.angle : 0,
        vx: isFiniteNum(b.vx) ? b.vx : 0,
        vy: isFiniteNum(b.vy) ? b.vy : 0,
        av: isFiniteNum(b.av) ? b.av : 0
      })
    }
  }

  return {
    ok: true,
    dropped,
    payload: {
      version: SAVE_VERSION,
      tool: TOOL_ID,
      chain: CHAIN_ID,
      savedAt: Math.floor(r.savedAt as number),
      score,
      combo,
      currentTier,
      balls
    }
  }
}

/** MM-DD HH:mm（本地时区，纯格式化，不依赖 DOM）。 */
export function formatSaveTime(ts: number): string {
  if (!isFiniteNum(ts) || ts <= 0) return ''
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

// —— localStorage 适配（存储接口可注入，便于单测；默认用全局 localStorage）——

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* 隐私模式/不可用：返回 null，调用方安全回退 */
  }
  return null
}

/** 读原始存档字符串（不做校验），任何异常返回 null。 */
export function readSaveRaw(key: string, storage?: StorageLike | null): string | null {
  const s = storage ?? defaultStorage()
  if (!s) return null
  try {
    return s.getItem(key)
  } catch {
    return null
  }
}

/** 写入存档字符串，任何异常静默失败（不影响对局）。 */
export function writeSaveRaw(key: string, value: string, storage?: StorageLike | null): boolean {
  const s = storage ?? defaultStorage()
  if (!s) return false
  try {
    s.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** 删除手动存档（仅用于显式清除；重开/再来一局绝不调用）。 */
export function clearSave(key: string, storage?: StorageLike | null): void {
  const s = storage ?? defaultStorage()
  if (!s) return
  try {
    s.removeItem(key)
  } catch {
    /* ignore */
  }
}

/**
 * 读取并校验存档；损坏/版本不符/无存档 → null（调用方安全回退新开局，绝不抛错）。
 * bounds 由组件按当前视口墙体给出。
 */
export function loadSave(
  key: string,
  tierCount: number,
  bounds: SaveBounds,
  storage?: StorageLike | null
): SavePayload | null {
  const raw = readSaveRaw(key, storage)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const v = validateSave(parsed, tierCount, bounds)
  return v.ok ? v.payload : null
}

/** 仅读取存档元信息（时间/标签），用于选卡「继续游戏」入口；无效返回 null。 */
export function readSaveMeta(
  key: string,
  tierCount: number,
  bounds: SaveBounds,
  storage?: StorageLike | null
): { savedAt: number; label: string } | null {
  const p = loadSave(key, tierCount, bounds, storage)
  if (!p) return null
  return { savedAt: p.savedAt, label: formatSaveTime(p.savedAt) }
}

/** 持久化存档；返回是否写成功。 */
export function persistSave(payload: SavePayload, key: string, storage?: StorageLike | null): boolean {
  return writeSaveRaw(key, JSON.stringify(payload), storage)
}
