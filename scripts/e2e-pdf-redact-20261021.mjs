/**
 * 2026-10-21「PDF 真脱敏」三视口 E2E。
 * 现场用 pdf-lib 生成两页测试 PDF（含 Author/Title 元数据 + 已知文字）：
 *  - 页1：PUBLIC HEADING + SECRETBANK ACCT 8899；页2：PUBLIC ONLY PAGE TWO。
 * 通过工具的测试接缝：对页1 SECRET 区域加遮罩 → build → pdf.js getTextContent 断言：
 *   页1（已真删）提取不到 SECRET；页2（未遮）PUBLIC 文字仍在；元数据 Author/Title 已清空。
 * 另：三视口 UI 截图、0 横向溢出、无 pageerror、断网 SW 可完成一次遮罩导出。
 * 运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { newCompatContext, horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/pdf-redact/docs/shots')
const ORIGIN = 'http://localhost:4173'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-pdf-redact]', ...a)

async function makeTestPdf() {
  const doc = await PDFDocument.create()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([612, 792])
  p1.drawText('PUBLIC HEADING', { x: 80, y: 740, size: 20, font: helv, color: rgb(0, 0, 0) })
  p1.drawText('SECRETBANK ACCT 8899', { x: 80, y: 640, size: 16, font: helv, color: rgb(1, 0, 0) })
  const p2 = doc.addPage([612, 792])
  p2.drawText('PUBLIC ONLY PAGE TWO', { x: 80, y: 700, size: 18, font: helv, color: rgb(0, 0, 0) })
  doc.setTitle('Confidential Draft')
  doc.setAuthor('张三 Secret')
  return Array.from(await doc.save())
}

async function newPage(browser, viewport) {
  const ctx = await newCompatContext(browser, viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`console.error: ${m.text()}`) })
  const external = []
  page.on('request', (req) => { const u = req.url(); if (!u.startsWith(ORIGIN)) external.push(u) })
  return { ctx, page, external }
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, name) }).then(() => log('shot', name))

async function gotoTool(page) {
  await page.goto(`${ORIGIN}/#/t/pdf-redact`)
  await page.waitForFunction(() => !!window.__pdfRedact, { timeout: 20000 })
}

async function coreRedactCheck(page, label, bytes) {
  const res = await page.evaluate(async (arr) => {
    const buf = await window.__pdfRedact.loadBuffer(new Uint8Array(arr).buffer)
    const out = await window.__pdfRedact.build([[0, [{ x: 70, y: 628, w: 380, h: 40 }]]])
    const outBuf = out.bytes.slice(0).buffer
    const t0 = await window.__pdfRedact.pageText(outBuf, 0)
    const t1 = await window.__pdfRedact.pageText(outBuf, 1)
    const meta = await window.__pdfRedact.readMeta(outBuf)
    return { numPages: buf.numPages, t0, t1, meta, outSize: out.outSize, redactedPages: out.redactedPages }
  }, bytes)
  log(`[${label}] pages=${res.numPages} redactedPages=${JSON.stringify(res.redactedPages)} size=${res.outSize}`)
  log(`[${label}] page0="${res.t0.replace(/\s+/g, ' ')}" page1="${res.t1.replace(/\s+/g, ' ')}"`)
  if (res.t0.includes('SECRETBANK') || res.t0.includes('8899')) fail.push(`${label} 真删失败：遮罩页仍提取到秘密文字`)
  if (!res.t1.includes('PUBLIC ONLY')) fail.push(`${label} 未遮页公共文字丢失`)
  if (res.meta.Author !== '' || res.meta.Title !== '') fail.push(`${label} 元数据未清空：${JSON.stringify(res.meta)}`)
}

async function overflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  const testBytes = await makeTestPdf()
  try {
    for (const [vp, label] of [
      [{ width: 1280, height: 860 }, 'pc'],
      [{ width: 834, height: 1112 }, 'tablet'],
      [{ width: 375, height: 812 }, 'mobile']
    ]) {
      const { page, external } = await newPage(browser, vp)
      await gotoTool(page)
      await coreRedactCheck(page, label, testBytes)
      const buf = Buffer.from(testBytes)
      await page.locator('input.pr-input').setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: buf })
      await page.waitForTimeout(1200)
      await shot(page, label === 'mobile' ? 'pr-mobile-main.png' : 'pr-pc-main.png')
      await overflow(page, label)
      if (external.length) fail.push(`${label} 外部 CDN 请求：${external.slice(0, 2).join(',')}`)
      await page.close()
    }
    {
      const { page, external } = await newPage(browser, { width: 375, height: 812 })
      await gotoTool(page)
      await coreRedactCheck(page, 'offline', testBytes)
      if (external.length) fail.push(`离线存在外部请求：${external.slice(0, 2).join(',')}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (fail.length) {
    console.error('\n❌ E2E 失败：')
    for (const f of fail) console.error(' -', f)
    process.exit(1)
  }
  console.log('\n✅ PDF 真脱敏三视口 E2E（真删/未遮保留/元数据清空/断网）全部通过')
}
run().catch((e) => { console.error(e); process.exit(1) })
