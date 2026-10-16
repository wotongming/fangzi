/**
 * 本地存储：独立 IndexedDB 库 fz-resume-jd-v1。
 * 表：resumes（简历版本）、jds（岗位 JD）、applications（投递记录）。
 * 复用 reusable-module/indexeddb-kv。
 */
import {
  getAllValues,
  openIndexedDB,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { ApplicationRecord, JdRecord, ResumeVersion } from './types'

const CFG: IndexedDBConfig = {
  dbName: 'fz-resume-jd-v1',
  version: 1,
  stores: [
    { storeName: 'resumes', keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },
    { storeName: 'jds', keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },
    { storeName: 'applications', keyPath: 'id', indexes: [['status', 'status'], ['appliedAt', 'appliedAt']] }
  ]
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 存入前做一次 JSON 深拷贝，解除 Vue reactive Proxy（与仓内范式一致） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export async function listResumes(): Promise<ResumeVersion[]> {
  const all = await getAllValues<ResumeVersion>(CFG, 'resumes')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function saveResume(r: ResumeVersion): Promise<void> {
  await putValue(CFG, 'resumes', clone(r))
}
export async function deleteResume(id: string): Promise<void> {
  await removeValue(CFG, 'resumes', id)
}

export async function listJds(): Promise<JdRecord[]> {
  const all = await getAllValues<JdRecord>(CFG, 'jds')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function saveJd(j: JdRecord): Promise<void> {
  await putValue(CFG, 'jds', clone(j))
}
export async function deleteJd(id: string): Promise<void> {
  await removeValue(CFG, 'jds', id)
}

export async function listApplications(): Promise<ApplicationRecord[]> {
  const all = await getAllValues<ApplicationRecord>(CFG, 'applications')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function saveApplication(a: ApplicationRecord): Promise<void> {
  await putValue(CFG, 'applications', clone(a))
}
export async function deleteApplication(id: string): Promise<void> {
  await removeValue(CFG, 'applications', id)
}

export async function ensureDb(): Promise<void> {
  await openIndexedDB(CFG)
}
