/**
 * 006 可嵌入交互组件生成平台：多端 E2E 验证 + 有效截图采集（档位：M）。
 * 覆盖：
 *  - PC 1280×800 全链路：选模板 → 配置 → Shadow DOM 内真实提交并回流到生成器 →
 *    嵌入代码/脚本结构 → 下载单文件 .js → 数据面板 → 免费版 CSV/Pro 模板计费门控
 *  - 平板 834×1112 / 手机 375×812：进入配置与预览，无横向溢出，真实组件渲染
 *  - SEO（title / JSON-LD）、console 无报错
 * 运行前需先启动：npm run preview（http://localhost:4173）
 * 截图输出到 src/tools/embed-widget-builder/docs/shots/
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/embed-widget-builder/docs/shots')
const BASE = 'http://localhost:4173/#/t/embed-widget-builder'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })

const results = []
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail ?? '' })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}
async function noHorizontalOverflow(page, label) {
  const bad = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (bad > 1) throw new Error(`${label} 横向溢出 ${bad}px`)
  return `无横向溢出（Δ=${bad}）`
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

async function newCtx(viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}

/* ---------------- PC 全链路 ---------------- */
{
  const ctx = await newCtx({ width: 1280, height: 800 })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !/serviceWorker|fetching the script|An unknown error occurred when fetching/i.test(m.text())) consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)

  await check('SEO: 标题含组件生成', async () => {
    const t = await page.title()
    if (!t.includes('可嵌入交互组件')) throw new Error(`标题不符：${t}`)
    return t
  })
  await check('SEO: JSON-LD SoftwareApplication', () =>
    page.evaluate(() => {
      const hit = [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => (s.textContent || '').includes('SoftwareApplication'))
      if (!hit) throw new Error('缺少 SoftwareApplication JSON-LD')
      return 'JSON-LD ✓'
    })
  )
  await check('列表：展示 5 类模板卡片', async () => {
    const n = await page.locator('.tpl').count()
    if (n !== 5) throw new Error(`模板数=${n}`)
    return `${n} 类`
  })
  await page.screenshot({ path: join(SHOTS, 'shot-01-list.png') })

  // 选免费的报名/联系表单
  await page.locator('.tpl', { hasText: '报名' }).first().click()
  await page.waitForTimeout(200)
  await check('进入配置页', async () => {
    await page.waitForSelector('.cfg', { timeout: 3000 })
    return '配置面板可见'
  })
  await check('免费版角标开关禁用（Pro 可关闭）', async () => {
    const disabled = await page.locator('.cfg-side input[type=checkbox]').isDisabled()
    if (!disabled) throw new Error('免费态角标应不可关闭')
    return '角标锁定 ✓'
  })
  await page.getByLabel('组件标题').fill('活动报名登记')
  await page.locator('.sw', { has: page.locator('xpath=.') }).first().waitFor().catch(() => {})
  // 选第二个品牌色
  await page.locator('.sw').nth(1).click()
  await page.screenshot({ path: join(SHOTS, 'shot-02-config.png') })

  await check('保存并预览：iframe 渲染真实组件（Shadow DOM）', async () => {
    await page.getByRole('button', { name: '保存并预览 →' }).click()
    const frame = page.frameLocator('iframe.preview-frame')
    await frame.locator('.w').waitFor({ timeout: 4000 })
    const title = await frame.locator('.t').textContent()
    if (!title.includes('活动报名登记')) throw new Error('预览标题不符：' + title)
    return title
  })

  // 在 Shadow DOM 内填写并提交
  const frame = page.frameLocator('iframe.preview-frame')
  await check('Shadow DOM 内填写并提交，成功提示出现', async () => {
    await frame.locator('input[name=name]').fill('王五')
    await frame.locator('input[name=email]').fill('wangwu@example.com')
    await frame.locator('textarea[name=message]').fill('报名两位')
    await frame.locator('button[type=submit]').click()
    await frame.locator('.ok').waitFor({ state: 'visible', timeout: 3000 })
    const ok = await frame.locator('.ok').textContent()
    if (!ok || !ok.includes('成功')) throw new Error('未显示成功提示：' + ok)
    return ok
  })
  await check('提交数据跨 frame 回流到生成器测试列表', async () => {
    await page.locator('.sub-list li').first().waitFor({ timeout: 3000 })
    const n = await page.locator('.sub-list li').count()
    if (n < 1) throw new Error('未收到预览提交')
    const txt = await page.locator('.sub-list li').first().textContent()
    if (!txt.includes('wangwu@example.com')) throw new Error('回流内容不符：' + txt)
    return `收到 ${n} 条`
  })
  await page.screenshot({ path: join(SHOTS, 'shot-03-preview.png') })

  // 嵌入导出
  await page.getByRole('button', { name: '下一步：嵌入代码 →' }).click()
  await page.waitForTimeout(200)
  await check('嵌入代码两段式：脚本 src + 自定义元素标签', async () => {
    const codes = page.locator('pre.code code')
    const embed = (await codes.first().textContent()) || ''
    if (!/src="widget-fz-[a-z0-9]{6}\.js"/.test(embed)) throw new Error('脚本相对路径缺失：' + embed)
    if (!/data-key="[a-z0-9]{6}"/.test(embed)) throw new Error('data-key 缺失')
    return embed.replace(/\s+/g, ' ').trim().slice(0, 80)
  })
  await check('脚本源码自包含：customElements + Shadow DOM', async () => {
    const src = (await page.locator('pre.code.src code').textContent()) || ''
    if (!src.includes('customElements.define')) throw new Error('缺少 define')
    if (!src.includes('attachShadow')) throw new Error('缺少 Shadow DOM')
    return `脚本 ${(src.length / 1024).toFixed(1)}KB`
  })
  await check('下载单文件 .js（触发浏览器下载，文件名正确）', async () => {
    const dlp = page.waitForEvent('download', { timeout: 4000 })
    await page.getByRole('button', { name: '下载 .js 脚本' }).click()
    const dl = await dlp
    if (!/^widget-fz-[a-z0-9]{6}\.js$/.test(dl.suggestedFilename())) throw new Error('下载文件名不符：' + dl.suggestedFilename())
    return dl.suggestedFilename()
  })
  await page.screenshot({ path: join(SHOTS, 'shot-04-embed.png') })

  // 数据面板
  await page.locator('.step', { hasText: '5 数据' }).click()
  await page.waitForTimeout(200)
  await check('数据面板列出测试提交', async () => {
    const rows = await page.locator('.data-table tbody tr').count()
    if (rows < 1) throw new Error('数据表无记录')
    return `${rows} 行`
  })
  await check('免费版 CSV 导出被计费门控拦截', async () => {
    await page.getByRole('button', { name: /导出 CSV/ }).click()
    await page.locator('.notice', { hasText: '专业版' }).waitFor({ timeout: 2000 })
    return '门控提示 ✓'
  })

  // 返回列表，验证 Pro 模板门控
  await page.getByRole('button', { name: '返回我的组件' }).click()
  await page.waitForTimeout(150)
  await check('免费版点击 Pro 模板（价格计算器）被拦截', async () => {
    await page.locator('.tpl', { hasText: '价格计算器' }).first().click()
    await page.locator('.notice', { hasText: '专业版' }).waitFor({ timeout: 2000 })
    return 'Pro 模板门控 ✓'
  })
  await check('我的组件已保存 1 个', async () => {
    const n = await page.locator('.mine-card').count()
    if (n !== 1) throw new Error(`我的组件数=${n}`)
    return `${n} 个`
  })
  await check('console 无错误', () => {
    if (consoleErrors.length) throw new Error(consoleErrors.join(' | ').slice(0, 300))
    return '无错误'
  })
  await check('PC 无横向溢出', () => noHorizontalOverflow(page, 'PC'))

  await ctx.close()
}

