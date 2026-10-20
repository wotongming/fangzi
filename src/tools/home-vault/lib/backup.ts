/**
 * backup.ts —— 全库加密备份导出 / 导入合并（Pro）。
 * 照片 Blob 以 base64 内联进单文件 JSON，Web Crypto 信封加密；
 * 导入按 id upsert、同 id 取 updatedAt 晚者，反馈「新增 X 更新 Y」。
 * 不做实时云同步：双人协作 = 导出包微信互传。
 */
import {
  dumpAll,
  getAllAssets,
  getAllBoxes,
  getAllBoxItems,
  getAllDocs,
  putAsset,
  putBox,
  putBoxItem,
  putDoc,
  readManualExpiry,
  writeManualExpiry
} from './store'
import { b64ToBlob, bytesToB64, downloadText, exportEncrypted, importEncrypted } from './crypto'
import { mergeCollection } from './merge'
import { todayStr, type Asset, type Box, type BoxItem, type Doc, type ExpiryItem } from './models'

export const BACKUP_KIND = 'fangzi-home-vault-backup'

interface DocPayload extends Omit<Doc, 'photoBlob'> {
  mime: string
  dataB64: string
}

export interface BackupJson {
  kind: typeof BACKUP_KIND
  version: 1
  exportedAt: string
  assets: Asset[]
  boxes: Box[]
  boxItems: BoxItem[]
  expiryItems: ExpiryItem[]
  docs: DocPayload[]
}

export interface ImportCounts {
  assetsAdded: number
  assetsUpdated: number
  docsAdded: number
  docsUpdated: number
  boxesAdded: number
  boxItemsAdded: number
  expiryAdded: number
}

/** 导出加密备份包并触发下载；口令由用户自设，开发者与服务端均不接触。 */
export async function exportBackup(password: string): Promise<string> {
  const all = await dumpAll()
  const docs: DocPayload[] = []
  for (const d of all.docs) {
    const buf = new Uint8Array(await d.photoBlob.arrayBuffer())
    docs.push({
      id: d.id,
      assetId: d.assetId,
      kind: d.kind,
      note: d.note,
      createdAt: d.createdAt,
      mime: d.photoBlob.type || 'image/jpeg',
      dataB64: bytesToB64(buf)
    })
  }
  const json: BackupJson = {
    kind: BACKUP_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    assets: all.assets,
    boxes: all.boxes,
    boxItems: all.boxItems,
    expiryItems: all.expiryItems,
    docs
  }
  const text = await exportEncrypted(json, password)
  const filename = `home-vault-backup-${todayStr().replace(/-/g, '')}.json`
  downloadText(text, filename)
  return filename
}

function isBackup(v: unknown): v is BackupJson {
  const o = v as BackupJson
  return typeof v === 'object' && v !== null && o.kind === BACKUP_KIND && Array.isArray(o.assets) && Array.isArray(o.docs)
}

/** 导入备份包：解密 → 按 id 合并 upsert → 落库；返回分项计数。 */
export async function importBackup(file: Blob, password: string): Promise<ImportCounts> {
  const raw = await file.text()
  let data: BackupJson
  try {
    data = await importEncrypted<BackupJson>(raw, password)
  } catch (e) {
    if (e instanceof Error && e.message === '无法识别的备份文件') throw new Error('备份文件不是合法 JSON 或已损坏')
    throw e
  }
  if (!isBackup(data)) throw new Error('不是有效的家庭资产档案备份包')

  const counts: ImportCounts = {
    assetsAdded: 0,
    assetsUpdated: 0,
    docsAdded: 0,
    docsUpdated: 0,
    boxesAdded: 0,
    boxItemsAdded: 0,
    expiryAdded: 0
  }

  // assets
  const curAssets = await getAllAssets()
  const mAssets = mergeCollection(curAssets, data.assets)
  counts.assetsAdded = mAssets.counts.added
  counts.assetsUpdated = mAssets.counts.updated
  for (const a of mAssets.list) await putAsset(a)

  // docs（照片 Blob 还原）
  const curDocs = await getAllDocs()
  const incomingDocs: Doc[] = data.docs.map((d) => ({
    id: d.id,
    assetId: d.assetId,
    kind: d.kind,
    note: d.note,
    createdAt: d.createdAt,
    photoBlob: b64ToBlob(d.dataB64, d.mime)
  }))
  const mDocs = mergeCollection(curDocs, incomingDocs)
  counts.docsAdded = mDocs.counts.added
  counts.docsUpdated = mDocs.counts.updated
  for (const d of mDocs.list) await putDoc(d)

  // boxes
  const curBoxes = await getAllBoxes()
  const mBoxes = mergeCollection(curBoxes, data.boxes)
  counts.boxesAdded = mBoxes.counts.added
  for (const b of mBoxes.list) await putBox(b)

  // boxItems
  const curItems = await getAllBoxItems()
  const mItems = mergeCollection(curItems, data.boxItems)
  counts.boxItemsAdded = mItems.counts.added
  for (const it of mItems.list) await putBoxItem(it)

  // 手动到期项：按 id 合并
  const curExpiry = readManualExpiry()
  const mExpiry = mergeCollection(curExpiry, data.expiryItems ?? [])
  counts.expiryAdded = mExpiry.counts.added
  writeManualExpiry(mExpiry.list)

  return counts
}

/** 汇总文案：新增 X 更新 Y。 */
export function summarizeImport(c: ImportCounts): string {
  const added = c.assetsAdded + c.docsAdded + c.boxesAdded + c.boxItemsAdded + c.expiryAdded
  const updated = c.assetsUpdated + c.docsUpdated
  return `新增 ${added} 条，更新 ${updated} 条`
}
