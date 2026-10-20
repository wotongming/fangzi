import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FREE_ASSET_LIMIT,
  QR_PREFIX,
  addDays,
  daysBetween,
  formatCents,
  parseBoxPayload,
  payloadForBox,
  yuanToCents,
  type Asset,
  type Doc,
  type ExpiryItem
} from '../src/tools/home-vault/lib/models'
import { buildExpiryIcs, buildExpiryRows, classifyExpiry } from '../src/tools/home-vault/lib/expiry'
import { b64ToBlob, blobToB64, bytesToB64, b64ToBytes, exportEncrypted, importEncrypted } from '../src/tools/home-vault/lib/crypto'
import { mergeCollection, mergeRecord } from '../src/tools/home-vault/lib/merge'
import { buildClaimHtml, buildClaimManifest } from '../src/tools/home-vault/lib/claim-pack'
import { summarizeImport, type ImportCounts } from '../src/tools/home-vault/lib/backup'

const TODAY = '2026-10-20'

function asset(over: Partial<Asset> & Pick<Asset, 'id' | 'name'>): Asset {
  return {
    category: '家电',
    location: '',
    createdAt: 1,
    updatedAt: 1,
    ...over
  }
}

// —— 日期纯函数 ——
test('addDays 跨月/跨年/闰年安全', () => {
  assert.equal(addDays('2026-10-20', 1), '2026-10-21')
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-02-27', 2), '2026-03-01')
  assert.equal(addDays('2024-02-27', 2), '2024-02-29')
})

test('daysBetween 为本地日历整数天差', () => {
  assert.equal(daysBetween(TODAY, '2026-10-25'), 5)
  assert.equal(daysBetween(TODAY, '2026-10-13'), -7)
  assert.equal(daysBetween('', TODAY), null)
})

// —— 到期分级边界 ——
test('classifyExpiry：逾期红 / 7天内橙 / 30天内黄 / 正常', () => {
  assert.equal(classifyExpiry(-3), 'expired')
  assert.equal(classifyExpiry(0), 'soon7')
  assert.equal(classifyExpiry(7), 'soon7')
  assert.equal(classifyExpiry(8), 'soon30')
  assert.equal(classifyExpiry(30), 'soon30')
  assert.equal(classifyExpiry(31), 'ok')
  assert.equal(classifyExpiry(null), 'ok')
})

test('buildExpiryRows 聚合保修与手动项，并按紧迫度排序', () => {
  const assets = [
    asset({ id: 'a1', name: '冰箱', warrantyEnd: addDays(TODAY, 5) }),
    asset({ id: 'a2', name: '洗衣机', warrantyEnd: addDays(TODAY, -2) })
  ]
  const manual: ExpiryItem[] = [
    { id: 'm1', title: '护照', dueDate: addDays(TODAY, 20), kind: 'license' }
  ]
  const rows = buildExpiryRows(assets, manual, TODAY)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].id, 'warranty:a2')
  assert.equal(rows[0].level, 'expired')
  assert.equal(rows[1].level, 'soon7')
  assert.equal(rows[2].level, 'soon30')
})

test('无保修/无手动项时返回空', () => {
  assert.equal(buildExpiryRows([asset({ id: 'x', name: '书' })], [], TODAY).length, 0)
})

// —— .ics 双 VALARM ——
test('buildExpiryIcs：每个 VEVENT 含两条 VALARM（30天/7天）', () => {
  const rows = buildExpiryRows(
    [asset({ id: 'a1', name: '冰箱', warrantyEnd: addDays(TODAY, 5) })],
    [{ id: 'm1', title: '车险续保', dueDate: addDays(TODAY, 20), kind: 'insurance' }],
    TODAY
  )
  const ics = buildExpiryIcs(rows, TODAY)
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2)
  assert.equal(ics.split('BEGIN:VALARM').length - 1, 4)
  assert.match(ics, /TRIGGER:-P30D/)
  assert.match(ics, /TRIGGER:-P7D/)
  assert.match(ics, /SUMMARY:到期提醒：冰箱（保修截止）/)
  assert.match(ics, /UID:home-vault-warranty:a1/)
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /END:VCALENDAR/)
})

// —— QR 载荷纯函数 ——
test('payloadForBox 带 fz-box: 前缀', () => {
  assert.equal(payloadForBox('box_abc'), `${QR_PREFIX}box_abc`)
})

test('parseBoxPayload：命中前缀返回 id，否则 null', () => {
  assert.equal(parseBoxPayload('fz-box:box_abc'), 'box_abc')
  assert.equal(parseBoxPayload('https://example.com/x'), null)
  assert.equal(parseBoxPayload('fz-box:'), null)
})

// —— 加密信封（小迭代次数） ——
test('加密信封往返：明文还原（注入 1000 次迭代）', async () => {
  const data = { hello: '世界', n: 42, list: [1, 2] }
  const env = await exportEncrypted(data, 'pw-123456', 1000)
  const back = await importEncrypted<typeof data>(env, 'pw-123456')
  assert.deepEqual(back, data)
})