/* ---------------- 平板 / 手机：布局 + 预览渲染 ---------------- */
for (const [label, vp, shot] of [
  ['平板', { width: 834, height: 1112 }, 'shot-tablet.png'],
  ['手机', { width: 375, height: 812 }, 'shot-phone.png']
]) {
  const ctx = await newCtx(vp)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.locator('.tpl', { hasText: '星级评分' }).first().click()
  await page.waitForTimeout(200)
  await check(`${label} 配置页无横向溢出`, () => noHorizontalOverflow(page, label))
  await page.getByRole('button', { name: '保存并预览 →' }).click()
  const frame = page.frameLocator('iframe.preview-frame')
  await check(`${label} 预览真实组件渲染`, async () => {
    await frame.locator('.w').waitFor({ timeout: 4000 })
    await frame.locator('.stars button').nth(4).waitFor({ timeout: 2000 })
    return '星级组件可见'
  })
  await check(`${label} Shadow DOM 可交互（点 5 星）`, async () => {
    await frame.locator('.stars button').nth(4).click()
    const cls = await frame.locator('.stars button').nth(4).getAttribute('class')
    if (!cls || !cls.includes('on')) throw new Error('第5星未点亮')
    return '第5星点亮 ✓'
  })
  await page.screenshot({ path: join(SHOTS, shot) })
  await check(`${label} console 无页面错误`, () => { if (errs.length) throw new Error(errs.join(' | ')); return '无错误' })
  await ctx.close()
}

/* ---------------- 汇总 ---------------- */
let pass = 0
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
  if (r.ok) pass++
}
console.log(`\n通过 ${pass}/${results.length}`)
process.exit(pass === results.length ? 0 : 1)
