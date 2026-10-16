/**
 * 训练记录本地存储：IndexedDB 单表 sessions（复用 reusable-module/indexeddb-kv）。
 * 只存计数/评分/时长/问题等数值，绝不含任何画面或音频。
 */
import {
  putValue,
  getAllValues,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { SessionRecord } from './types'

const DB_CFG: IndexedDBConfig = {
  dbName: 'fz-pose-coach-v1',
  version: 1,
  stores: [{ storeName: 'sessions', keyPath: 'id', indexes: [['createdAt', 'createdAt'], ['exerciseId', 'exerciseId']] }]
}

export function newId(): string {
  return 'pc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function listSessions(): Promise<SessionRecord[]> {
  const rows = await getAllValues<SessionRecord>(DB_CFG, 'sessions')
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveSession(record: SessionRecord): Promise<void> {
  const plain: SessionRecord = JSON.parse(JSON.stringify(record))
  await putValue(DB_CFG, 'sessions', plain)
}

export async function deleteSession(id: string): Promise<void> {
  await removeValue(DB_CFG, 'sessions', id)
}

/** 最近 N 条，按时间正序（趋势图用） */
export async function recentSessions(n = 20): Promise<SessionRecord[]> {
  const all = await listSessions()
  return all.slice(0, n).reverse()
}
