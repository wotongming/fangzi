/**
 * 005 跨框架组件库工作台：多端 E2E 验证 + 有效截图采集（档位：M）。
 * 覆盖：
 *  - PC 1280×800 全链路：组件库 → 新建 → 三栏建模/预览/代码 →
 *    生成的原生 Web Component 在 iframe 内真实运行（customElements 定义、Shadow DOM 渲染、
 *    属性 setter→attribute 反射、点击派发 composed CustomEvent 回流事件日志、boolean 禁用）→
 *    代码 tab（免费 native/docs/manifest，Pro Lit 门控）→ 升级解锁 → Lit 代码可见 →
 *    下载单文件 .js / 演示页 .html / 免费 zip / Pro zip → 保存本地组件库
 *  - 独立产物：下载的 .demo.html 以 file:// 打开，真实渲染 + 控件改值 + 事件
 *  - 平板 834×1112 / 手机 375×812：进入工作台，无横向溢出，iframe 真实渲染
 *  - SEO（title）、console 无报错
 * 运行前需先启动：npm run preview（http://localhost:4173）
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/wc-workbench/docs/shots')
const BASE = 'http://localhost:4173/#/t/wc-workbench'
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
async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name), fullPage: false })
  return name
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
async function newCtx(viewport) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}
/** 取 srcdoc iframe 的 content frame */
async function previewFrame(page) {
  const handle = await page.$('iframe[title="组件实时预览"]')
  if (!handle) throw new Error('未找到预览 iframe')
  return handle.contentFrame()
}
/** 清空 localStorage 后进入，保证免费档初始态 */
async function gotoFresh(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
}

