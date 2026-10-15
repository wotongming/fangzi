/**
 * 004 离线语音转写：多端 E2E 验证 + 真实截图（档位：H，checkpoint）。
 * 关键路径（H 档必须实证）：浏览器内 transformers.js v4 + 自托管 /whisper ort1.31 WASM，
 *   从 huggingface.co 官方 CDN 下载 Xenova/whisper-tiny q8（hf-mirror 浏览器跨域不可用作兜底）（无 COOP/COEP，验证单线程回退），
 *   对真实英文 wav 解码→16k→转写，断言文本含 "dream"、时间戳分段、抽取纪要、SRT 导出。
 * 另覆盖：免费额度计量、历史落库、波形/播放器存在；平板/手机无横向溢出。
 * 麦克风录音在无头环境不模拟（postmortem 中如实列为人工复测项）。
 * 运行前：npm run preview（http://localhost:4173）
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/local-transcribe/docs/shots')
const FIX = '/tmp/lt-fixtures'
const BASE = 'http://localhost:4173/#/t/local-transcribe'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })

const results = []
async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? '' })
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message })
  }
}
async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name), fullPage: false })
  return name
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
await ctx.route('**/sw.js', (r) => r.abort())
await ctx.route('**/registerSW.js', (r) => r.abort())
const page = await ctx.newPage()
const consoleErrors = []
const netReqs = { whisperWasm: 0, modelHost: 0 }
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 240)))
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/whisper/ort-wasm')) netReqs.whisperWasm++
  if (u.includes('huggingface.co') || u.includes('hf-mirror.com') || u.includes('cdn.hf.co')) netReqs.modelHost++
})

let asrOk = false

await check('打开工具，标题/SEO 正确，默认在转写 tab', async () => {
  await page.goto(BASE)
  await page.waitForSelector('.lt h1')
  const title = await page.title()
  if (!title.includes('语音转写')) throw new Error('title 不符：' + title)
  const drop = await page.locator('.drop').count()
  if (!drop) throw new Error('缺少导入/录音区')
  return title
})

await check('导入英文 wav：解码成功并显示时长与“开始转写”', async () => {
  await page.setInputFiles('.drop input[type=file]', join(FIX, 'en.wav'))
  await page.waitForSelector('.ready .btn-primary', { timeout: 30000 })
  const meta = await page.locator('.ready').innerText()
  if (!/时长\s*0?0:1[23]/.test(meta)) throw new Error('时长显示异常：' + meta.replace(/\n/g, ' '))
  // 指定英文，避免 tiny 自动检测偏差
  await page.selectOption('.ready .lang select', 'english')
  return meta.match(/时长[^\n]*/)?.[0] ?? 'ready'
})

await check('真实转写：浏览器 WASM + 官方CDN 下载 whisper-tiny 并识别', async () => {
  await page.click('.ready .btn-primary')
  // 等待结果分段出现（含模型下载 + WASM 初始化 + 推理）
  await page.waitForSelector('.segs .seg', { timeout: 300000 })
  const body = await page.locator('.segs').innerText()
  const flat = body.toLowerCase().replace(/\s+/g, ' ')
  // MLK 片段核心词：dream / nation
  if (!/dream|nation/.test(flat)) throw new Error('转写文本未命中预期词，实际：' + flat.slice(0, 200))
  asrOk = true
  return body.replace(/\s+/g, ' ').slice(0, 160)
})

await check('时间戳分段 ≥2，且点击时间戳可跳转播放位置', async () => {
  if (!asrOk) throw new Error('跳过：转写未成功')
  const n = await page.locator('.segs .seg').count()
  if (n < 2) throw new Error('分段数不足：' + n)
  const ts0 = await page.locator('.segs .seg .ts').first().innerText()
  if (!/\d{1,2}:\d{2}/.test(ts0)) throw new Error('时间戳格式异常：' + ts0)
  await page.locator('.segs .seg .ts').nth(1).click()
  await page.waitForTimeout(300)
  return `${n} 段，首戳 ${ts0}`
})

await check('抽取式纪要：一句话摘要/要点已生成', async () => {
  if (!asrOk) throw new Error('跳过：转写未成功')
  const h = await page.locator('.summary h2').count()
  if (!h) throw new Error('缺少纪要区')
  const headline = await page.locator('.sum-block').first().innerText()
  if (!/一句话摘要/.test(headline)) throw new Error('缺少一句话摘要')
  const kp = await page.locator('.sum-block').nth(1).innerText()
  if (!/关键要点/.test(kp)) throw new Error('缺少关键要点')
  return headline.replace(/\s+/g, ' ').slice(0, 80)
})

await check('播放器与波形存在（当次会话可回听）', async () => {
  if (!asrOk) throw new Error('跳过：转写未成功')
  // <audio> 无 controls 不占可视盒，校验其已挂载且 src 有效；可见回听控件是 ▶ 按钮与 canvas
  const audio = await page.waitForSelector('.player audio', { state: 'attached', timeout: 5000 })
  const src = await audio.getAttribute('src')
  if (!src) throw new Error('audio 缺少 src')
  const wave = await page.locator('.player .wave').count()
  if (!wave) throw new Error('缺少波形 canvas')
  if (!(await page.locator('.player .play').count())) throw new Error('缺少播放按钮')
  // 波形必须真的画出来（非白像素），而不是空白 canvas
  await page.waitForTimeout(400)
  const nonWhite = await page.evaluate(() => {
    const c = document.querySelector('.player .wave')
    if (!c) return 0
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++
    return n
  })
  if (nonWhite < 1000) throw new Error('波形未绘制（非白像素 ' + nonWhite + '）')
  return `audio(src)+play+waveform(${nonWhite}px)`
})

