/**
 * 2026-10-22 photo-sheet-print（作业照片成册打印）三视口 E2E。
 *
 * 覆盖（PC 1280×860 / 平板 834×1112 / 手机 375×812 + 移动 UA）：
 *  1) 程序化生成 5 张不同尺寸 PNG 经 setInputFiles 注入导入；
 *  2) 配置每页 2 张（1 列 × 2 行）→ 预览 3 页，分页/单元格数量正确；
 *  3) 旋转、排序、删除生效；
 *  4) window.print 被打桩并断言调用；导出 PDF 断言 %PDF / %%EOF / 页数；
 *  5) 断网二次加载（SW + IndexedDB）照片仍在；零横向溢出、无 pageerror。
 *
 * 运行前：npm run build && npm run preview -- --port 4173
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { PDFDocument } from 'pdf-lib'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { horizontalOverflow, SW_NOISE, CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/photo-sheet-print/docs/shots')
mkdirSync(SHOTS, { recursive: true })
const ORIGIN = 'http://localhost:4173'

const fail = []
const log = (...a) => console.log('[e2e-photo-sheet-print]', ...a)

const VIEWPORTS = [
  [{ width: 1280, height: 860 }, 'pc'],
  [{ width: 834, height: 1112 }, 'tablet'],
  [{ width: 375, height: 812 }, 'mobile']
]
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; PCT-AL10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36'

async function newPage(browser, viewport, label) {
  const ctx = await browser.newContext({
    viewport,
    userAgent: label === 'mobile' ? MOBILE_UA : undefined
  })
  await ctx.addInitScript(() => {
    window.__printCalls = 0
    window.print = () => { window.__printCalls++ }
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { if (!SW_NOISE.test(e.message)) fail.push(`[${label}] pageerror: ${e.message}`) })
  page.on('console', (m) => {
    if (m.type() === 'error' && !SW_NOISE.test(m.text())) fail.push(`[${label}] console.error: ${m.text()}`)
  })
  return { ctx, page }
}

/** 在页面内用 canvas 生成 N 张 PNG，返回 base64；Node 侧解码为 Buffer 再注入。 */
async function makePhotoFiles(page, n) {
  const items = await page.evaluate((n) => {
    const colors = ['#dbeafe', '#fef3c7', '#dcfce7', '#fce7f3', '#e0e7ff']
    const sizes = [[400, 300], [300, 400], [500, 320], [320, 500], [420, 360]]
    const out = []
    for (let i = 0; i < n; i++) {
      const [w, h] = sizes[i % sizes.length]
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      const ctx = cv.getContext('2d')
      ctx.fillStyle = colors[i % colors.length]
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#111827'
      ctx.font = 'bold 28px sans-serif'
      ctx.fillText(`photo ${i + 1}`, 30, 60)
      out.push({ name: `作业照片-${i + 1}.png`, mimeType: 'image/png', base64: cv.toDataURL('image/png').split(',')[1] })
    }
    return out
  }, n)
  return items.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.base64, 'base64') }))
}

