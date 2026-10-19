/**
 * store.ts —— IndexedDB 数据层（复用 reusable-module/indexeddb-kv）。
 * 独立库 fangzi-exam-review v1，四表：projects / questions / reviews / mockExams。
 * 写库前对入参做 toRaw 解代理（在组件侧统一处理），这里只接受纯对象。
 */
import {
  getAllValues,
  openIndexedDB,
  putValue,
  removeValue,
  type IndexedDBConfig
} from '../../../../reusable-module/indexeddb-kv/indexeddb-kv'
import type { MockExam, Project, Question, ReviewLog } from './models'

export const DB_NAME = 'fangzi-exam-review'
export const DB_VERSION = 1

const cfg: IndexedDBConfig = {
  dbName: DB_NAME,
  version: DB_VERSION,
  stores: [
    { storeName: 'projects', keyPath: 'id' },
    {
      storeName: 'questions',
      keyPath: 'id',
      indexes: [
        ['projectId', 'projectId'],
        ['nextReview', 'nextReview']
      ]
    },
    {
      storeName: 'reviews',
      keyPath: 'id',
      indexes: [
        ['questionId', 'questionId'],
        ['ts', 'ts']
      ]
    },
    {
      storeName: 'mockExams',
      keyPath: 'id',
      indexes: [['projectId', 'projectId']]
    }
  ]
}

export function openDB(): Promise<IDBDatabase> {
  return openIndexedDB(cfg)
}

// —— 通用 CRUD ——
export async function getAllProjects(): Promise<Project[]> {
  return getAllValues<Project>(cfg, 'projects')
}
export async function getAllQuestions(): Promise<Question[]> {
  return getAllValues<Question>(cfg, 'questions')
}
export async function getAllReviews(): Promise<ReviewLog[]> {
  return getAllValues<ReviewLog>(cfg, 'reviews')
}
export async function getAllMockExams(): Promise<MockExam[]> {
  return getAllValues<MockExam>(cfg, 'mockExams')
}

export function putProject(v: Project): Promise<IDBValidKey> {
  return putValue(cfg, 'projects', v)
}
export function putQuestion(v: Question): Promise<IDBValidKey> {
  return putValue(cfg, 'questions', v)
}
export function putReview(v: ReviewLog): Promise<IDBValidKey> {
  return putValue(cfg, 'reviews', v)
}
export function putMockExam(v: MockExam): Promise<IDBValidKey> {
  return putValue(cfg, 'mockExams', v)
}

export function removeProject(id: string): Promise<undefined> {
  return removeValue(cfg, 'projects', id)
}
export function removeQuestion(id: string): Promise<undefined> {
  return removeValue(cfg, 'questions', id)
}
export function removeMockExam(id: string): Promise<undefined> {
  return removeValue(cfg, 'mockExams', id)
}

/** 删除项目时级联删除其错题、复习日志与模考记录。 */
export async function deleteProjectCascade(projectId: string): Promise<void> {
  const [qs, rs, ms] = await Promise.all([getAllQuestions(), getAllReviews(), getAllMockExams()])
  for (const q of qs.filter((x) => x.projectId === projectId)) await removeQuestion(q.id)
  const qIds = new Set(qs.filter((x) => x.projectId === projectId).map((x) => x.id))
  for (const r of rs.filter((x) => qIds.has(x.questionId))) await removeValue(cfg, 'reviews', r.id)
  for (const m of ms.filter((x) => x.projectId === projectId)) await removeMockExam(m.id)
  await removeProject(projectId)
}

// —— 导出 / 导入（全库 JSON，按 id 去重合并） ——
export interface BackupShape {
  version: 1
  exportedAt: string
  projects: Project[]
  questions: Question[]
  reviews: ReviewLog[]
  mockExams: MockExam[]
}

export async function dumpAll(): Promise<BackupShape> {
  const [projects, questions, reviews, mockExams] = await Promise.all([
    getAllProjects(),
    getAllQuestions(),
    getAllReviews(),
    getAllMockExams()
  ])
  return { version: 1, exportedAt: new Date().toISOString(), projects, questions, reviews, mockExams }
}

export interface ImportResult {
  added: number
  skipped: number
}

/**
 * 合并导入：按 id 去重——已存在的 id 跳过（不覆盖本机更新的数据），
 * 不存在的新增。返回新增 / 跳过条数。
 */
export async function mergeImport(data: BackupShape): Promise<ImportResult> {
  if (!data || data.version !== 1) throw new Error('备份文件格式不正确')
  let added = 0
  let skipped = 0
  const tables: Array<[keyof Omit<BackupShape, 'version' | 'exportedAt'>, (v: never) => Promise<unknown>]> = [
    ['projects', putProject],
    ['questions', putQuestion],
    ['reviews', putReview],
    ['mockExams', putMockExam]
  ]
  for (const [name, put] of tables) {
    const rows = (data[name] as Array<{ id: string }>) ?? []
    const existing = new Set(
      name === 'projects'
        ? (await getAllProjects()).map((x) => x.id)
        : name === 'questions'
          ? (await getAllQuestions()).map((x) => x.id)
          : name === 'reviews'
            ? (await getAllReviews()).map((x) => x.id)
            : (await getAllMockExams()).map((x) => x.id)
    )
    for (const row of rows) {
      if (existing.has(row.id)) {
        skipped += 1
        continue
      }
      await put(row as never)
      added += 1
    }
  }
  return { added, skipped }
}
