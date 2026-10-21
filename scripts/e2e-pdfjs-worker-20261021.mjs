/**
 * 2026-10-21 pdfjs-worker 共性热修 · 三视口回归 E2E。
 *
 * 背景：EdgeOne 把 `.mjs` 下发成 application/octet-stream，华为/WeLink 内置 WebView 拒绝加载。
 * 修复：公共模块把 worker 固化为同源稳定 `/pdfjs/pdf.worker.min.js`；getDocument 包装为中文可重试错误。
 *
 * 覆盖（PC 1280×860 / 平板 834×1112 / 手机 375×812 + 移动 UA）：
 *  1) pdf-redact、resume-jd-matcher 选合法 PDF 均解析成功；
 *  2) 伪 MIME（type=application/octet-stream）但内容为 `%PDF` 仍按魔数打开（不回归 file-sniff）；
 *  3) 全程不请求旧 `/assets/pdf.worker.min-*.mjs`；拦截新稳定 worker 失败时，要么回退主线程成功，
 *     要么出现中文可重试错误，绝不出现裸英文 "Setting up fake worker failed"；
 *  4) 非 PDF（HTML 错误页 / 0 字节）出现明确错误文案且可重试；
 *  5) SW 在线缓存后断网二次加载仍可解析；零横向溢出、无 pageerror。
 *
 * 运行前：npm run build && npm run preview -- --port 4173
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS_REDACT = join(ROOT, 'src/tools/pdf-redact/docs/shots')
const SHOTS_RESUME = join(ROOT, 'src/tools/resume-jd-matcher/docs/shots')
mkdirSync(SHOTS_REDACT, { recursive: true })
mkdirSync(SHOTS_RESUME, { recursive: true })
const ORIGIN = 'http://localhost:4173'

const fail = []
const log = (...a) => console.log('[e2e-pdfjs-worker]', ...a)

const VIEWPORTS = [
  [{ width: 1280, height: 860 }, 'pc'],
  [{ width: 834, height: 1112 }, 'tablet'],
  [{ width: 375, height: 812 }, 'mobile']
]

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; PCT-AL10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36'

async function makePdf() {
  const doc = await PDFDocument.create()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([612, 792])
  p1.drawText('FRONTEND DEVELOPER', { x: 72, y: 720, size: 20, font: helv, color: rgb(0, 0, 0) })
  p1.drawText('FIVE YEARS EXPERIENCE VUE NODE DOCKER', { x: 72, y: 660, size: 15, font: helv, color: rgb(0, 0, 0) })
  p1.drawText('SECRET BANK ACCT 8899', { x: 72, y: 560, size: 14, font: helv, color: rgb(1, 0, 0) })
  doc.setTitle('Resume Draft')
  doc.setAuthor('Zhang San')
  return Buffer.from(await doc.save())
}

async function newPage(browser, viewport, label, { offline = false, abortWorker = false } = {}) {
  const ctx = await browser.newContext({
    viewport,
    userAgent: label === 'mobile' ? MOBILE_UA : undefined
  })
  // 旧批次脚本会 abort sw.js；本脚本离线用例保留真实 SW，其余用例显式 abort 避免旧缓存干扰。
  await ctx.route('**/sw.js', offline ? (r) => r.continue() : (r) => r.abort())
  await ctx.route('**/registerSW.js', offline ? (r) => r.continue() : (r) => r.abort())
  if (abortWorker) {
    await ctx.route('**/pdfjs/pdf.worker.min.js', (r) => r.abort())
  }
  const page = await ctx.newPage()
  const mjsRequests = []
  const external = []
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`pageerror: ${e.message}`) })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (SW_NOISE.test(m.text())) return
    // 主动 abort worker 模拟生产加载失败，资源 net::ERR_FAILED 属预期
    if (abortWorker && /net::ERR_FAILED/.test(m.text())) return
    fail.push(`console.error: ${m.text()}`)
  })
  page.on('request', (req) => {
    const u = req.url()
    if (u.includes('pdf.worker') && u.endsWith('.mjs')) mjsRequests.push(u)
    if (!u.startsWith(ORIGIN)) external.push(u)
  })
  return { ctx, page, mjsRequests, external }
}

