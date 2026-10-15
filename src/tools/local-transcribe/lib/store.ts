/**
 * 转写历史本地存储：IndexedDB 单表 transcripts（复用 reusable-module/indexeddb-kv）。
 * 音频本体不落库（体积大、且属敏感数据），仅保存文本/分段/纪要与元信息。
 */
import {
  putValue,
  getAllValues,
  getValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { TranscriptRecord } from './types'

const DB_CFG: IndexedDBConfig = {
  dbName: 'fz-local-transcribe-v1',
  version: 1,
  stores: [{ storeName: 'transcripts', keyPath: 'id', indexes: [['createdAt', 'createdAt']] }]
}

export function newId(): string {
  return 'tr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function listRecords(): Promise<TranscriptRecord[]> {
  const rows = await getAllValues<TranscriptRecord>(DB_CFG, 'transcripts')
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getRecord(id: string): Promise<TranscriptRecord | undefined> {
  return getValue<TranscriptRecord>(DB_CFG, 'transcripts', id)
}

export async function saveRecord(record: TranscriptRecord): Promise<void> {
  // 解包 Vue reactive proxy，保证可结构化克隆
  const plain: TranscriptRecord = JSON.parse(JSON.stringify(record))
  await putValue(DB_CFG, 'transcripts', plain)
}

export async function deleteRecord(id: string): Promise<void> {
  await removeValue(DB_CFG, 'transcripts', id)
}