test('错误口令解密抛可识别错误', async () => {
  const env = await exportEncrypted({ a: 1 }, 'correct-pw', 1000)
  await assert.rejects(() => importEncrypted(env, 'wrong-pw'), /口令错误或备份文件已损坏/)
})

test('非信封 JSON 抛「无法识别」', async () => {
  await assert.rejects(() => importEncrypted('{"plain":true}', 'x'), /无法识别的备份文件/)
})

test('bytesToB64 / b64ToBytes 往返', () => {
  const bytes = new Uint8Array([0, 255, 128, 65, 9, 200])
  const b64 = bytesToB64(bytes)
  assert.deepEqual(b64ToBytes(b64), bytes)
})

test('blobToB64 → b64ToBlob 还原字节与 MIME', async () => {
  const original = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' })
  const b64 = await blobToB64(original)
  const restored = b64ToBlob(b64, 'image/jpeg')
  assert.equal(restored.type, 'image/jpeg')
  const back = new Uint8Array(await restored.arrayBuffer())
  assert.deepEqual(back, new Uint8Array([1, 2, 3, 250]))
})

// —— 合并 upsert ——
test('mergeRecord：新增 / 取 updatedAt 晚者 / 保留较新', () => {
  const existing = { id: 'a', updatedAt: 100, name: 'old' }
  const newer = { id: 'a', updatedAt: 200, name: 'new' }
  const older = { id: 'a', updatedAt: 50, name: 'older' }
  assert.equal(mergeRecord(undefined, newer).status, 'added')
  assert.equal(mergeRecord(existing, newer).status, 'updated')
  assert.equal(mergeRecord(existing, newer).record.name, 'new')
  assert.equal(mergeRecord(existing, older).status, 'kept')
  assert.equal(mergeRecord(existing, older).record.name, 'old')
})

test('mergeCollection：新增/更新计数正确，无重复 id', () => {
  const existing = [
    { id: 'a', updatedAt: 100 },
    { id: 'b', updatedAt: 100 }
  ]
  const incoming = [
    { id: 'a', updatedAt: 300 },
    { id: 'c', updatedAt: 1 }
  ]
  const { list, counts } = mergeCollection(existing, incoming)
  assert.deepEqual(counts, { added: 1, updated: 1 })
  assert.equal(list.length, 3)
  assert.equal(list.find((x) => x.id === 'a')!.updatedAt, 300)
})

// —— 理赔 manifest 映射 ——
test('buildClaimManifest：资产-凭证映射正确', () => {
  const a1 = asset({ id: 'a1', name: '冰箱' })
  const docs: Doc[] = [
    { id: 'd1', assetId: 'a1', kind: 'invoice', photoBlob: new Blob(), createdAt: 1 },
    { id: 'd2', assetId: 'a1', kind: 'warranty', photoBlob: new Blob(), createdAt: 2 },
    { id: 'd3', assetId: 'other', kind: 'manual', photoBlob: new Blob(), createdAt: 3 }
  ]
  const m = buildClaimManifest([a1], docs)
  assert.equal(m.assets.length, 1)
  assert.deepEqual(m.assets[0].docs.map((d) => d.id), ['d1', 'd2'])
})

test('buildClaimHtml：含名称/序列号/凭证表头，自含打印样式', () => {
  const a1 = asset({ id: 'a1', name: '西门子冰箱', serialNo: 'SN-9981', priceCents: 329900 })
  const html = buildClaimHtml(buildClaimManifest([a1], []))
  assert.match(html, /西门子冰箱/)
  assert.match(html, /SN-9981/)
  assert.match(html, /家庭财产理赔清单/)
  assert.match(html, /@media print/)
  assert.match(html, /¥3299/)
})

// —— 免费 50 卡门（纯判定） ——
test('免费 50 卡门：第 51 张被拦，买断后放开', () => {
  const canAdd = (count: number, owned: boolean) => owned || count < FREE_ASSET_LIMIT
  assert.equal(canAdd(49, false), true)
  assert.equal(canAdd(50, false), false)
  assert.equal(canAdd(50, true), true)
  assert.equal(FREE_ASSET_LIMIT, 50)
})

// —— 导入计数汇总 ——
test('summarizeImport：新增 X 更新 Y 文案', () => {
  const c: ImportCounts = {
    assetsAdded: 3,
    assetsUpdated: 1,
    docsAdded: 2,
    docsUpdated: 0,
    boxesAdded: 1,
    boxItemsAdded: 1,
    expiryAdded: 1
  }
  assert.match(summarizeImport(c), /新增 8 条，更新 1 条/)
})

// —— 金额纯函数 ——
test('formatCents / yuanToCents 整数分互转', () => {
  assert.equal(formatCents(1290), '12.9')
  assert.equal(formatCents(329900), '3299')
  assert.equal(formatCents(undefined), '')
  assert.equal(yuanToCents('12.9'), 1290)
  assert.equal(yuanToCents('-3'), undefined)
  assert.equal(yuanToCents('abc'), undefined)
})
