/**
 * 莫比环跑酷本地存档（并入小游戏合集后仍沿用独立库 fz-mobius-runner-v1，
 * 保证独立工具时代的最高分/局数零迁移保留）。
 * 相对路径：本文件位于 mini-games/gpu-games/mobius-runner/game/，到仓库根 reusable-module 需上溯 6 层。
 */
import {
  openIndexedDB,
  putValue,
  getValue,
  type IndexedDBConfig
} from '../../../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { Settings } from './types'

export const DB_NAME = 'fz-mobius-runner-v1'
export const STORE = 'kv'
export const STATE_ID = 'state'

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  vibrate: true,
  fx: 'auto',
  reduceMotion: false
}

export interface MobiusStateRecord {
  id: string
  best?: number
  totalShards?: number
  runs?: number
  unlockedThemes?: string[]
  /** 新手教学是否已看过 */
  tutorialSeen?: boolean
  /** 当前选中的原创角色 id */
  characterId?: string
  /** 是否已展示过开跑前角色选择 */
  introDone?: boolean
  settings?: Partial<Settings>
}

export const DB_CFG: IndexedDBConfig = {
  dbName: DB_NAME,
  version: 1,
  stores: [{ storeName: STORE, keyPath: 'id' }]
}

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS }
}

/** 合并存档 settings 与默认值，保证字段齐全 */
export function resolveSettings(rec?: MobiusStateRecord | null): Settings {
  const s = rec?.settings ?? {}
  return {
    muted: typeof s.muted === 'boolean' ? s.muted : DEFAULT_SETTINGS.muted,
    vibrate: typeof s.vibrate === 'boolean' ? s.vibrate : DEFAULT_SETTINGS.vibrate,
    fx: s.fx === 'high' || s.fx === 'low' ? s.fx : 'auto',
    reduceMotion: typeof s.reduceMotion === 'boolean' ? s.reduceMotion : DEFAULT_SETTINGS.reduceMotion
  }
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

function safeStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** 读出并规范化存档；任何异常（隐私模式/不支持）回退到空存档，绝不抛错 */
export async function loadState(): Promise<MobiusStateRecord> {
  try {
    const rec = await getValue<MobiusStateRecord>(DB_CFG, STORE, STATE_ID)
    if (!rec) return { id: STATE_ID, best: 0, totalShards: 0, runs: 0, unlockedThemes: [] }
    return {
      id: STATE_ID,
      best: safeNumber(rec.best),
      totalShards: safeNumber(rec.totalShards),
      runs: safeNumber(rec.runs),
      unlockedThemes: safeStringArray(rec.unlockedThemes),
      tutorialSeen: rec.tutorialSeen === true,
      characterId: typeof rec.characterId === 'string' ? rec.characterId : undefined,
      introDone: rec.introDone === true,
      settings: resolveSettings(rec)
    }
  } catch {
    return { id: STATE_ID, best: 0, totalShards: 0, runs: 0, unlockedThemes: [] }
  }
}

/** 局部保存（合并到已有存档）；异常吞掉并返回 false，由调用方提示 */
export async function saveState(patch: Partial<Omit<MobiusStateRecord, 'id'>>): Promise<boolean> {
  try {
    await openIndexedDB(DB_CFG)
    const cur = (await loadState()) as MobiusStateRecord
    const next: MobiusStateRecord = {
      id: STATE_ID,
      best: Math.max(cur.best ?? 0, safeNumber(patch.best ?? cur.best)),
      totalShards: Math.max(cur.totalShards ?? 0, safeNumber(patch.totalShards ?? cur.totalShards)),
      runs: Math.max(cur.runs ?? 0, safeNumber(patch.runs ?? cur.runs)),
      unlockedThemes: Array.from(new Set([...(cur.unlockedThemes ?? []), ...safeStringArray(patch.unlockedThemes)])),
      tutorialSeen: patch.tutorialSeen ?? cur.tutorialSeen ?? false,
      characterId: typeof patch.characterId === 'string' ? patch.characterId : cur.characterId,
      introDone: patch.introDone ?? cur.introDone ?? false,
      settings: { ...resolveSettings(cur), ...(patch.settings ?? {}) }
    }
    await putValue(DB_CFG, STORE, next)
    return true
  } catch {
    return false
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await loadState()
  const settings = { ...resolveSettings(cur), ...patch }
  await saveState({ settings })
  return settings
}

export async function recordRunResult(score: number, shards: number): Promise<{ best: number; isNewBest: boolean }> {
  const cur = await loadState()
  const best = Math.max(cur.best ?? 0, Math.floor(score))
  await saveState({
    best,
    runs: (cur.runs ?? 0) + 1,
    totalShards: (cur.totalShards ?? 0) + shards
  })
  return { best, isNewBest: best > (cur.best ?? 0) }
}
