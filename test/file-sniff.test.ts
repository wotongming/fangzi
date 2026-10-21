import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sniffFile, readPdfFile, FileRejected } from '../reusable-module/file-sniff/file-sniff.ts'

function ab(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

test('魔数：PDF 头 %PDF 识别（与扩展名/MIME 无关）', () => {
  const pdf = ab([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 1, 2, 3])
  assert.equal(sniffFile(pdf, 'weird.bin').kind, 'pdf')
  // 即使 type=octet-stream / name 无后缀也认
  assert.equal(sniffFile(pdf, 'download').kind, 'pdf')
})

test('魔数：0 字节 / HTML 错误页 / zip-xlsx / OLE', () => {
  assert.equal(sniffFile(ab([]), 'x.pdf').kind, 'empty')
  const html = ab([...'<html><body>Not Found</body></html>'.split('').map((c) => c.charCodeAt(0))])
  assert.equal(sniffFile(html, 'x.pdf').kind, 'html')
  const xlsx = ab([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
  assert.equal(sniffFile(xlsx, 'wx_bill.xlsx').kind, 'xlsx')
  const ole = ab([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])
  assert.equal(sniffFile(ole, 'old.xls').kind, 'xls')
})

test('readPdfFile：非 PDF / 空 / HTML 均抛 FileRejected 带具体 code', async () => {
  const mk = (name: string, bytes: number[], type = 'application/octet-stream'): File =>
    new File([ab(bytes)], name, { type })
  const ok = await readPdfFile(mk('ok.pdf', [0x25, 0x50, 0x44, 0x46, 0x2d, 1]))
  assert.equal(ok.byteLength, 6)
  await assert.rejects(() => readPdfFile(mk('x.pdf', [1, 2, 3, 4])), (e: FileRejected) => e.code === 'not-pdf')
  await assert.rejects(() => readPdfFile(mk('x.pdf', [])), (e: FileRejected) => e.code === 'empty')
  const htmlBytes = [...'<!doctype html>err'.split('').map((c) => c.charCodeAt(0))]
  await assert.rejects(() => readPdfFile(mk('x.pdf', htmlBytes)), (e: FileRejected) => e.code === 'html-error')
})
