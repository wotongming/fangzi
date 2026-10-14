/**
 * 002 GPU大数据可视化面板：多端多尺寸 E2E 验证 + 有效截图采集。
 * 覆盖：
 *  - PC 1280×800 / 平板 834×1112 / 手机 375×812，无横向溢出
 *  - 免费额度门控 → 买断 → 100 万点示例渲染（FPS）、三种图型、框选统计、PNG/CSV 导出
 *  - CSV 文件导入流程、SEO（title / JSON-LD）、console 无报错
 * 运行前需先启动：npm run preview（http://localhost:4173）
 * 截图输出到 src/tools/gpu-data-viz/docs/shots/（与 guide 引用路径一致）
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/gpu-data-viz/docs/shots')
const TMP = join(ROOT, 'tmp-test-data')
const BASE = 'http://localhost:4173/#/t/gpu-data-viz'
const CHROMIUM = '/usr/local/bin/chromium'

mkdirSync(SHOTS, { recursive: true })
mkdirSync(TMP, { recursive: true })

// 生成 2 万行带噪声波形 CSV（数值两列）
const csvLines = ['序号,读数']
for (let i = 0; i < 20000; i++) {
  const y = Math.sin(i / 50) * 100 + (Math.random() - 0.5) * 12
  csvLines.push(`${i},${y.toFixed(3)}`)
}
writeFileSync(join(TMP, 'wave.csv'), csvLines.join('\n'))

const results = []
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail ?? '' })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu']
})

// ---------- PC 全流程 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  await check('SEO: 标题', async () => {
    const t = await page.title()
    if (!t.includes('GPU大数据可视化面板')) throw new Error(`标题不符：${t}`)
    return t
  })
  await check('SEO: JSON-LD SoftwareApplication', () =>
    page.evaluate(() => {
      const hit = [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) =>
        (s.textContent || '').includes('SoftwareApplication')
      )
      if (!hit) throw new Error('缺少 SoftwareApplication JSON-LD')
      return 'JSON-LD ✓'
    })
  )
  const backend = await page.locator('.badge-row .badge').first().innerText()
  results.push({ name: '探测到的渲染后端', ok: true, detail: backend })

  // 免费用户载入示例（50 万点）
  await page.getByRole('button', { name: /载入 100 万点示例/ }).click()
  await page.waitForSelector('text=/已载入/', { timeout: 60000 })
  const loadedFree = await page.locator('.badge-row').innerText()
  await check('免费版载入 50 万点', () => {
    if (!loadedFree.includes('500K') && !loadedFree.includes('500,000')) throw new Error(loadedFree)
    return loadedFree.replace(/\n/g, ' | ')
  })
  await page.waitForTimeout(1600)

  // 未解锁时导出 CSV 应被门控
  await page.getByRole('button', { name: /导出 CSV/ }).click()
  await check('变现: 专业导出免费用户被门控', async () => {
    const err = await page.locator('.error-text').first().innerText({ timeout: 3000 })
    if (!err.includes('专业能力')) throw new Error('未出现门控提示：' + err)
    return 'gated ✓'
  })

  // 买断 → 重新载入 100 万点
  await page.getByRole('button', { name: /立即买断/ }).click()
  await page.waitForSelector('.owned-tag', { timeout: 5000 })
  await page.getByRole('button', { name: /载入 100 万点示例/ }).click()
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.badge-row')?.textContent || ''
      return t.includes('1.00M') || t.includes('1,000,000')
    },
    { timeout: 60000 }
  )
  await page.waitForTimeout(2000)
  await check('买断后载入 100 万点且持续渲染', async () => {
    const t = await page.locator('.badge-row').innerText()
    const m = t.match(/FPS (\d+)/)
    if (!m) throw new Error('无 FPS 读数')
    return `points=1M fps=${m[1]}`
  })
  await page.screenshot({ path: join(SHOTS, 'pc-scatter.png'), fullPage: true })

  // 热力图
  await page.getByRole('button', { name: '热力图' }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(SHOTS, 'pc-heatmap.png'), fullPage: true })

  // 折线
  await page.getByRole('button', { name: /折线/ }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(SHOTS, 'pc-line.png'), fullPage: true })
  await page.getByRole('button', { name: '散点密度' }).click()
  await page.waitForTimeout(500)

  // 框选统计
  await page.getByRole('button', { name: /框选/ }).click()
  const box = await page.locator('.canvas-wrap').boundingBox()
  if (!box) throw new Error('无画布区域')
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.72, { steps: 8 })
  await page.mouse.up()
  await page.waitForSelector('.brush-card', { timeout: 8000 })
  await check('框选统计出现且点数>0', async () => {
    const t = await page.locator('.brush-card b').first().innerText()
    const m = t.match(/([\d,]+)\s*点/)
    if (!m || Number(m[1].replace(/,/g, '')) === 0) throw new Error(t)
    return t
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SHOTS, 'pc-brush.png'), fullPage: true })

  // PNG 导出（合成数据层+HUD）
  await check('导出 PNG 下载', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.getByRole('button', { name: '导出 PNG' }).click()])
    return dl.suggestedFilename()
  })

  // CSV 导出（已解锁）
  await check('买断后导出选区 CSV 下载', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.getByRole('button', { name: /导出选区 CSV/ }).click()])
    return dl.suggestedFilename()
  })

  // 嵌入组件代码
  await page.getByRole('button', { name: '嵌入组件' }).click()
  await page.waitForSelector('.modal textarea', { timeout: 3000 })
  await check('嵌入式组件代码生成', async () => {
    const code = await page.locator('.modal textarea').inputValue()
    if (!code.includes('/#/t/gpu-data-viz') || !code.includes('<iframe')) throw new Error('嵌入代码异常')
    return 'iframe embed ✓'
  })
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.modal-actions button', { hasText: '关闭' }).click().catch(() => {})

  // CSV 文件导入
  await page.setInputFiles('input[type=file]', join(TMP, 'wave.csv'))
  await page.waitForSelector('.axis-box', { timeout: 30000 })
  await page.getByRole('button', { name: /载入/ }).click()
  await page.waitForSelector('text=/已载入/', { timeout: 30000 })
  await page.getByRole('button', { name: /折线/ }).click()
  await page.waitForTimeout(800)
  await check('CSV 文件导入并绘折线', async () => {
    const t = await page.locator('.badge-row').innerText()
    if (!/已载入/.test(t)) throw new Error('未载入')
    return t.replace(/\n/g, ' | ')
  })
  await page.screenshot({ path: join(SHOTS, 'pc-csv-line.png'), fullPage: true })

  if (consoleErrors.length) results.push({ name: 'console-errors', ok: false, detail: consoleErrors.slice(0, 5).join('; ').slice(0, 500) })
  await ctx.close()
}

// ---------- 平板 / 手机：示例渲染 + 无横向溢出 ----------
for (const vp of [
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 375, height: 812 }
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /载入 100 万点示例/ }).click()
  await page.waitForSelector('text=/已载入/', { timeout: 60000 })
  await page.waitForTimeout(1800)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await check(`${vp.name}: 渲染成功且无横向溢出`, () => {
    if (overflow > 2) throw new Error(`横向溢出 ${overflow}px`)
    if (errs.length) throw new Error(errs.join('; '))
    return `overflow=${overflow}px`
  })
  await page.screenshot({ path: join(SHOTS, `${vp.name}-scatter.png`), fullPage: true })
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