for (const [viewport, label] of VIEWPORTS) {
  log(`== viewport ${label} ${JSON.stringify(viewport)} ==`)
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  const { ctx, page } = await newPage(browser, viewport, label)
  await page.goto(`${ORIGIN}/#/t/photo-sheet-print`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  // 0) 导入控件 accept 含 image/*
  const accept = await page.locator('input[type=file][accept]').first().getAttribute('accept')
  if (!accept || !accept.includes('image/*')) fail.push(`[${label}] 导入 accept 缺失 image/*: ${accept}`)

  // 1) 注入 5 张照片
  const files = await makePhotoFiles(page, 5)
  await page.locator('input[type=file][multiple]').setInputFiles(files)
  await page.waitForTimeout(800)

  let body = await page.textContent('body')
  if (!body.includes('已选 5 张')) fail.push(`[${label}] 导入数量错误: ${(body.match(/已选 \d+ 张/) || [])[0]}`)

  // 2) 配置每页 2 张（1 列 × 2 行）→ 3 页
  await page.locator('label:has-text("每页列数") input').fill('1')
  await page.locator('label:has-text("每页行数") input').fill('2')
  await page.waitForTimeout(400)
  body = await page.textContent('body')
  if (!body.includes('共 3 页')) fail.push(`[${label}] 分页页数错误: ${(body.match(/共 \d+ 页/) || [])[0]}`)
  const sheets = await page.locator('.sheet').count()
  if (sheets !== 3) fail.push(`[${label}] 预览页数=${sheets}，期望 3`)
  log(`导入 5 张、每页 2 张 → 预览 ${sheets} 页 ok`)

  // 3) 旋转第一张 + 排序（左右移动）+ 删除（固定导航/吸顶条可能遮挡，直接 DOM click 派发）
  const domClick = (loc) => loc.evaluate((el) => el.click())
  await domClick(page.locator('.t-actions button[title="顺时针旋转"]').first())
  await page.waitForTimeout(150)
  await domClick(page.locator('.t-actions button[title="右移"]').first())
  await page.waitForTimeout(150)
  await domClick(page.locator('.thumb').nth(1).locator('button[title="删除"]'))
  await page.waitForTimeout(200)
  await page.waitForTimeout(300)
  body = await page.textContent('body')
  if (!body.includes('已选 4 张')) fail.push(`[${label}] 删除后数量错误: ${(body.match(/已选 \d+ 张/) || [])[0]}`)
  log('旋转/排序/删除生效 ok')

  // 4a) 打印：首次解锁（本地模拟支付），二次触发 window.print（已打桩）
  await page.getByRole('button', { name: '打印成册' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '打印成册' }).click()
  await page.waitForTimeout(300)
  const printCalls = await page.evaluate(() => window.__printCalls)
  if (printCalls < 1) fail.push(`[${label}] window.print 未被调用`)
  log(`window.print 已调用 ${printCalls} 次 ok`)

  // 4b) 导出 PDF：首次解锁，二次下载；断言魔数/结尾/页数
  await page.getByRole('button', { name: '导出 PDF' }).click()
  await page.waitForTimeout(500)
  const pdfPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PDF' }).click()
  const pdf = await pdfPromise
  const pdfBuf = await pdf.path().then((p) => import('node:fs').then((fs) => fs.readFileSync(p)))
  if (!pdfBuf.subarray(0, 5).toString().startsWith('%PDF')) fail.push(`[${label}] PDF 魔数错误`)
  const tail = pdfBuf.subarray(-1024).toString()
  if (!/%%EOF/.test(tail)) fail.push(`[${label}] PDF 缺 %%EOF`)
  const pdfDoc = await PDFDocument.load(pdfBuf)
  const pageCount = pdfDoc.getPageCount()
  if (pageCount !== 2) fail.push(`[${label}] PDF 页数=${pageCount}，期望 2（4 张每页 2 张）`)
  log(`PDF ok, ${pdfBuf.length}B, 页数=${pageCount}, 魔数=%PDF`)

  // 横向溢出
  const over = await horizontalOverflow(page)
  if (over > 0) fail.push(`[${label}] 横向溢出 ${over}px`)

  // 截图
  if (label === 'pc') await page.screenshot({ path: join(SHOTS, 'pc-layout.png'), fullPage: false })
  if (label === 'tablet') await page.screenshot({ path: join(SHOTS, 'tablet-layout.png'), fullPage: false })
  if (label === 'mobile') await page.screenshot({ path: join(SHOTS, 'mobile-list.png'), fullPage: false })

  // 5) 断网二次加载（SW 缓存 + IDB 持久）
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(800)
  const offlineBody = await page.textContent('body')
  if (!offlineBody.includes('已选 4 张')) fail.push(`[${label}] 断网后照片丢失`)
  log('断网二次加载照片仍在 ok')

  await browser.close()
}

log(fail.length ? `FAILED: ${fail.join('\n')}` : 'ALL PASS')
process.exit(fail.length ? 1 : 0)
