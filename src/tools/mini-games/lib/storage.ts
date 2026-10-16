/**
 * 小游戏合集本地状态：最高分（按 游戏:难度 存键）。
 * 复用 reusable-module/indexeddb-kv（零依赖 IndexedDB 封装）；只存一个单例文档，体积极小。
 * 数据完全留在本机，不上传。
 */
import {
  putValue,
  getValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'

const DB_CFG: IndexedDBConfig = {
  dbName: 'fz-mini-games-v1',
  version: 1,
  stores: [{ storeName: 'kv', keyPath: 'id' }]
}

const DOC_ID = 'state'

export interface GamesState {
  /** key: `${gameId}:${difficulty}`，value：分数（统一约定为越高越好） */
  best: Record<string, number>
}

interface StateDoc extends GamesState {
  id: string
}

const DEFAULT_STATE: GamesState = { best: {} }

export function bestKey(gameId: string, difficulty: string): string {
  return `${gameId}:${difficulty}`
}

export async function loadState(): Promise<GamesState> {
  try {
    const doc = await getValue<StateDoc>(DB_CFG, 'kv', DOC_ID)
    if (doc && typeof doc === 'object') return { best: doc.best ?? {} }
  } catch {
    // 隐私模式 / IndexedDB 不可用时降级为纯内存
  }
  return { ...DEFAULT_STATE, best: {} }
}

/**
 * 仅当新分数更高时写回；返回最新的 best 映射（供界面即时刷新）。
 * 写库失败不抛出，避免影响游戏流程。
 */
export async function saveBest(
  gameId: string,
  difficulty: string,
  score: number,
  current: Record<string, number>
): Promise<Record<string, number>> {
  const key = bestKey(gameId, difficulty)
  const prev = current[key] ?? 0
  if (!(score > prev)) return current
  const best = { ...current, [key]: score }
  const doc: StateDoc = { id: DOC_ID, best }
  try {
    await putValue(DB_CFG, 'kv', doc)
  } catch {
    /* 忽略持久化失败，内存里仍更新 */
  }
  return best
}

/** 直接把整份 best 映射落库（用于防抖/离开页面前统一持久化）。 */
export async function persistState(current: Record<string, number>): Promise<void> {
  const doc: StateDoc = { id: DOC_ID, best: current }
  try {
    await putValue(DB_CFG, 'kv', doc)
  } catch {
    /* 忽略持久化失败 */
  }
}
