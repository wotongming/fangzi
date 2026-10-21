/**
 * 2026-10-21 华为安卓/WeLink WebView 兼容批次 · 三视口 E2E。
 * 覆盖：pdf-redact / resume-jd-matcher 伪 MIME 合法 PDF 能解析、非 PDF 明确报错；
 *       receipt-vault xlsx 样例导入预览勾选+批量入账金额方向；local-transcribe getUserMedia 拒绝引导文案。
 * 运行前：npx vite preview --port 4173
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { newCompatContext, horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

function sampleXlsx() {
  const data = [
    ['微信支付账单明细'],
    ['交易时间', '交易对方', '商品', '收/支', '金额(元)'],
    ['2026-10-12 12:00', '星巴克', '拿铁', '支出', '¥ 42.5'],
    ['2026-10-13 09:00', '滴滴', '快车', '收入', '¥ 10.0']
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/mini-games/docs/shots')
const ORIGIN = 'http://localhost:4173'
const fail = []
const log = (...a) => console.log('[e2e-compat]', ...a)
const shot = (page, name) => page.screenshot({ path: join(SHOTS, name) }).then(() => log('shot', name))

async function newPage(browser, viewport) {
  const ctx = await newCompatContext(browser, viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`console.error: ${m.text()}`) })
  return { ctx, page }
}

/** 最小合法 PDF（pdf.js 可解析）。 */
function minimalPdfBytes() {
  const body = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >>endobj
xref
0 4
0000000000 65535 f
0000000010 00000 n
0000000060 00000 n
00000000b0 00000 n
trailer<< /Size 4 /Root 1 0 R >>
startxref 180
%%EOF`
  return Buffer.from(body, 'latin1')
}

async function overflow(page, label) {
  const d = await horizontalOverflow(page)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function testPdfRedact(page, label) {
  await page.goto(`${ORIGIN}/#/t/pdf-redact`)
  await page.waitForSelector('.pr-drop, .pr-main', { timeout: 20000 })
  // 1) 伪 MIME（octet-stream）合法 PDF → 应加载
  await page.setInputFiles('input[type=file]', {
    name: 'resume.bin', mimeType: 'application/octet-stream', buffer: minimalPdfBytes()
  })
  await page.waitForTimeout(1500)
  const toast1 = await page.locator('.pr-toast').innerText().catch(() => '')
  log(`[${label}] pdf-redact 伪MIME合法PDF toast=${toast1}`)
  if (toast1.includes('失败') || toast1.includes('不是')) fail.push(`${label} pdf-redact 伪MIME合法PDF被误拒: ${toast1}`)
  // 2) 非 PDF（HTML 错误页）→ 明确错误
  await page.setInputFiles('input[type=file]', {
    name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<!doctype html>404 not found', 'utf8')
  })
  await page.waitForTimeout(800)
  const toast2 = await page.locator('.pr-toast').innerText().catch(() => '')
  log(`[${label}] pdf-redact HTML错误页 toast=${toast2}`)
  if (!toast2.includes('PDF') && !toast2.includes('网页')) fail.push(`${label} pdf-redact 非PDF未给明确错误: ${toast2}`)
  await overflow(page, label + '/pdf-redact')
}

async function testResume(page, label) {
  await page.goto(`${ORIGIN}/#/t/resume-jd-matcher`)
  await page.reload()
  await page.waitForSelector('input[type=file]', { timeout: 20000, state: 'attached' })
  await page.setInputFiles('input[type=file]', {
    name: 'cv.blob', mimeType: 'application/octet-stream', buffer: minimalPdfBytes()
  })
  await page.waitForTimeout(1500)
  const body = await page.locator('body').innerText()
  log(`[${label}] resume 伪MIME后页面含「暂不支持」? ${body.includes('暂不支持')}`)
  if (body.includes('暂不支持')) fail.push(`${label} resume 伪MIME合法PDF被误判暂不支持`)
}

async function testReceiptBill(page, label) {
  await page.goto(`${ORIGIN}/#/t/receipt-vault`)
  await page.reload()
  await page.waitForFunction(() => !!window.__receiptVault, { timeout: 15000 })
  const xlsxBuf = sampleXlsx()
  const inputs = await page.locator('input[type=file]').count()
  log(`[${label}] receipt input count=${inputs}`)
  // 第二个 file input 是账单
  await page.locator('input[type=file]').nth(1).setInputFiles({
    name: 'wx.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxBuf
  })
  await page.waitForTimeout(1200)
  const preview = await page.locator('.rv-bill').count()
  log(`[${label}] receipt 预览弹层存在=${preview}`)
  if (!preview) fail.push(`${label} receipt xlsx 导入未出现预览勾选`)
  await shot(page, 'rv-bill-preview.png')
  await page.locator('.rv-btn.primary', { hasText: '入账' }).click()
  await page.waitForTimeout(800)
  const rows = await page.evaluate(() => window.__receiptVault.all())
  log(`[${label}] receipt 入账后 rows=${rows.length} 首条=${JSON.stringify(rows[0])}`)
  if (rows.length < 2) fail.push(`${label} receipt 批量入账失败 rows=${rows.length}`)
  await overflow(page, label + '/receipt')
}

async function testTranscribe(page, label) {
  await page.goto(`${ORIGIN}/#/t/local-transcribe`)
  await page.reload()
  await page.waitForSelector('input[type=file]', { timeout: 20000, state: 'attached' })
  const accept = await page.locator('input[type=file]').first().getAttribute('accept')
  log(`[${label}] transcribe accept=${accept}`)
  if (!accept || !accept.includes('video/')) fail.push(`${label} transcribe accept 未含 video/*`)
  // stub getUserMedia 抛 NotAllowedError
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const e = new DOMException('denied', 'NotAllowedError')
      throw e
    }
  })
  await page.locator('.mic').click()
  await page.waitForTimeout(800)
  const body = await page.locator('body').innerText()
  log(`[${label}] transcribe 权限拒后含「权限」? ${body.includes('权限')}`)
  if (!body.includes('权限')) fail.push(`${label} transcribe getUserMedia 拒绝未给权限引导文案`)
  await shot(page, 'tr-mic-denied.png')
  await overflow(page, label + '/transcribe')
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  try {
    for (const [vp, label] of [
      [{ width: 1280, height: 860 }, 'pc'],
      [{ width: 834, height: 1112 }, 'tablet'],
      [{ width: 375, height: 812 }, 'mobile']
    ]) {
      const { page } = await newPage(browser, vp)
      await testPdfRedact(page, label)
      await testResume(page, label)
      await testReceiptBill(page, label)
      await testTranscribe(page, label)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (fail.length) {
    console.error('\n❌ E2E 失败：'); for (const f of fail) console.error(' -', f)
    process.exit(1)
  }
  console.log('\n✅ 三视口兼容批次 E2E 全部通过')
}
run().catch((e) => { console.error(e); process.exit(1) })
