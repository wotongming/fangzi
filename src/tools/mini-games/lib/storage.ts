/**
 * 小游戏合集本地存储（最高分 + 可选设置）。
 *
 * 向后兼容（007 炫光系列升级）：
 * - 库名 / version / store / `best` 结构一律不变，旧用户历史最高分零迁移、不丢失；
 * - 仅在同一 state 文档内新增“可选”的 settings 字段；旧文档没有该字段时读取按默认值回退，
 *   读取本身不回写库，只有用户显式改设置时才落库。
 */
import { getValue, putValue, type IndexedDBConfig } from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import {
  DEFAULT_SETTINGS,
  normalizeState,
  type MiniGameSettings,
  type MiniGameState,
  type PersistedState
} from './normalize-state'

const DB: IndexedDBConfig = {
  dbName: 'fz-mini-games-v1',
  version: 1,
  stores: [{ storeName: 'kv', keyPath: 'id' }]
}

export { DEFAULT_SETTINGS, normalizeState }
export type { MiniGameSettings, MiniGameState, PersistedState }

export function bestKey(gameId: string, difficulty: string): string {
  return `${gameId}:${difficulty}`
}

export async function loadState(): Promise<MiniGameState> {
  const raw = await getValue<PersistedState>(DB, 'kv', 'state')
  // 仅在内存合并默认值，不回写旧库；缺省字段逐项回退，保证旧用户无感升级。
  return normalizeState(raw)
}

/** 写入某个游戏/难度的最高分（结构与历史版本完全一致）。 */
export async function saveBest(best: Record<string, number>): Promise<void> {
  const cur = await getValue<PersistedState>(DB, 'kv', 'state')
  await persistState({ best, settings: cur?.settings })
}

/** 更新设置（合并已有设置后整体落库，保留 best）。 */
export async function saveSettings(patch: Partial<MiniGameSettings>): Promise<MiniGameState> {
  const cur = await loadState()
  const settings: MiniGameSettings = { ...cur.settings, ...patch }
  await persistState({ best: cur.best, settings })
  return { best: cur.best, settings }
}

export async function persistState(state: PersistedState): Promise<void> {
  // 调用方传入的可能是 Vue 响应式 Proxy（IndexedDB 无法结构化克隆）；
  // 这里展开成纯对象（字段值均为原始类型/字面量联合），再落库。
  const best: Record<string, number> = { ...state.best }
  const s = state.settings ?? DEFAULT_SETTINGS
  await putValue(DB, 'kv', {
    id: 'state',
    best,
    settings: { muted: s.muted, vibrate: s.vibrate, particle: s.particle }
  })
}
