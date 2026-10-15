/**
 * 本地存储：IndexedDB（复用 reusable-module/indexeddb-kv）。
 * 三表：documents / chunks / conversations；Float32 向量以普通 number[] 结构化克隆存储。
 */
import {
  putValue,
  getAllValues,
  getValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { KBDocument, KBChunk, Conversation } from './types'

const DB_CFG: IndexedDBConfig = {
  dbName: 'fz-local-knowledge-base-v1',
  version: 1,
  stores: [
    { storeName: 'documents', keyPath: 'id', indexes: [['createdAt', 'createdAt']] },
    { storeName: 'chunks', keyPath: 'id', indexes: [['docId', 'docId']] },
    { storeName: 'conversations', keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] }
  ]
}

export async function listDocs(): Promise<KBDocument[]> {
  const docs = await getAllValues<KBDocument>(DB_CFG, 'documents')
  return docs.sort((a, b) => b.createdAt - a.createdAt)
}

export async function countDocs(): Promise<number> {
  return (await listDocs()).length
}

export async function saveDoc(doc: KBDocument): Promise<void> {
  await putValue(DB_CFG, 'documents', doc)
}

export async function getDoc(id: string): Promise<KBDocument | undefined> {
  return getValue<KBDocument>(DB_CFG, 'documents', id)
}

export async function deleteDoc(docId: string): Promise<void> {
  const chunks = await listChunks()
  await Promise.all(chunks.filter((c) => c.docId === docId).map((c) => removeValue(DB_CFG, 'chunks', c.id)))
  await removeValue(DB_CFG, 'documents', docId)
}

export async function listChunks(): Promise<KBChunk[]> {
  return getAllValues<KBChunk>(DB_CFG, 'chunks')
}

export async function saveChunk(chunk: KBChunk): Promise<void> {
  await putValue(DB_CFG, 'chunks', chunk)
}

export async function saveChunks(chunks: KBChunk[]): Promise<void> {
  await Promise.all(chunks.map((c) => saveChunk(c)))
}

/** 删除某文档旧向量（重建索引用） */
export async function replaceChunks(docId: string, chunks: KBChunk[]): Promise<void> {
  const old = await listChunks()
  await Promise.all(old.filter((c) => c.docId === docId).map((c) => removeValue(DB_CFG, 'chunks', c.id)))
  await saveChunks(chunks)
}

export async function listConversations(): Promise<Conversation[]> {
  const convs = await getAllValues<Conversation>(DB_CFG, 'conversations')
  return convs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveConversation(conv: Conversation): Promise<void> {
  // 落库前解包为普通对象（调用方传入的可能是 Vue reactive proxy，保证可结构化克隆）
  const plain: Conversation = JSON.parse(JSON.stringify(conv))
  await putValue(DB_CFG, 'conversations', plain)
}

export async function deleteConversation(id: string): Promise<void> {
  await removeValue(DB_CFG, 'conversations', id)
}

export function newId(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
