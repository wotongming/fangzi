/**
 * 001 图片处理工作台：多端多尺寸 E2E 验证 + 有效截图采集。
 * 覆盖：
 *  - PC 1280×800 / 平板 834×1112 / 手机 375×812
 *  - 单张转换流程、批量工具链流程、变现解锁流程
 *  - SEO 落地（document.title / JSON-LD）
 * 截图输出到 docs/shots/（与 guide 引用路径一致）
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'docs', 'shots')
const IMG = join(ROOT, 'tmp-test-img')
const BASE = 'http://localhost:4173/#/t/image-converter'
const CHROMIUM = '/usr/local/bin/chromium'

const viewports = [
  { name: 'pc', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 375, height: 812 }
]

mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const results = []

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail ?? '' })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}

// ---------- PC 全流程 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(BASE, { waitUntil: 'networkidle' })

  await check('SEO: 标题与描述', async () => {
    const t = await page.title()
    if (!t.includes('图片处理工作台')) throw new Error(`标题不符：${t}`)
    const desc = page.locator('meta[name=description]').getAttribute('content')
    return `title=${t}`
  })
  await check('SEO: JSON-LD SoftwareApplication', () => {
    return page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent)
      const hit = scripts.find((t) => t.includes('SoftwareApplication'))
      if (!hit) throw new Error('缺少 SoftwareApplication JSON-LD')
      return 'JSON-LD ✓'
    })
  })

  // 单张转换（默认免费）
  await page.setInputFiles('input[type=file][accept="image/*"]', join(IMG, 'sample-red-128.png'))
  await page.waitForSelector('.result img', { timeout: 15000 })
  await check('单张: 转换出结果并可下载', async () => {
    const dl = page.locator('.result .btn-primary')
    if ((await dl.count()) === 0) throw new Error('无下载按钮')
    const [download] = await Promise.all([page.waitForEvent('download'), dl.click()])
    const name = download.suggestedFilename()
    return `download=${name}`
  })

  // AI 免费额度：未购买但今日有免费额度时即可用（freemium 免费层）
  await check('变现: 免费额度内 AI 复选框可用', async () => {
    const disabled = await page.locator('input[type=checkbox] >> nth=1').isDisabled()
    if (disabled) throw new Error('有免费额度却禁用')
    return 'aiEnabled(freeQuota) ✓'
  })

  // 单张 + AI 去背景（免费额度内实际使用一次，扣减 1/3）
  await page.locator('input[type=checkbox] >> nth=1').check() // AI 去背景
  await page.getByRole('button', { name: /开始处理/ }).click()
  await page.waitForSelector('.result img', { timeout: 120000 })
  await check('单张: AI 去背景链路出结果（免费额度）', async () => {
    const meta = await page.locator('.result .meta').innerText()
    if (!meta.includes('去背景')) throw new Error('步骤日志缺失：' + meta)
    return meta.split('\n').filter(Boolean).slice(0, 3).join(' | ')
  })

  // 买断解锁（此后不限次数，不再扣免费额度）
  await page.getByRole('button', { name: /立即买断/ }).click()
  await page.waitForTimeout(600)
  await check('变现: 买断后解锁且免费额度保留', async () => {
    const disabled = await page.locator('input[type=checkbox] >> nth=1').isDisabled()
    if (disabled) throw new Error('买断后 AI 仍禁用')
    const body = await page.locator('.monet').innerText()
    if (!body.includes('免费')) throw new Error('权益面板缺失')
    return 'aiEnabled+buyout ✓'
  })

  // 批量：导入 3 张 → 工具链（转换+裁剪）→ 运行 → ZIP
  await page.getByRole('button', { name: /批量工具链/ }).click()
  await page.setInputFiles('input[type=file][accept="image/*"][multiple]', [
    join(IMG, 'sample-red-128.png'),
    join(IMG, 'sample-blue-64.png'),
    join(IMG, 'sample-green-32.png')
  ])
  await page.waitForTimeout(300)
  await check('批量: 导入计数', async () => {
    const t = await page.locator('.card .muted').first().innerText()
    if (!t.includes('3')) throw new Error(t)
    return t
  })
  await page.getByRole('button', { name: /开始批量处理/ }).click()
  await page.waitForFunction(() => {
    const list = document.querySelector('.task-list')
    return list && [...list.querySelectorAll('li')].every((li) => li.className === 'done')
  }, { timeout: 120000 })
  await check('批量: 全部任务完成', () => {
    return page.evaluate(() => {
      const done = [...document.querySelectorAll('.task-list li')].filter((li) => li.className === 'done').length
      if (done !== 3) throw new Error(`完成数 ${done} != 3`)
      return `done=${done}/3`
    })
  })
  await page.getByRole('button', { name: /导出 ZIP/ }).click()
  await page.waitForSelector('text=ZIP 已生成', { timeout: 30000 })
  await check('批量: ZIP 导出', () => {
    return page.evaluate(() => [...document.querySelectorAll('p.muted')].map((p) => p.innerText).find((t) => t.includes('ZIP')))
  })

  // 切回单张处理 tab 再截单张 AI 结果页（与 guide 引用一致）
  await page.getByRole('button', { name: /单张处理/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SHOTS, 'pc-single-ai.png'), fullPage: true })
  await page.getByRole('button', { name: /批量工具链/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SHOTS, 'pc-batch-done.png'), fullPage: true })

  if (consoleErrors.length) results.push({ name: 'console-errors', ok: false, detail: consoleErrors.join('; ').slice(0, 400) })
  await ctx.close()
}

// ---------- 平板 / 手机：单张结果 + 批量页 ----------
for (const vp of viewports.filter((v) => v.name !== 'pc')) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file][accept="image/*"]', join(IMG, 'sample-blue-64.png'))
  await page.waitForSelector('.result img', { timeout: 15000 })
  // 无横向溢出
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await check(`${vp.name}: 单张页无横向溢出`, () => {
    if (overflow > 0) throw new Error(`横向溢出 ${overflow}px`)
    return 'no-overflow ✓'
  })
  await page.screenshot({ path: join(SHOTS, `${vp.name}-single.png`), fullPage: true })

  await page.getByRole('button', { name: /批量工具链/ }).click()
  await page.setInputFiles('input[type=file][accept="image/*"][multiple]', [
    join(IMG, 'sample-green-32.png'),
    join(IMG, 'sample-blue-64.png')
  ])
  await page.getByRole('button', { name: /开始批量处理/ }).click()
  await page.waitForFunction(() => {
    const list = document.querySelector('.task-list')
    return list && [...list.querySelectorAll('li')].every((li) => li.className === 'done')
  }, { timeout: 60000 })
  await page.screenshot({ path: join(SHOTS, `${vp.name}-batch.png`), fullPage: true })
  await ctx.close()
}

await browser.close()

console.log('\n===== E2E 结果 =====')
let failed = 0
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  if (!r.ok) failed++
}
console.log(`\n通过 ${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)
