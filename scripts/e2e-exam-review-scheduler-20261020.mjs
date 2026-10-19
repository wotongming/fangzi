/**
 * 2026-10-20 exam-review-scheduler 三视口 E2E（M 档）。
 *  覆盖：建项目 → 录 2 题（含标签 + 拍照附件）→ IDB 注入到期（不改系统时间）→
 *       队列出现 → 「已忘」重置 1 天 / 「记得」间隔跳到 60 天 → 弱项红块 →
 *       录 2 次模考出曲线与目标虚线 → 免费层第 2 项目 / 第 51 题被拦、买断后解锁 →
 *       三视口零横向溢出 + 真实截图。
 *  运行前：npm run build && npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makePng } from './gen-test-png.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/exam-review-scheduler/docs/shots')
const TMPIMG = join(ROOT, 'tmp-test-data', 'exam-photo.png')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })
mkdirSync(dirname(TMPIMG), { recursive: true })
writeFileSync(TMPIMG, makePng(400, 300, [70, 130, 200]))

const fail = []
const log = (...a) => console.log('[e2e-exam]', ...a)
function assert(cond, msg) {
  if (!cond) fail.push(msg)
  else log('ok -', msg)
}

function seedPro() {
  localStorage.setItem(
    'fangzi:billing:v1',
    JSON.stringify({
      orders: [
        { id: 'ord_e2e_ers_pro', toolId: 'exam-review-scheduler', kind: 'freemium-pro', amountCents: 890, currency: 'CNY', status: 'paid', createdAt: new Date().toISOString() }
      ],
      usage: {}
    })
  )
}

async function newCtx(browser, viewport, withPro) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  if (withPro) await ctx.addInitScript(seedPro)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fail.push(`pageerror: ${e.message}`))
  return { ctx, page }
}

async function overflow(page, label) {
  const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  if (d.sw - d.cw > 2) fail.push(`${label} 横向溢出 ${d.sw - d.cw}px`)
  else log(`overflow[${label}] ok (${d.sw}/${d.cw})`)
}

async function createProject(page, name) {
  await page.getByRole('button', { name: '建立第一个考试项目' }).click()
  await page.locator('.modal input[type="text"]').fill(name)
  await page.locator('.modal input[type="date"]').fill('2026-12-31')
  await page.getByRole('button', { name: '建立项目' }).click()
  await page.waitForSelector('.proj-chip', { timeout: 5000 })
}

async function addQuestion(page, stem, point, withPhoto) {
  await page.locator('.seg button', { hasText: '错题本' }).click()
  await page.getByRole('button', { name: '录错题' }).click()
  await page.locator('.modal textarea').nth(0).fill(stem)
  const inputs = page.locator('.modal .grid3 input')
  await inputs.nth(0).fill('会计')
  await inputs.nth(1).fill('总论')
  await inputs.nth(2).fill(point)
  if (withPhoto) await page.locator('.modal input[type="file"]').setInputFiles(TMPIMG)
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: '保存错题' }).click()
  await page.waitForTimeout(400)
}

/** 把全部题 nextReview 置为今天（到期），并给第二题预置 reps=4 的已掌握状态。 */
function seedDueScript() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fangzi-exam-review', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('questions', 'readwrite')
      const store = tx.objectStore('questions')
      const getAll = store.getAll()
      getAll.onsuccess = () => {
        const qs = getAll.result
        const t = new Date()
        const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
        qs.forEach((q, i) => {
          q.nextReview = iso
          if (i === 1) {
            q.ease = 3.1
            q.intervalDays = 7
            q.reps = 4
          }
          store.put(q)
        })
        tx.oncomplete = () => resolve(qs.map((q) => q.id))
      }
      getAll.onerror = () => reject(getAll.error)
    }
    req.onerror = () => reject(req.error)
  })
}

/** 给第一题追加 2 条 grade=1 复习记录，使「存货」正确率 <50% 变红。 */
function injectWrongReviews(q1Id) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fangzi-exam-review', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('reviews', 'readwrite')
      const store = tx.objectStore('reviews')
      for (let i = 0; i < 2; i++) {
        store.put({ id: `rv_e2e_${Date.now()}_${i}`, questionId: q1Id, ts: Date.now() - i * 1000, grade: 1, intervalAfter: 1 })
      }
      tx.oncomplete = () => resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

