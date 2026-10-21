/**
 * E2E · 行光阅读器插件（2026-10-21，功能补全版）
 * A) PWA 详情页：plugin 型、手册、下载卡片、SHA256；下载 zip 字节 hash/size 与 manifest 一致；搜索命中。
 * B) 加载未打包扩展（persistent context --load-extension），本地多站点 fixture：
 *    逐行 span 引导色、Readability 抽取与噪声隔离、复杂代码块降级、焦点行减透明、
 *    Dyslexic 字体族生效、TTS mock 状态机（暂停/恢复/上下句/推进）、摘录保存、退出还原、回退分支。
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
  sha256: '27017839476805d0bd1fe1852c82cacdb1067de9a863070ae81f9703514b27f9',
  sizeBytes: 277825
}

const SHOT_DIR = join(ROOT, 'src/tools/line-light-reader/docs/shots')
const extDir = join(ROOT, 'plugins-src/line-light-reader')

async function noHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 2) fail.push(`${label} 横向溢出 ${overflow}px`)
}

function noisyArticle(lang = 'en') {
  const paras = lang === 'zh'
    ? [
      '专注阅读需要让眼睛顺着自然的行轨迹移动。行光引导色用冷暖渐变帮助视线落在正确的下一行。',
      '焦点行会把当前正在阅读的段落高亮，其余内容压暗，减少分心与跳行。',
      '纯净阅读模式调用 Readability 抽取正文，广告与侧边栏噪声不会进入阅读视图。',
      'OpenDyslexic 字体为拉丁文字增加字形辨识度，中文仍使用系统字体栈保证排版稳定。',
      '本地语音合成按句朗读当前文章，可暂停、恢复、上一句、下一句，并可调节语速。'
    ]
    : [
      'Focused reading helps the eye follow the natural line of text from one row to the next.',
      'A warm-to-cool guide gradient keeps the gaze on the current visual line instead of drifting back.',
      'The focus row highlights the paragraph near the viewport center and dims the surrounding content.',
      'Clean reading extracts the main article with Readability, keeping ads and sidebars out of view.',
      'Local speech synthesis reads the article sentence by sentence with pause, resume and navigation.'
    ]
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <header>Site header banner</header>
    <aside class="ad">Noise advertisement banner 12345</aside>
    <main>
      <h1>${lang === 'zh' ? '示例长文' : 'Sample Article'}</h1>
      ${paras.map((p) => `<p>${p}</p>`).join('')}
      <p>Contact us at support@example.com or Dr. Smith, e.g. for details on version 3.14 release.</p>
    </main>
    <footer>Footer links and copyright noise</footer>
    <aside id="ads">More noise ads</aside>
  </body></html>`
}

const codeDoc = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <main><h1>Technical Doc</h1>
  <p>This paragraph describes the following code sample in plain prose.</p>
  <pre><code>function greet(name) { return 'Hi ' + name; }
const x = 3.14; // decimal preserved in code block</code></pre>
  <p>Another prose paragraph after the code block closes cleanly.</p>
  </main></body></html>`

async function bootExtension(page, html, settings = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'llr-page-'))
  writeFileSync(join(dir, 'page.html'), html)
  await page.goto('file://' + join(dir, 'page.html'))
  // 页面世界打桩 chrome 存储与扩展接口（模拟隔离世界可用的本地接口）
  await page.evaluate((s) => {
    const store = { llr_settings: s, llr_excerpts: [] }
    globalThis.chrome = {
      runtime: { getURL: (p) => '../' + p },
      storage: { local: {
        get: async (keys) => {
          if (typeof keys === 'object' && keys) {
            const out = {}
            for (const k of Object.keys(keys)) out[k] = store[k] ?? keys[k]
            return out
          }
          return store
        },
        set: async (patch) => { Object.assign(store, patch) }
      } }
    }
    globalThis.__llrStore = store
  }, settings)
  const ext = join(ROOT, 'plugins-src/line-light-reader')
  await page.addScriptTag({ path: join(ext, 'vendor/Readability.js') })
  await page.addScriptTag({ path: join(ext, 'vendor/sentences.js') })
  await page.addScriptTag({ path: join(ext, 'content.js') })
  await page.waitForTimeout(300)
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })

  // —— A) PWA 详情页 + 下载校验 ——
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
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('a.btn-primary[download]').first().click()
  ])
  await dl.saveAs(join(tmpdir(), 'llr-dl.zip'))
  const buf = readFileSync(join(tmpdir(), 'llr-dl.zip'))
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== EXPECTED.sha256) fail.push(`下载 zip sha256 不一致：${sha}`)
  if (buf.length !== EXPECTED.sizeBytes) fail.push(`下载 zip sizeBytes 不一致：${buf.length}`)
  log(`详情页下载 zip：${buf.length}B，sha256=${sha.slice(0, 16)}… 一致`)

  await page.goto(`${ORIGIN}/#/search?q=${encodeURIComponent('专注阅读')}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  if (!(await page.textContent('body')).includes('行光阅读器')) fail.push('搜索「专注阅读」未命中插件')
  log('搜索命中')
  await page.screenshot({ path: join(SHOT_DIR, 'detail-pc.png'), fullPage: true })
  const ctxM = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const pageM = await ctxM.newPage()
  await pageM.goto(`${ORIGIN}/#/t/line-light-reader`, { waitUntil: 'networkidle' })
  await pageM.waitForSelector('.download-card')
  await pageM.screenshot({ path: join(SHOT_DIR, 'detail-mobile.png'), fullPage: true })
  if (errors.length) fail.push(`详情页 pageerror: ${errors.join('; ')}`)
  // 扩展弹窗（popup）截图：打桩本地存储后直接打开 popup.html
  const ctxP = await browser.newContext({ viewport: { width: 300, height: 520 } })
  const sampleExcerpt = { title: '示例文章', url: 'https://x.test/a', text: '重点摘录句', savedAt: Date.now() }
  await ctxP.addInitScript((ex) => {
    globalThis.chrome = {
      runtime: { openOptionsPage: () => {} },
      storage: { local: {
        get: async () => ({
          llr_settings: { guide: true, focusRow: true, clean: true, dyslexic: false, lineHeight: 1.8, gap: 0.9, width: 720, rate: 1 },
          llr_excerpts: [ex]
        }),
        set: async () => {}
      } }
    }
  }, sampleExcerpt)
  const pageP = await ctxP.newPage()
  await pageP.goto('file://' + join(extDir, 'popup.html'))
  await pageP.waitForTimeout(150)
  await pageP.screenshot({ path: join(SHOT_DIR, 'popup.png') })
  log('popup 截图完成')

  // 选项页：摘录列表渲染 + Markdown / JSON 导出内容（file:// 下 blob 下载事件无头不派发，
  // 这里拦截 createObjectURL 读取生成内容做断言；真实浏览器下载为标准 Blob 行为）
  await pageP.goto('file://' + join(extDir, 'options.html'))
  await pageP.waitForTimeout(150)
  const excerptRow = await pageP.locator('#list li').count()
  if (excerptRow !== 1) fail.push(`选项页摘录列表异常：${excerptRow}`)
  const exported = await pageP.evaluate(async () => {
    const captured = []
    const origCreate = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => { captured.push(blob); return origCreate(blob) }
    document.getElementById('md').click()
    document.getElementById('json').click()
    const read = (b) => b.text()
    return { md: await read(captured[0]), json: await read(captured[1]) }
  })
  if (!/### 示例文章/.test(exported.md) || !/> 重点摘录句/.test(exported.md)) fail.push('Markdown 导出内容缺失标题/引用')
  const parsed = JSON.parse(exported.json)
  if (!parsed[0]?.title || !parsed[0]?.url || !parsed[0]?.text) fail.push('JSON 导出字段缺失')
  log('选项页 Markdown / JSON 导出内容校验通过')
  await ctx.close(); await ctxM.close(); await ctxP.close()

  // —— B) 加载未打包扩展，多站点 fixture ——
  const userData = mkdtempSync(join(tmpdir(), 'llr-ext-'))
  const pctx = await chromium.launchPersistentContext(userData, {
    executablePath: CHROMIUM,
    viewport: { width: 1280, height: 860 },
    args: [...LAUNCH_ARGS, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
  })
  const ppage = pctx.pages()[0] || (await pctx.newPage())
  const pErrors = []
  ppage.on('pageerror', (e) => pErrors.push(String(e)))

  // B1) 英文噪声文章：Readability 抽取 + 逐行 span + 焦点行 + 字体 + TTS + 摘录
  await bootExtension(ppage, noisyArticle('en'), { guide: true, focusRow: true, clean: true, dyslexic: true, rate: 1 })
  await noHorizontalOverflow(ppage, '英文文章')

  const readerCount = await ppage.locator('#llr-reader').count()
  if (!readerCount) fail.push('纯净阅读：未生成 #llr-reader 阅读容器')
  const readerText = await ppage.locator('#llr-reader').innerText().catch(() => '')
  if (/Noise advertisement|More noise|Footer links/.test(readerText)) fail.push('Readability 抽取未隔离广告/页脚噪声')
  log('Readability 抽取成功，噪声未进阅读视图')

  const lineCount = await ppage.locator('#llr-reader .llr-line').count()
  if (lineCount < 5) fail.push(`逐行 span 数量不足：${lineCount}`)
  const colorInfo = await ppage.$$eval('#llr-reader .llr-line', (els) => {
    const colors = els.map((e) => e.style.color)
    return { unique: [...new Set(colors)], first: colors[0], last: colors[colors.length - 1] }
  })
  if (colorInfo.unique.length < 3) fail.push(`行色未形成冷暖渐变：仅 ${colorInfo.unique.length} 种`)
  if (colorInfo.first === colorInfo.last) fail.push('首行与末行颜色相同，无渐变')
  log(`逐行 span=${lineCount}，行色种类=${colorInfo.unique.length}，首=${colorInfo.first} 末=${colorInfo.last}`)

  const focusOn = await ppage.evaluate(() => document.body.classList.contains('llr-focus'))
  if (!focusOn) fail.push('焦点行模式未开启')
  const activeCount = await ppage.locator('#llr-reader .llr-active').count()
  if (activeCount !== 1) fail.push(`焦点行数量异常：${activeCount}`)
  const dim = await ppage.evaluate(() => {
    const others = [...document.querySelectorAll('#llr-reader .llr-target:not(.llr-active)')]
    return others.length ? getComputedStyle(others[0]).opacity : null
  })
  if (dim === null || Number(dim) > 0.6) fail.push(`非焦点行未减透明：opacity=${dim}`)
  log('焦点行高亮 + 其余行减透明生效')

  const fontApplied = await ppage.evaluate(() => {
    const p = document.querySelector('#llr-reader p')
    return p ? getComputedStyle(p).fontFamily : ''
  })
  if (!/OpenDyslexic/.test(fontApplied)) fail.push(`Dyslexic 字体族未生效：${fontApplied}`)
  log('OpenDyslexic font-family 已应用')

  // TTS mock 状态机
  await ppage.evaluate(() => {
    const calls = { speak: [], pause: [], resume: [], cancel: [] }
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true, writable: true,
      value: {
        speak: (u) => { calls.speak.push(u); window.__currentU = u },
        pause: () => calls.pause.push(Date.now()),
        resume: () => calls.resume.push(Date.now()),
        cancel: () => calls.cancel.push(Date.now()),
        get speaking() { return false }
      }
    })
    window.__ttsCalls = calls
  })
  log('speechSynthesis mock 已安装')
  await ppage.locator('#llr-root .llr-btn[data-k="tts"]').click()
  await ppage.waitForTimeout(200)
  const speakCalls = await ppage.evaluate(() => window.__ttsCalls.speak.length)
  if (!speakCalls) fail.push('TTS 未调用 speechSynthesis.speak')
  const idx0 = await ppage.evaluate(() => window.__llr.tts.idx)
  // 手动触发 onend 推进
  await ppage.evaluate(() => window.__currentU?.onend?.())
  await ppage.waitForTimeout(100)
  const idx1 = await ppage.evaluate(() => window.__llr.tts.idx)
  if (idx1 <= idx0) fail.push('TTS onend 后句索引未前进')
  await ppage.locator('#llr-root .llr-btn[data-k="tts"]').click() // pause
  await ppage.locator('#llr-root .llr-btn[data-k="tts"]').click() // resume
  const paused = await ppage.evaluate(() => window.__ttsCalls.pause.length)
  const resumed = await ppage.evaluate(() => window.__ttsCalls.resume.length)
  if (!paused || !resumed) fail.push('暂停/恢复调用缺失')
  await ppage.locator('#llr-root .llr-btn[data-k="ttsNext"]').click()
  const idx2 = await ppage.evaluate(() => window.__llr.tts.idx)
  if (idx2 <= idx1) fail.push('下一句未推进')
  await ppage.locator('#llr-root .llr-btn[data-k="ttsPrev"]').click()
  const idx3 = await ppage.evaluate(() => window.__llr.tts.idx)
  if (idx3 >= idx2) fail.push('上一句未回退')
  log(`TTS 状态机：speak=${speakCalls} pause=${paused} resume=${resumed} 索引 ${idx0}→${idx1}→${idx2}→${idx3}`)

  // 摘录保存
  await ppage.evaluate(() => {
    const p = document.querySelector('#llr-reader p')
    const range = document.createRange()
    range.selectNodeContents(p)
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(range)
  })
  await ppage.locator('#llr-root .llr-btn[data-k="excerpt"]').click()
  await ppage.waitForTimeout(200)
  const excerptCount = await ppage.evaluate(() => window.__llrStore.llr_excerpts.length)
  if (excerptCount !== 1) fail.push(`摘录未保存：${excerptCount}`)
  const excerpt = await ppage.evaluate(() => window.__llrStore.llr_excerpts[0])
  if (!excerpt.title || !excerpt.url || !excerpt.text) fail.push('摘录缺少标题/URL/正文')
  log('摘录保存成功（标题/URL/正文齐全）')

  await ppage.screenshot({ path: join(SHOT_DIR, 'article-focus.png') })

  // 退出还原
  await ppage.locator('#llr-root .llr-btn[data-k="exit"]').click()
  await ppage.waitForTimeout(150)
  if (await ppage.locator('#llr-root').count()) fail.push('退出后工具条未移除')
  if (await ppage.locator('#llr-reader').count()) fail.push('退出后阅读容器未移除')
  if (await ppage.locator('.llr-line').count()) fail.push('退出后残留行级 span')
  log('退出还原完成，注入节点清空')

  // B2) 回退分支：无正文可抽取 → 不生成阅读容器，保留原页
  await bootExtension(ppage, '<html><body><aside>only sidebar noise</aside></body></html>', { clean: true })
  await ppage.waitForTimeout(200)
  if (await ppage.locator('#llr-reader').count()) fail.push('无正文页面不应生成阅读容器（回退失败）')
  log('Readability 回退分支正确：保留原页仅叠加')

  // B3) 技术文档代码块：复杂元素降级，不破坏代码、零横向
  await bootExtension(ppage, codeDoc, { clean: false, guide: true })
  await ppage.waitForTimeout(200)
  const codeKept = await ppage.locator('pre code').count()
  if (!codeKept) fail.push('代码块被破坏')
  await noHorizontalOverflow(ppage, '技术文档')
  log('代码块保持原样，零横向溢出')

  // B4) 中文长文
  await bootExtension(ppage, noisyArticle('zh'), { clean: true, guide: true })
  const zhLines = await ppage.locator('#llr-reader .llr-line').count()
  if (zhLines < 5) fail.push(`中文文章逐行 span 不足：${zhLines}`)
  const zhSents = await ppage.evaluate(() => window.__llr.tts.sentences.length)
  log(`中文长文行 span=${zhLines}`)

  // 关闭扩展上下文前清理 TTS
  await pctx.close()

  if (pErrors.length) fail.push(`扩展上下文 pageerror: ${pErrors.join('; ')}`)
  await browser.close()

  if (fail.length) {
    console.error('\n❌ E2E 失败：')
    fail.forEach((f) => console.error(' -', f))
    process.exit(1)
  }
  console.log('\n✅ 行光阅读器插件 E2E 全部通过')
}

main().catch((e) => { console.error(e); process.exit(1) })