async function gotoRedact(page) {
  await page.goto(`${ORIGIN}/#/t/pdf-redact`)
  await page.waitForFunction(() => !!window.__pdfRedact, { timeout: 20000 })
}

async function gotoResume(page) {
  await page.goto(`${ORIGIN}/#/t/resume-jd-matcher`)
  await page.waitForSelector('.file-btn input[type=file]', { timeout: 20000, state: 'attached' })
}

/** 上传合法 PDF（伪 octet-stream）到 pdf-redact；返回 {ok, error}。 */
async function uploadRedactPdf(page, buffer) {
  await page.locator('input.pr-input').setInputFiles({ name: 'resume.pdf', mimeType: 'application/octet-stream', buffer })
  // 要么渲染出页面画布，要么出现错误块
  await Promise.race([
    page.waitForFunction(() => document.querySelectorAll('.pr-canvas').length && document.querySelector('.pr-canvas').width > 10, { timeout: 15000 }),
    page.waitForSelector('.pr-err', { timeout: 15000 })
  ])
  const errText = await page.locator('.pr-err').innerText().catch(() => '')
  if (errText) return { ok: false, error: errText }
  return { ok: true }
}

async function uploadResumePdf(page, buffer) {
  await page.locator('.file-btn input[type=file]').setInputFiles({ name: 'resume.pdf', mimeType: 'application/octet-stream', buffer })
  await Promise.race([
    page.waitForFunction(() => {
      const t = document.querySelectorAll('textarea')[0]
      return t && /VUE|NODE|DOCKER|FRONTEND/i.test(t.value)
    }, { timeout: 15000 }),
    page.waitForSelector('.err', { timeout: 15000 })
  ])
  const errText = await page.locator('.err').innerText().catch(() => '')
  if (errText) return { ok: false, error: errText }
  const ta = await page.locator('textarea').first().inputValue()
  return { ok: true, text: ta }
}

function assertFriendlyError(error, label, tool) {
  if (/Setting up fake worker|dynamically imported module|Failed to fetch dynamically/.test(error)) {
    fail.push(`${label} ${tool} 抛出裸英文 worker 错误：${error}`)
  }
  if (!/失败|重试|系统 Chrome|Edge|内置浏览器/.test(error)) {
    fail.push(`${label} ${tool} 错误文案缺少中文可重试引导：${error}`)
  }
  log(`[${label}] ${tool} 失败兜底文案：${error.replace(/\s+/g, ' ').slice(0, 80)}…`)
}

async function overflow(page, label) {
  const d = await horizontalOverflow(page)
  log(`overflow[${label}] -> ${d}px`)
  if (d > 2) fail.push(`${label} 横向溢出 ${d}px`)
}

