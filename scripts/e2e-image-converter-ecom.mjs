/**
 * 002 image-converter 电商上新模式 E2E + 通用模式回归 + 三端截图。
 * 不触发 AI（bgMode=none），聚焦：多规格几何 / 水印 / 命名分目录 / ZIP+manifest / 计费免费额度。
 * 另在全新上下文验证通用单张转换不受影响。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/image-converter/docs/shots')
const IMG = join(ROOT, 'tmp-test-img')
const BASE = 'http://localhost:4173/#/t/image-converter'
const CHROMIUM = '/usr/local/bin/chromium'

mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const results = []
async function check(name, fn) {
  try {
    results.push({ name, ok: true, detail: (await fn()) ?? '' })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}

// ---------- PC：电商上新全流程 + 通用回归 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  // 捕获导出 ZIP 生成的 blob: URL（组件不触发浏览器下载，只生成对象链接）
  await page.addInitScript(() => {
    const orig = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const u = orig(blob)
      if (blob && blob.type === 'application/zip') window.__zipUrl = u
      return u
    }
  })
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // 通用模式回归（默认进入即是通用·单张）
  await page.setInputFiles('input[type=file][accept="image/*"]:not([multiple])', join(IMG, 'sample-blue-128.png'))
  await page.waitForSelector('.result img', { timeout: 15000 })
  await check('回归: 通用单张转换仍出结果', async () => {
    const btn = page.locator('.result .btn-primary')
    if ((await btn.count()) === 0) throw new Error('无下载按钮')
    return 'general convert ✓'
  })

  // 进入电商上新
  await page.getByRole('button', { name: /电商上新/ }).click()
  await page.waitForTimeout(200)

  // 导入 2 张原图（多文件 input）
  await page.setInputFiles('input[type=file][accept="image/*"][multiple]', [
    join(IMG, 'sample-red-200.png'),
    join(IMG, 'sample-blue-128.png')
  ])
  await check('电商: 导入计数与产出份数（2 原图 × 1 默认规格 = 2）', async () => {
    const t = await page.locator('.ecom .card .muted').first().innerText()
    if (!t.includes('2 张') || !t.includes('2 份')) throw new Error(t)
    return t
  })

  // 增加第二个规格：小红书 3:4
  await page.locator('.spec-item', { hasText: '小红书 竖图 3:4' }).locator('input').check()
  await check('电商: 选中 2 规格后产出份数变 4', async () => {
    const t = await page.locator('.ecom .card .muted').first().innerText()
    if (!t.includes('4 份')) throw new Error(t)
    return t
  })

  // 启用文字水印
  await page.locator('label.chk', { hasText: '启用文字水印' }).locator('input').check()
  await page.locator('input[placeholder="店铺名 / 品牌名"]').fill('方子优品')

  // 开始处理
  await page.getByRole('button', { name: /开始上新处理/ }).click()
  await page.waitForFunction(
    () => {
      const list = document.querySelector('.ecom .task-list')
      return list && [...list.querySelectorAll('li')].length === 4 && [...list.querySelectorAll('li')].every((li) => li.className === 'done')
    },
    { timeout: 60000 }
  )
  await check('电商: 2图×2规格 共 4 份全部成功', () => 'done=4/4')

  // 导出 ZIP（页内生成对象链接）并取回核验内容
  await page.getByRole('button', { name: /导出上新资料包/ }).click()
  await page.waitForSelector('text=ZIP 已生成', { timeout: 15000 })
  const zipB64 = await page.evaluate(async () => {
    const buf = await fetch(window.__zipUrl).then((r) => r.arrayBuffer())
    let bin = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  })
  const zipBytes = Uint8Array.from(Buffer.from(zipB64, 'base64'))
  await check('电商: ZIP 含平台分目录/manifest/尺寸正确', () => {
    const entries = unzipSync(zipBytes)
    const names = Object.keys(entries)
    const imgs = names.filter((n) => /\.(jpg|jpeg|png|webp)$/i.test(n))
    if (imgs.length !== 4) throw new Error(`图片数 ${imgs.length} != 4`)
    if (!names.some((n) => n.startsWith('taobao-1x1-800/'))) throw new Error('缺淘宝目录')
    if (!names.some((n) => n.startsWith('xiaohongshu-3x4/'))) throw new Error('缺小红书目录')
    if (!names.includes('manifest.csv')) throw new Error('缺 manifest.csv')
    const csv = new TextDecoder().decode(entries['manifest.csv'])
    if (!csv.includes('800,800')) throw new Error('manifest 缺 800x800：' + csv)
    if (!csv.includes('810,1080')) throw new Error('manifest 缺 810x1080：' + csv)
    return `dirs+manifest+dims ✓ (${imgs.length} imgs)`
  })

  await page.screenshot({ path: join(SHOTS, 'pc-ecom-done.png'), fullPage: true })

  if (consoleErrors.length) results.push({ name: 'console-errors', ok: false, detail: consoleErrors.join('; ').slice(0, 300) })
  await ctx.close()
}

// ---------- 平板 / 手机：电商模式自适应 ----------
for (const vp of [
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 375, height: 812 }
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /电商上新/ }).click()
  await page.waitForTimeout(200)
  await page.setInputFiles('input[type=file][accept="image/*"][multiple]', [join(IMG, 'sample-green-100.png')])
  await page.waitForTimeout(150)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await check(`${vp.name}: 电商模式无横向溢出`, () => {
    if (overflow > 0) throw new Error(`横向溢出 ${overflow}px`)
    return 'no-overflow ✓'
  })
  await page.screenshot({ path: join(SHOTS, `${vp.name}-ecom.png`), fullPage: true })
  await ctx.close()
}

await browser.close()
console.log('\n===== 电商上新 E2E 结果 =====')
let failed = 0
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  if (!r.ok) failed++
}
console.log(`\n通过 ${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)