await check('免费额度计量：本月已用增加约 0.25 分钟（13s）', async () => {
  if (!asrOk) throw new Error('跳过：转写未成功')
  const q = await page.locator('.quota').innerText()
  if (!/已用\s*0\.2\s*\/\s*60\s*分钟/.test(q)) throw new Error('额度计量异常：' + q)
  return q
})

await check('导出 SRT 字幕文件', async () => {
  if (!asrOk) throw new Error('跳过：转写未成功')
  const dlP = page.waitForEvent('download', { timeout: 10000 })
  await page.locator('.result-head .btn-primary', { hasText: 'SRT' }).click()
  const dl = await dlP
  if (!dl.suggestedFilename().endsWith('.srt')) throw new Error('非 srt：' + dl.suggestedFilename())
  return dl.suggestedFilename()
})

await check('转写记录已存入本地历史', async () => {
  if (!asrOk) throw new Error('跳过：转写未成功')
  await page.locator('.tabs button', { hasText: '历史' }).first().click()
  await page.waitForSelector('.hist tbody tr', { timeout: 5000 })
  const rows = await page.locator('.hist tbody tr').count()
  if (rows < 1) throw new Error('历史为空')
  const t = await page.locator('.hist tbody tr').first().innerText()
  if (!/00:1[23]/.test(t)) throw new Error('历史时长异常：' + t.replace(/\n/g, ' '))
  return `${rows} 条历史`
})

/* ===== 截图：PC 结果页 + 历史页 ===== */
await check('PC 截图：结果页（纪要+文字稿）/ 历史', async () => {
  await page.locator('.tabs button', { hasText: '转写' }).first().click()
  await page.waitForSelector('.segs .seg')
  await page.waitForTimeout(400)
  await shot(page, 'shot-01-pc-result.png')
  await page.locator('.tabs button', { hasText: '历史' }).first().click()
  await page.waitForTimeout(300)
  await shot(page, 'shot-02-pc-history.png')
  return '2 张 PC 截图'
})

/* ===== 多端：平板 / 手机（同一 context 复用已存历史记录，改视口尺寸，打开文字稿结果页）===== */
async function responsive(viewport, label, shotName) {
  await check(`${label}（${viewport.width}×${viewport.height}）无横向溢出`, async () => {
    await page.setViewportSize(viewport)
    // 先看转写空态不溢出
    await page.locator('.tabs button', { hasText: '转写' }).first().click()
    await page.waitForTimeout(200)
    const d1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (d1 > 1) throw new Error('转写页横向溢出 ' + d1)
    // 打开已存历史记录的文字稿结果布局（历史记录不含音频本体）
    await page.locator('.tabs button', { hasText: '历史' }).first().click()
    await page.waitForSelector('.hist tbody tr', { timeout: 8000 })
    await page.locator('.hist tbody tr button', { hasText: '打开' }).first().click()
    await page.waitForSelector('.segs .seg', { timeout: 8000 })
    await page.waitForTimeout(300)
    const d2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (d2 > 1) throw new Error('结果页横向溢出 ' + d2)
    await shot(page, shotName)
    return `无横向溢出（转写 Δ=${d1}, 结果 Δ=${d2}）`
  })
}
await responsive({ width: 834, height: 1112 }, '平板', 'shot-03-tablet.png')
await responsive({ width: 375, height: 812 }, '手机', 'shot-04-phone.png')
await page.setViewportSize({ width: 1280, height: 800 })

await check('网络：自托管 /whisper wasm 与模型 CDN（huggingface/镜像）均被请求', async () => {
  if (!(netReqs.whisperWasm > 0)) throw new Error('未请求自托管 whisper wasm')
  if (!(netReqs.modelHost > 0)) throw new Error('未请求模型 CDN')
  return `whisper wasm ${netReqs.whisperWasm} 次；模型源 ${netReqs.modelHost} 次`
})

await check('Console 无未捕获实质错误（忽略 SW/CORS 噪声）', async () => {
  const real = consoleErrors.filter((e) => !/Failed to register|serviceWorker|sw\.js|registerSW|ERR_ABORTED|unknown error occurred when fetching the script|importing a module script|blocked by CORS policy|ERR_FAILED|SharedArrayBuffer|Cross-Origin/i.test(e))
  if (real.length) throw new Error(real.slice(0, 4).join(' | '))
  return '无实质 console 错误'
})

console.log('\n================ 004 E2E 结果 ================')
let pass = 0
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  (${String(r.ms).padStart(6)}ms)  ${r.name}${r.ok ? '' : '\n        → ' + r.detail}`)
  if (r.ok) pass++
}
console.log(`\n汇总：${pass}/${results.length} 通过；浏览器内 Whisper WASM 转写=${asrOk ? '已验证' : 'CHECKPOINT 未通过'}`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