function readQuestion(id) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fangzi-exam-review', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('questions', 'readonly')
      const g = tx.objectStore('questions').get(id)
      g.onsuccess = () => resolve(g.result)
      g.onerror = () => reject(g.error)
    }
    req.onerror = () => reject(req.error)
  })
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

/* ============ 专业版全流程（手机 375×812） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, true)
  await page.goto(`${ORIGIN}/#/t/exam-review-scheduler`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  log('空态 ok')
  await createProject(page, 'CPA-会计')
  await overflow(page, 'mobile-project')

  // 录 2 题（第二题带拍照附件）
  await addQuestion(page, '存货计价方法有哪些？', '存货', false)
  await addQuestion(page, '固定资产折旧年限', '折旧', true)
  let qCount = await page.locator('.q-item').count()
  assert(qCount === 2, `录入 2 道错题（实际 ${qCount}）`)

  // 注入到期（不改系统时间）
  await page.evaluate(seedDueScript)
  await page.reload()
  await page.waitForSelector('.proj-chip')
  await page.locator('.seg button', { hasText: '今日' }).click()
  await page.waitForSelector('.due-item', { timeout: 5000 })
  const dueCount = await page.locator('.due-item').count()
  assert(dueCount === 2, `今日队列出现 2 道到期题（实际 ${dueCount}）`)

  // 读两道题 id（按 createdAt 顺序）
  const qids = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('fangzi-exam-review', 1)
    r.onsuccess = () => {
      const g = r.result.transaction('questions').objectStore('questions').getAll()
      g.onsuccess = () => res(g.result.sort((a, b) => a.createdAt - b.createdAt).map((q) => q.id))
      g.onerror = () => rej(g.error)
    }
  }))

  // 第一题「已忘」→ 重置为 1 天
  await page.locator('.due-item').nth(0).locator('.rate.forgot').click()
  await page.waitForTimeout(400)
  const q1 = await page.evaluate(readQuestion, qids[0])
  assert(q1.reps === 0 && q1.intervalDays === 1, `已忘：reps 归零、间隔重置为 1 天（reps=${q1.reps}, interval=${q1.intervalDays}）`)

  // 第二题「记得」（预置 reps=4, ease=3.1）→ reps=5, interval=round(15*3.1*1.3)=60
  await page.waitForTimeout(600)
  const due2 = page.locator('.due-item', { hasText: '固定资产折旧年限' })
  await due2.locator('.rate.good').click()
  await page.waitForTimeout(600)
  const q2 = await page.evaluate(readQuestion, qids[1])
  assert(q2.reps === 5 && q2.intervalDays === 60, `记得：间隔递进为 60 天（reps=${q2.reps}, interval=${q2.intervalDays}）`)

  // 注入额外错题记录 → 弱项红块（注入后需 reload 让 Vue 重新加载 reviews）
  await page.evaluate(injectWrongReviews, qids[0])
  await page.reload()
  await page.waitForSelector('.proj-chip')
  await page.locator('.seg button', { hasText: '弱项' }).click()
  await page.waitForSelector('.weak-cell', { timeout: 5000 })
  const redCount = await page.locator('.weak-cell.lv-red').count()
  assert(redCount >= 1, `弱项热力图出现红色薄弱考点（红块 ${redCount} 个）`)
  await overflow(page, 'mobile-weak')
  await page.screenshot({ path: join(SHOTS, 'shot-06-mobile-weak.png'), fullPage: true })

  // 模考：录 2 次 → 出曲线与目标虚线
  await page.locator('.seg button', { hasText: '模考' }).click()
  await page.locator('.grid2 input').nth(1).fill('会计')
  await page.locator('.grid2 input').nth(2).fill('55')
  await page.getByRole('button', { name: '保存模考成绩' }).click()
  await page.waitForTimeout(300)
  await page.locator('.grid2 input').nth(1).fill('会计')
  await page.locator('.grid2 input').nth(2).fill('78')
  await page.getByRole('button', { name: '保存模考成绩' }).click()
  await page.waitForTimeout(400)
  const chartExists = await page.locator('svg.chart').count()
  assert(chartExists === 1, `模考曲线 SVG 渲染（${chartExists}）`)
  const dashLines = await page.locator('svg.chart line[stroke-dasharray]').count()
  assert(dashLines >= 1, `目标分水平虚线渲染（${dashLines}）`)
  const decLines = await page.locator('.dec-line').count()
  assert(decLines >= 2, `决策看板文案 + 免责（${decLines} 行）`)
  await overflow(page, 'mobile-exam')
  await page.screenshot({ path: join(SHOTS, 'shot-05-mobile-exam.png'), fullPage: true })

  // 队列/错题本截图
  await page.locator('.seg button', { hasText: '错题本' }).click()
  await page.waitForSelector('.q-item')
  await overflow(page, 'mobile-book')
  await page.screenshot({ path: join(SHOTS, 'shot-07-mobile-book.png'), fullPage: true })

  await ctx.close()
}

/* ============ 免费层拦截（手机，不 seed 专业版） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, false)
  await page.goto(`${ORIGIN}/#/t/exam-review-scheduler`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  await createProject(page, '在职研-数学')

  // 第 2 个项目被拦
  await page.getByRole('button', { name: /新项目/ }).click()
  await page.waitForTimeout(300)
  const h3 = await page.locator('.modal h3').innerText().catch(() => '')
  assert(/专业版/.test(h3), `免费层第 2 个项目弹专业版门（实际：${h3}）`)
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.modal-mask').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.waitForTimeout(200)

  // 录 1 题后，IDB 灌到 50 题 → 第 51 题被拦
  await addQuestion(page, '极限计算', '极限', false)
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('fangzi-exam-review', 1)
    r.onsuccess = () => {
      const db = r.result
      const tx = db.transaction('questions', 'readwrite')
      const store = tx.objectStore('questions')
      for (let i = 0; i < 49; i++) {
        store.put({ id: `q_flood_${i}`, projectId: 'x', stem: 'flood', wrongCause: '', answer: '', source: '', pointPath: { subject: 's', chapter: 'c', point: 'p' }, ease: 2.5, intervalDays: 1, reps: 0, nextReview: '2099-01-01', createdAt: Date.now() + i })
      }
      tx.oncomplete = () => res()
    }
    r.onerror = () => rej(r.error)
  }))
  await page.reload()
  await page.waitForSelector('.proj-chip')
  await page.locator('.seg button', { hasText: '错题本' }).click()
  await page.getByRole('button', { name: '录错题' }).click()
  await page.waitForTimeout(300)
  const h3b = await page.locator('.modal h3').innerText().catch(() => '')
  assert(/专业版/.test(h3b), `免费层第 51 道题弹专业版门（实际：${h3b}）`)
  await overflow(page, 'mobile-free')
  await ctx.close()
}

/* ============ 平板 / PC（专业版，主视图 + 自适应） ============ */
for (const [label, vp] of [
  ['tablet', { width: 834, height: 1112 }],
  ['pc', { width: 1280, height: 860 }]
]) {
  const { ctx, page } = await newCtx(browser, vp, true)
  await page.goto(`${ORIGIN}/#/t/exam-review-scheduler`)
  await page.waitForSelector('.empty', { timeout: 15000 })
  await createProject(page, '法考-民法')
  await addQuestion(page, '善意取得的构成要件', '善意取得', false)
  await overflow(page, `${label}-book`)
  await page.locator('.seg button', { hasText: '今日' }).click()
  await overflow(page, `${label}-queue`)
  await page.screenshot({ path: join(SHOTS, `shot-04-${label}.png`), fullPage: true })
  await ctx.close()
}

if (fail.length) {
  console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
  process.exit(1)
}
log('\n✅ exam-review-scheduler 全部 E2E 通过（三视口零溢出）')
await browser.close()