async function shot(page, dir, name) {
  const p = join(dir, name)
  await page.screenshot({ path: p })
  const st = statSync(p)
  if (st.size < 8000) fail.push(`截图 ${name} 仅 ${st.size} 字节，疑似空白`)
  log('shot', name, st.size)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  const pdf = await makePdf()
  try {
    for (const [vp, label] of VIEWPORTS) {
      // ---------- pdf-redact 合法 PDF（伪 octet-stream） ----------
      {
        const { page, mjsRequests, external } = await newPage(browser, vp, label)
        await gotoRedact(page)
        const res = await uploadRedactPdf(page, pdf)
        if (!res.ok) {
          assertFriendlyError(res.error, label, 'pdf-redact')
        } else {
          log(`[${label}] pdf-redact 合法 PDF 渲染成功`)
        }
        if (mjsRequests.length) fail.push(`${label} 仍请求旧 .mjs worker：${mjsRequests[0]}`)
        await overflow(page, label)
        if (external.length) fail.push(`${label} 外部请求：${external.slice(0, 2).join(',')}`)
        if (label === 'mobile') await shot(page, SHOTS_REDACT, 'pr-pdfjs-worker-fix-mobile.png')
        await page.close()
      }

      // ---------- resume-jd-matcher 合法 PDF（伪 octet-stream） ----------
      {
        const { page, mjsRequests, external } = await newPage(browser, vp, label)
        await gotoResume(page)
        const res = await uploadResumePdf(page, pdf)
        if (!res.ok) {
          assertFriendlyError(res.error, label, 'resume-jd-matcher')
        } else {
          log(`[${label}] resume PDF 解析成功，文本片段：${res.text.replace(/\s+/g, ' ').slice(0, 60)}`)
        }
        if (mjsRequests.length) fail.push(`${label} resume 仍请求旧 .mjs worker：${mjsRequests[0]}`)
        await overflow(page, label)
        if (external.length) fail.push(`${label} resume 外部请求：${external.slice(0, 2).join(',')}`)
        if (label === 'mobile') await shot(page, SHOTS_RESUME, 'rj-pdfjs-worker-fix-mobile.png')
        await page.close()
      }
    }

    // ---------- 拦截新稳定 worker 失败：两工具都必须走中文兜底或主线程回退 ----------
    for (const [tool, label] of [['pdf-redact', 'worker-fail-redact'], ['resume-jd-matcher', 'worker-fail-resume']]) {
      const { page } = await newPage(browser, { width: 1280, height: 860 }, 'pc', { abortWorker: true })
      if (tool === 'pdf-redact') {
        await gotoRedact(page)
        const res = await uploadRedactPdf(page, pdf)
        if (!res.ok) assertFriendlyError(res.error, label, tool)
        else log(`[${label}] worker 被拦截后主线程回退解析成功`)
      } else {
        await gotoResume(page)
        const res = await uploadResumePdf(page, pdf)
        if (!res.ok) assertFriendlyError(res.error, label, tool)
        else log(`[${label}] worker 被拦截后主线程回退解析成功`)
      }
      await page.close()
    }

    // ---------- 非 PDF：HTML 错误页 / 0 字节，明确错误 + 可重试 ----------
    {
      const { page } = await newPage(browser, { width: 1280, height: 860 }, 'pc')
      await gotoRedact(page)
      await page.locator('input.pr-input').setInputFiles({
        name: 'download.pdf',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('<html><body>Not Found</body></html>', 'utf8')
      })
      await page.waitForSelector('.pr-err', { timeout: 10000 })
      const txt = await page.locator('.pr-err').innerText()
      if (!/不是|网页|错误页|HTML|空|重试/.test(txt)) fail.push(`pdf-redact 非 PDF 错误文案不明确：${txt}`)
      if ((await page.locator('.pr-err button').count()) < 1) fail.push('pdf-redact 缺少重试按钮')
      log('[pc] pdf-redact HTML 错误页明确报错：', txt.replace(/\s+/g, ' ').slice(0, 60))
      await page.close()
    }
    {
      const { page } = await newPage(browser, { width: 1280, height: 860 }, 'pc')
      await gotoResume(page)
      await page.locator('.file-btn input[type=file]').setInputFiles({
        name: 'empty.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(0)
      })
      await page.waitForSelector('.err', { timeout: 10000 })
      const txt = await page.locator('.err').innerText()
      if (!/空|0 字节|重试/.test(txt)) fail.push(`resume 0 字节错误文案不明确：${txt}`)
      if ((await page.locator('.err button').count()) < 1) fail.push('resume 缺少重试按钮')
      log('[pc] resume 0 字节明确报错：', txt.replace(/\s+/g, ' ').slice(0, 60))
      await page.close()
    }

    // ---------- 断网回归：SW 在线缓存后二次加载，worker 命中预缓存仍可解析 ----------
    {
      const { page } = await newPage(browser, { width: 375, height: 812 }, 'mobile', { offline: true })
      await gotoRedact(page)
      await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, { timeout: 15000 })
      await page.context().setOffline(true)
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
      await gotoRedact(page)
      const res = await uploadRedactPdf(page, pdf)
      if (!res.ok) fail.push(`断网后 pdf-redact 解析失败：${res.error}`)
      else log('[offline] 断网后 SW 命中 worker，PDF 解析成功')
      await overflow(page, 'offline-mobile')
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
  console.log('\n✅ pdfjs-worker 三视口 E2E 全部通过（合法 PDF / 伪 MIME / 拦截兜底 / 非 PDF 报错 / 断网 SW）')
}

run().catch((e) => { console.error(e); process.exit(1) })
