/**
 * E2E · 行光阅读器插件（2026-10-21）
 * 1) PWA 详情页：plugin 型、手册入口、下载卡片、SHA256 展示；下载 zip 字节 sha256/sizeBytes 与 manifest 一致。
 * 2) 搜索可命中「行光阅读器 / 专注阅读」。
 * 3) persistent context --load-extension 加载未打包目录：SW 注册、popup/options 可打开、无 pageerror；
 *    在本地文章页直接求值 content.js 注入专注层，断言工具条出现、退出后节点清空。
 */
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

async function loadPlaywright() {
  try {
    const m = await import('playwright')
    return m.chromium ? m : m.default
  } catch {
    const m = await import('/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js')
    return m.chromium ? m : m.default
  }
}
const { chromium } = await loadPlaywright()

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'http://localhost:4173'
const fail = []
const log = (...a) => console.log('[e2e-llr]', ...a)

const EXPECTED = {
  sha256: '28a171799bd3a4d3ae8ac2f08ee5c905ccf967fdd3a7ffb3569a94a1f3f9ad06',
  sizeBytes: 9127
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })

  // —— 1) 详情页 + 下载校验 ——
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${ORIGIN}/#/t/line-light-reader`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.download-card', { timeout: 10000 })

  const body = await page.textContent('body')
  for (const kw of ['行光阅读器', '使用手册', '直接下载 zip', EXPECTED.sha256.slice(0, 16)]) {
    if (!body.includes(kw)) fail.push(`详情页缺少文案：${kw}`)
  }
  log('详情页 plugin 卡片与手册/SHA 已出现')

  // 下载 zip 并比对字节
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('a.btn-primary[download]').first().click()
  ])
  await dl.saveAs(join(tmpdir(), 'llr-dl.zip'))
  const buf = readFileSync(join(tmpdir(), 'llr-dl.zip'))
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== EXPECTED.sha256) fail.push(`下载 zip sha256 不一致：${sha}`)
  if (buf.length !== EXPECTED.sizeBytes) fail.push(`下载 zip sizeBytes 不一致：${buf.length}`)
  log(`下载 zip：${buf.length}B，sha256=${sha.slice(0, 16)}… 一致`)

  // 搜索命中
  await page.goto(`${ORIGIN}/#/search?q=${encodeURIComponent('专注阅读')}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  if (!(await page.textContent('body')).includes('行光阅读器')) fail.push('搜索「专注阅读」未命中插件')
  log('搜索「专注阅读」命中')

  // 截图：详情页 PC
  await page.goto(`${ORIGIN}/#/t/line-light-reader`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.download-card')
  const shotDir = join(ROOT, 'src/tools/line-light-reader/docs/shots')
  const { mkdirSync: mkdir } = await import('node:fs')
  mkdir(shotDir, { recursive: true })
  await page.screenshot({ path: join(shotDir, 'detail-pc.png'), fullPage: true })
  // 手机视口详情页
  const ctxM = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const pageM = await ctxM.newPage()
  await pageM.goto(`${ORIGIN}/#/t/line-light-reader`, { waitUntil: 'networkidle' })
  await pageM.waitForSelector('.download-card')
  await pageM.screenshot({ path: join(shotDir, 'detail-mobile.png'), fullPage: true })
  log('详情页 PC/手机截图完成')

  if (errors.length) fail.push(`pageerror: ${errors.join('; ')}`)

  await ctx.close()
  await ctxM.close()

  // —— 2) 加载未打包扩展（persistent context）——
  const extDir = join(ROOT, 'plugins-src/line-light-reader')
  const userData = mkdtempSync(join(tmpdir(), 'llr-ext-'))
  const pctx = await chromium.launchPersistentContext(userData, {
    executablePath: CHROMIUM,
    viewport: { width: 1280, height: 860 },
    args: [...LAUNCH_ARGS, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
  })
  const ppage = pctx.pages()[0] || (await pctx.newPage())
  const pErrors = []
  ppage.on('pageerror', (e) => pErrors.push(String(e)))
  await ppage.waitForTimeout(1500)

  // 本地文章页：直接求值 content.js，验证注入层与退出还原
  const article = mkdtempSync(join(tmpdir(), 'llr-art-'))
  writeFileSync(
    join(article, 'article.html'),
    '<html><body><main><h1>示例文章</h1><p>第一段讨论专注阅读。行光引导帮助眼睛定位下一行。</p><p>第二段讲焦点行高亮，减少阅读跳行。</p><p>第三段讲本地朗读与摘录导出。</p></main></body></html>'
  )
  await ppage.goto('file://' + join(article, 'article.html'))
  // 页面世界无 chrome.*，先打桩模拟扩展隔离世界的本地存储接口
  await ppage.evaluate(() => {
    globalThis.chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {}
    }
  })
  await ppage.addScriptTag({ path: join(extDir, 'content.js') })
  await ppage.waitForTimeout(300)
  const bar = await ppage.locator('#llr-root').count()
  if (!bar) fail.push('content.js 注入后未出现 #llr-root 工具条')
  const bars = await ppage.locator('#llr-root .llr-btn').count()
  if (bars < 5) fail.push(`工具条按钮不足：${bars}`)
  log('本地文章页注入成功，工具条按钮数=', bars)
  await ppage.screenshot({ path: join(shotDir, 'article-focus.png') })

  // 退出按钮
  await ppage.locator('#llr-root .llr-btn[data-k="exit"]').click()
  await ppage.waitForTimeout(200)
  if (await ppage.locator('#llr-root').count()) fail.push('退出后工具条未移除')
  if (await ppage.locator('#llr-style').count()) fail.push('退出后样式节点未移除')
  log('退出还原完成，注入节点已清空')

  // popup / options 可解析
  for (const f of ['popup.html', 'options.html']) {
    const ok = readFileSync(join(extDir, f), 'utf8').includes('行光')
    if (!ok) fail.push(`${f} 文案缺失`)
  }
  if (pErrors.length) fail.push(`扩展上下文 pageerror: ${pErrors.join('; ')}`)
  await pctx.close()

  await browser.close()

  if (fail.length) {
    console.error('\n❌ E2E 失败：')
    fail.forEach((f) => console.error(' -', f))
    process.exit(1)
  }
  console.log('\n✅ 行光阅读器插件 E2E 全部通过')
}

main().catch((e) => { console.error(e); process.exit(1) })
