/**
 * merge.ts —— 导入合并纯函数（按主键 id upsert，同 id 取 updatedAt 晚者）。
 * 不碰 IndexedDB / DOM，便于单测；DB 落库由 backup.ts 编排。
 */

export interface MergeResult<T> {
  record: T
  status: 'added' | 'updated' | 'kept'
}

/**
 * 单条合并：无现存 → added；同 id 且 incoming.updatedAt 不早于现存 → updated（取 incoming）；
 * 现存更新或时间相同 → kept（保留现存，不覆盖）。
 * 无 updatedAt 的记录（如 docs）退化为 createdAt 比较。
 */
export function mergeRecord<T extends { id: string; updatedAt?: number; createdAt?: number }>(
  existing: T | undefined,
  incoming: T
): MergeResult<T> {
  if (!existing) return { record: incoming, status: 'added' }
  const exT = existing.updatedAt ?? existing.createdAt ?? 0
  const inT = incoming.updatedAt ?? incoming.createdAt ?? 0
  if (inT >= exT) return { record: incoming, status: 'updated' }
  return { record: existing, status: 'kept' }
}

export interface MergeCounts {
  added: number
  updated: number
}

/** 整集合合并：返回合并后的全量列表与新增/更新计数。 */
export function mergeCollection<T extends { id: string; updatedAt?: number; createdAt?: number }>(
  existing: T[],
  incoming: T[]
): { list: T[]; counts: MergeCounts } {
  const map = new Map<string, T>()
  for (const e of existing) map.set(e.id, e)
  const counts: MergeCounts = { added: 0, updated: 0 }
  for (const item of incoming) {
    const r = mergeRecord(map.get(item.id), item)
    map.set(item.id, r.record)
    if (r.status === 'added') counts.added++
    else if (r.status === 'updated') counts.updated++
  }
  return { list: [...map.values()], counts }
}