/* ---------------- PC 全链路 ---------------- */
{
  const ctx = await newCtx({ width: 1280, height: 800 })
  const page = await ctx.newPage()
  const downloads = []
  page.on('download', (d) => downloads.push(d))
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !/serviceWorker|fetching the script|An unknown error occurred when fetching|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await gotoFresh(page)

  await check('SEO：标题含跨框架组件库工作台', async () => {
    await page.waitForSelector('h1')
    const t = await page.title()
    if (!/跨框架组件库工作台/.test(t)) throw new Error('title=' + t)
    return t
  })

  await check('组件库初始视图渲染（新建/导入按钮）', async () => {
    await page.waitForSelector('text=＋ 新建组件')
    return 'ok'
  })
  await shot(page, 'shot-01-library.png')

  await check('新建组件 → 进入三栏工作台，标签 wc-my-button 合法', async () => {
    await page.click('text=＋ 新建组件')
    await page.waitForSelector('.studio')
    const tag = await page.textContent('.tag-info code')
    if (!/wc-my-button/.test(tag || '')) throw new Error('tag=' + tag)
    return tag
  })

  await check('预览 iframe 内生成的原生组件真实运行（已注册 + Shadow 渲染）', async () => {
    await page.waitForSelector('.preview-col .ok', { timeout: 8000 })
    const f = await previewFrame(page)
    await f.waitForSelector('#el', { timeout: 5000 })
    const info = await f.evaluate(() => {
      const el = document.getElementById('el')
      return {
        registered: !!customElements.get('wc-my-button'),
        hasShadow: !!el.shadowRoot,
        labelText: el.shadowRoot?.querySelector('[data-label]')?.textContent ?? null,
        actionBtn: !!el.shadowRoot?.querySelector('button[data-action]'),
        iconSlot: !!el.shadowRoot?.querySelector('slot[name="icon"]'),
        defaultSlot: !!el.shadowRoot?.querySelector('slot:not([name])')
      }
    })
    if (!info.registered || !info.hasShadow || !info.actionBtn || !info.iconSlot || !info.defaultSlot)
      throw new Error(JSON.stringify(info))
    return JSON.stringify(info)
  })
  await shot(page, 'shot-02-studio.png')

  await check('属性试值 label 实时写入（setter→shadow 文本更新）', async () => {
    const labelInput = page.locator('.live-row', { hasText: 'label' }).locator('input[type="text"]')
    await labelInput.fill('Hello 005')
    await page.waitForTimeout(250)
    const f = await previewFrame(page)
    const txt = await f.evaluate(() => document.getElementById('el').shadowRoot.querySelector('[data-label]').textContent)
    if (txt !== 'Hello 005') throw new Error('shadow label=' + JSON.stringify(txt))
    // 同步反射到 attribute
    const attr = await f.evaluate(() => document.getElementById('el').getAttribute('label'))
    if (attr !== 'Hello 005') throw new Error('attr label=' + attr)
    return 'shadow/attribute 均更新'
  })

  await check('点击组件按钮派发 composed press 事件并回流事件日志', async () => {
    const f = await previewFrame(page)
    // 在 Shadow 内部按钮上触发真实点击（启用态会走监听器，事件 composed 冒泡出 iframe）
    const dispatched = await f.evaluate(() => {
      document.getElementById('el').shadowRoot.querySelector('button[data-action]').click()
      return true
    })
    void dispatched
    await page.waitForSelector('.eventlog div', { timeout: 5000 })
    const line = await page.locator('.eventlog div').first().textContent()
    if (!/press/.test(line || '')) throw new Error('日志=' + line)
    return line
  })

  await check('boolean disabled：勾选后内部按钮禁用，点击不再新增事件', async () => {
    const before = await page.locator('.eventlog div').count()
    await page.locator('.live-row', { hasText: 'disabled' }).locator('input[type="checkbox"]').check()
    await page.waitForTimeout(200)
    const f = await previewFrame(page)
    const disabled = await f.evaluate(() => {
      const el = document.getElementById('el')
      const inner = el.shadowRoot.querySelector('button[data-action]')
      return { host: el.disabled, attr: el.hasAttribute('disabled'), inner: inner.disabled }
    })
    if (!disabled.host || !disabled.attr || !disabled.inner) throw new Error(JSON.stringify(disabled))
    // 内部按钮已 disabled：用 DOM .click()（对禁用元素规范上是空操作）确认不会新增事件
    const clickedAnyway = await f.evaluate(() => {
      document.getElementById('el').shadowRoot.querySelector('button[data-action]').click()
      return true
    })
    void clickedAnyway
    await page.waitForTimeout(200)
    const after = await page.locator('.eventlog div').count()
    if (after !== before) throw new Error(`禁用仍派发事件 ${before}→${after}`)
    await page.locator('.live-row', { hasText: 'disabled' }).locator('input[type="checkbox"]').uncheck()
    return '禁用生效，未误派发'
  })
  await shot(page, 'shot-03-live-event.png')

  await check('免费代码 tab：native 可见；Lit tab 显示专业版门控', async () => {
    const nativeCode = await page.locator('.code-wrap code').innerText()
    if (!/class MyButton extends HTMLElement/.test(nativeCode)) throw new Error('native 代码未展示')
    await page.locator('.tab', { hasText: 'Lit' }).click()
    await page.waitForSelector('.lock-title', { timeout: 6000 })
    const lockText = await page.textContent('.lock-title')
    if (!/专业版/.test(lockText || '')) throw new Error(lockText)
    // API 文档 / manifest 免费可见
    await page.locator('.tab', { hasText: 'API 文档' }).click()
    await page.waitForTimeout(150)
    const docs = await page.locator('.code-wrap code').innerText()
    if (!/## 属性/.test(docs)) throw new Error('文档未展示')
    return 'native/docs 免费可见，Lit 门控'
  })

  await check('免费态：Lit/React/Vue 门控，点 Pro 产物提示升级（不发起真实支付）', async () => {
    for (const t of ['Lit', 'React', 'Vue']) {
      await page.locator('.tab', { hasText: t }).click()
      await page.waitForSelector('.lock-title', { timeout: 6000 })
      const txt = await page.textContent('.lock-title')
      if (!/专业版/.test(txt || '')) throw new Error(`${t} 未门控}`)
    }
    // 免费态点「完整 npm 包」应拦截并提示
    await page.locator('.export-list .exp.pro-exp').click()
    await page.locator('.notice', { hasText: '专业版' }).waitFor({ timeout: 4000 })
    return 'Pro 门控生效'
  })
  await shot(page, 'shot-04-pro-locked.png')

  await check('已购解锁：写入 paid freemium-pro 订单后重载，Pro 代码全部可见', async () => {
    await page.evaluate(() => {
      const key = 'fangzi:billing:v1'
      const state = {
        orders: [
          {
            id: 'e2e-paid-005', toolId: 'wc-workbench', kind: 'freemium-pro',
            amountCents: 4990, currency: 'CNY', status: 'paid', provider: 'local-mock',
            createdAt: new Date().toISOString()
          }
        ],
        usage: {}
      }
      localStorage.setItem(key, JSON.stringify(state))
    })
    // 当前已停留在相同 hash 路由，goto 同 URL 不会真正刷新，必须 reload 才能重读账单
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.pro-badge.on', { timeout: 6000 })
    await page.click('text=＋ 新建组件')
    await page.waitForSelector('.studio')
    await page.waitForSelector('.preview-col .ok', { timeout: 8000 })
    await page.locator('.tab', { hasText: 'Lit' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.code-wrap .lock').length === 0, null, { timeout: 6000 })
    const lit = await page.locator('.code-wrap code').innerText()
    if (!/@customElement\("wc-my-button"\)/.test(lit)) throw new Error('Lit 未解锁')
    await page.locator('.tab', { hasText: 'React' }).click()
    await page.waitForTimeout(150)
    const r = await page.locator('.code-wrap code').innerText()
    if (!/createComponent/.test(r) || !/wc-my-button/.test(r)) throw new Error('React wrapper 异常')
    await page.locator('.tab', { hasText: 'Vue' }).click()
    await page.waitForTimeout(150)
    const v = await page.locator('.code-wrap code').innerText()
    if (!/defineComponent/.test(v)) throw new Error('Vue wrapper 异常')
    return 'Lit/React/Vue 已解锁'
  })
  await shot(page, 'shot-05-pro-unlocked.png')

  await check('下载：单文件 .js / 演示页 .html / 免费 zip / Pro npm zip 四个文件名正确', async () => {
    const captured = []
    async function clickExport(idx, expectPart) {
      const dp = page.waitForEvent('download', { timeout: 6000 })
      await page.locator('.export-list .exp').nth(idx).click()
      const d = await dp
      const name = d.suggestedFilename()
      if (!name.includes(expectPart)) throw new Error(`第 ${idx} 项期望含 ${expectPart}，实际 ${name}`)
      captured.push(d)
      return name
    }
    const n1 = await clickExport(0, 'wc-my-button.js')
    const n2 = await clickExport(1, '.demo.html')
    const n3 = await clickExport(2, '-webcomponent.zip')
    const n4 = await clickExport(3, '-npm.zip')
    await captured[1].saveAs('/tmp/wc-005.demo.html')
    return [n1, n2, n3, n4].join(' | ')
  })

  await check('保存到本地组件库并返回可见卡片', async () => {
    page.on('dialog', (d) => d.dismiss())
    await page.click('.studio-bar .btn-primary')
    await page.waitForTimeout(300)
    await page.click('text=← 返回组件库')
    await page.waitForSelector('.lib-card')
    const card = await page.textContent('.lib-card')
    if (!/MyButton/.test(card || '') || !/wc-my-button/.test(card || '')) throw new Error(card)
    return '卡片存在'
  })
  await shot(page, 'shot-05-saved.png')

  await check('PC console 无报错', async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.join(' || '))
    return '无 pageerror / console.error'
  })

  await ctx.close()
}

/* ---------------- 独立产物 file:// 校验 ---------------- */
{
  const ctx = await newCtx({ width: 1100, height: 760 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await check('独立演示页 file:// 打开：真实渲染 + 改值 + 事件', async () => {
    await page.goto('file:///tmp/wc-005.demo.html', { waitUntil: 'load' })
    await page.waitForTimeout(300)
    const init = await page.evaluate(() => {
      const el = document.getElementById('el')
      return { registered: !!customElements.get('wc-my-button'), shadow: !!el.shadowRoot }
    })
    if (!init.registered || !init.shadow) throw new Error(JSON.stringify(init))
    // 控件改 label
    await page.fill('input[data-p="label"]', 'Standalone 独立产物')
    await page.waitForTimeout(200)
    const got = await page.evaluate(() => document.getElementById('el').shadowRoot.querySelector('[data-label]').textContent)
    if (got !== 'Standalone 独立产物') throw new Error('label=' + got)
    // 点击派发 press
    const logBefore = await page.locator('#log').innerText()
    await page.evaluate(() => document.getElementById('el').shadowRoot.querySelector('button[data-action]').click())
    await page.waitForTimeout(150)
    const logAfter = await page.locator('#log').innerText()
    if (logAfter === logBefore || !/press/.test(logAfter)) throw new Error('事件未回流：' + logAfter)
    if (errs.length) throw new Error(errs.join(' | '))
    return '渲染/改值/事件 全部通过'
  })
  await shot(page, 'shot-06-standalone.png')
  await ctx.close()
}

/* ---------------- 平板 / 手机 ---------------- */
for (const [label, vp, shotName] of /** @type {const} */ ([
  ['平板 834×1112', { width: 834, height: 1112 }, 'shot-07-tablet.png'],
  ['手机 375×812', { width: 375, height: 812 }, 'shot-08-phone.png']
])) {
  const ctx = await newCtx(vp)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await gotoFresh(page)
  await check(`${label}：进入工作台无横向溢出且预览真实渲染`, async () => {
    await page.click('text=＋ 新建组件')
    await page.waitForSelector('.studio')
    await page.waitForSelector('.preview-col .ok', { timeout: 8000 })
    await noHorizontalOverflow(page, label)
    const f = await previewFrame(page)
    const ok = await f.evaluate(() => {
      const el = document.getElementById('el')
      return !!customElements.get('wc-my-button') && !!el?.shadowRoot?.querySelector('button[data-action]')
    })
    if (!ok) throw new Error('iframe 组件未渲染')
    if (errs.length) throw new Error(errs.join(' | '))
    return '渲染正常，无溢出'
  })
  await shot(page, shotName)
  await ctx.close()
}

await browser.close()

/* ---------------- 汇总 ---------------- */
let fail = 0
for (const r of results) {
  if (!r.ok) fail++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
}
console.log(`\n共 ${results.length} 项，失败 ${fail} 项`)
process.exit(fail ? 1 : 0)
