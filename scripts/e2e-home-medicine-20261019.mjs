/**
 * 2026-10-19 home-medicine 多端 E2E（M 档）。
 *  覆盖：空态→建成员→免费层第 2 成员升级门→建药（时段/成分/有效期/开封）→今日计划→
 *       (专业版)成分重复(对乙酰氨基酚)与抗凝+NSAID 命中、开封超期→就诊清单→说明页免责→
 *       三视口零横向溢出 + 真实截图。
 *  运行前：npx vite preview --port 4173 --host 127.0.0.1
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/home-medicine/docs/shots')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })

const fail = []
const log = (...a) => console.log('[e2e-medicine]', ...a)

function seedPro() {
  const seed = {
    orders: [
      {
        id: 'ord_e2e_med_pro',
        toolId: 'home-medicine',
        kind: 'freemium-pro',
        amountCents: 690,
        currency: 'CNY',
        status: 'paid',
        createdAt: new Date().toISOString(),
        paidAt: new Date().toISOString()
      }
    ],
    usage: {}
  }
  localStorage.setItem('fangzi:billing:v1', JSON.stringify(seed))
}

async function newCtx(browser, viewport, withPro) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  if (withPro) await ctx.addInitScript(seedPro)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fail.push(`pageerror: ${e.message}`))
  page.on('dialog', (d) => d.accept())
  return { ctx, page }
}

async function overflow(page, label) {
  const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  const bad = d.sw - d.cw > 2
  log(`overflow[${label}] ${d.sw}/${d.cw} -> ${bad ? 'FAIL' : 'ok'}`)
  if (bad) fail.push(`${label} 横向溢出 ${d.sw - d.cw}px`)
}
async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name), fullPage: true })
  log('shot', name)
}

async function gotoTool(page) {
  await page.goto(`${ORIGIN}/#/t/home-medicine`)
  await page.waitForSelector('.mem-chip', { timeout: 15000 })
}

async function addMember(page, name) {
  await page.locator('.mem-chip.add').first().click()
  const input = page.locator('input[placeholder*="爸爸"]')
  await input.waitFor({ timeout: 5000 })
  await input.fill(name)
  await page.locator('.card', { hasText: '成员称呼' }).getByRole('button', { name: '保存' }).click()
  await page.waitForSelector('.seg', { timeout: 5000 })
}

async function addMed(page, cfg) {
  await page.getByRole('button', { name: /药箱/ }).click()
  await page.getByRole('button', { name: '＋ 添加药品' }).click()
  const form = page.locator('.form-card')
  await form.waitFor({ timeout: 5000 })
  await form.locator('input[placeholder*="苯磺酸"]').fill(cfg.name)
  if (cfg.spec) await form.locator('input[placeholder*="5mg"]').fill(cfg.spec)
  if (cfg.form) await form.locator('select').nth(1).selectOption(cfg.form)
  for (const s of cfg.slots ?? []) await form.getByRole('button', { name: s, exact: true }).click()
  for (const ing of cfg.ingredients ?? []) await form.getByRole('button', { name: ing, exact: true }).click()
  const dates = form.locator('input[type="date"]')
  if (cfg.expiry) await dates.nth(2).fill(cfg.expiry)
  if (cfg.opened) await dates.nth(3).fill(cfg.opened)
  if (cfg.openDays) await form.locator('input[inputmode="numeric"]').fill(String(cfg.openDays))
  await form.getByRole('button', { name: '保存' }).click()
  await page.waitForSelector('.card-row', { timeout: 5000 })
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

  // —— 免费态（PC）：建成员、第 2 成员门、建药、今日计划、专业版页门 ——
  {
    const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, false)
    await gotoTool(page)
    await addMember(page, '爸爸')

    // 免费层第 2 位成员被门拦截
    await page.locator('.mem-chip.add').first().click()
    await page.waitForTimeout(400)
    const gateToast = (await page.locator('.toast').innerText().catch(() => '')) || ''
    const memberFormShown = await page.locator('input[placeholder*="爸爸"]').isVisible().catch(() => false)
    if (memberFormShown || !gateToast.includes('升级')) fail.push(`免费层第 2 成员应被升级门拦截，toast=${gateToast}`)
    log('免费第 2 成员门 OK：', gateToast)

    await addMed(page, { name: '苯磺酸氨氯地平片', spec: '5mg*7片', slots: ['早', '晚'], ingredients: [], expiry: '2027-06-01' })
    // 今日计划
    await page.getByRole('button', { name: '今日用药' }).click()
    await page.waitForSelector('.plan-item')
    const planText = await page.locator('section').first().innerText()
    if (!planText.includes('苯磺酸氨氯地平片') || !planText.includes('早') || !planText.includes('晚')) {
      fail.push('今日计划应含药品与早/晚时段')
    }
    await shot(page, 'shot-01-pc-plan-free.png')

    // 药箱
    await page.getByRole('button', { name: /药箱/ }).click()
    await page.waitForSelector('.card-row')
    const expBadge = await page.locator('.exp-badge').first().innerText()
    if (!expBadge.includes('2027-06-01')) fail.push(`有效期标签应含 2027-06-01，实际：${expBadge}`)
    await shot(page, 'shot-02-pc-cabinet-free.png')

    // 安全梳理 / 就诊清单：免费版应显示升级卡
    await page.getByRole('button', { name: '安全梳理' }).click()
    await page.waitForSelector('.upgrade-card')
    if (!(await page.locator('.upgrade-card').innerText()).includes('升级专业版')) fail.push('免费态安全梳理应显示升级卡')
    await page.getByRole('button', { name: '就诊清单' }).click()
    await page.waitForSelector('.upgrade-card')
    await overflow(page, 'pc-free')
    await ctx.close()
  }

  // —— 专业态（PC）：成分重复 + 抗凝 NSAID + 开封超期 + 就诊清单 + 说明 ——
  {
    const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, true)
    await gotoTool(page)
    await addMember(page, '妈妈')

    await addMed(page, { name: '复方感冒药A', slots: ['早'], ingredients: ['对乙酰氨基酚（扑热息痛）'], expiry: '2027-06-01' })
    await addMed(page, { name: '退烧药B', slots: ['晚'], ingredients: ['对乙酰氨基酚（扑热息痛）'], expiry: '2027-06-01' })
    await addMed(page, { name: '华法林钠片', slots: ['早'], ingredients: ['华法林'], expiry: '2027-06-01' })
    await addMed(page, { name: '布洛芬缓释胶囊', slots: ['中'], ingredients: ['布洛芬'], expiry: '2027-06-01' })
    await addMed(page, { name: '某滴眼液', form: 'eyeDrop', slots: ['睡前'], expiry: '2027-06-01', opened: '2026-09-01' })

    // 今日计划（专业态）
    await page.getByRole('button', { name: '今日用药' }).click()
    await page.waitForSelector('.plan-item')
    await shot(page, 'shot-03-pc-plan-pro.png')

    // 编辑表单截图
    await page.getByRole('button', { name: /药箱/ }).click()
    await page.waitForSelector('.card-row')
    await page.locator('.card-row').first().click()
    await page.waitForSelector('.form-card')
    await shot(page, 'shot-04-pc-edit-form.png')
    await page.locator('.form-card').getByRole('button', { name: '取消' }).click()

    // 安全梳理
    await page.getByRole('button', { name: '安全梳理' }).click()
    await page.waitForSelector('.finding')
    const safetyText = await page.locator('section').first().innerText()
    if (!safetyText.includes('对乙酰氨基酚')) fail.push('应命中对乙酰氨基酚成分重复')
    if (!/出血|布洛芬|抗凝/.test(safetyText)) fail.push('应命中抗凝+NSAID 出血风险')
    if (!/开封|过期|过期/.test(safetyText)) fail.push('应提示滴眼液开封超期/过期')
    const dangerCnt = await page.locator('.f-danger').count()
    log('专业态 danger 数：', dangerCnt)
    if (dangerCnt < 2) fail.push(`成分重复/高风险/开封至少应有 2 条 danger，实际 ${dangerCnt}`)
    if (!safetyText.includes('医生或药师')) fail.push('风险提示应引导咨询医生或药师')
    await shot(page, 'shot-05-pc-safety.png')

    // 就诊清单
    await page.getByRole('button', { name: '就诊清单' }).click()
    await page.waitForSelector('.clinic-pre')
    const clinic = await page.locator('.clinic-pre').innerText()
    for (const must of ['就诊带药清单', '华法林钠片', '布洛芬缓释胶囊', '妈妈']) {
      if (!clinic.includes(must)) fail.push(`就诊清单应含「${must}」`)
    }
    await shot(page, 'shot-06-pc-clinic.png')

    // 说明页免责
    await page.getByRole('button', { name: '说明' }).click()
    await page.waitForSelector('.about')
    const about = await page.locator('.about').innerText()
    if (!about.includes('不诊断') || !about.includes('医生/药师')) fail.push('说明页缺少不诊断/医生药师免责')
    await shot(page, 'shot-07-pc-about.png')
    await overflow(page, 'pc-pro')
    await ctx.close()
  }

  // —— 手机 / 平板自适应（专业态） ——
  for (const [label, vp, shotName, tab] of [
    ['mobile', { width: 375, height: 812 }, 'shot-08-mobile-plan.png', 'plan'],
    ['tablet', { width: 834, height: 1112 }, 'shot-09-tablet-safety.png', 'safety']
  ]) {
    const { ctx, page } = await newCtx(browser, vp, true)
    await gotoTool(page)
    await addMember(page, '奶奶')
    await addMed(page, { name: '复方感冒药A', slots: ['早'], ingredients: ['对乙酰氨基酚（扑热息痛）'], expiry: '2027-06-01' })
    await addMed(page, { name: '退烧药B', slots: ['晚'], ingredients: ['对乙酰氨基酚（扑热息痛）'], expiry: '2027-06-01' })
    if (tab !== 'safety') await page.getByRole('button', { name: '今日用药' }).click()
    if (tab === 'safety') {
      await page.getByRole('button', { name: '安全梳理' }).click()
      await page.waitForSelector('.finding')
    } else {
      await page.waitForSelector('.plan-item')
    }
    await shot(page, shotName)
    await overflow(page, label)
    await ctx.close()
  }

  await browser.close()

  if (fail.length) {
    console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
    process.exit(1)
  }
  console.log('\n✅ home-medicine 三视口 E2E 全部通过，截图 9 张')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
