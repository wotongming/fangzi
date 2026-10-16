/**
 * e2e-resume-jd-matcher.mjs —— 简历×JD本地匹配器 无头 E2E（M 档）
 *
 * 覆盖（真实 build + preview，全程本地）：
 *  1) 导入 .txt 简历（走 parseResumeFile 文件链）+ 粘贴 JD；
 *  2) 免费用户匹配：综合分/三维雷达/硬门槛（学历·年限·地点）展示、本月免额计数；
 *  3) 专业功能在未解锁时被门控；写入计费 localStorage 模拟买断后：
 *     - 同义词/版本别名（vue3/js/node/cicd）触发“补标准名”可溯源建议；
 *     - 求职信按命中技能+本人要点生成；
 *     - 加入投递看板、状态流转；
 *  4) PC/平板/手机三视口无横向溢出并真实截图。
 * 真实 PDF/DOCX（pdfjs/mammoth）解析在单测层之外，需上线前人工各传一份复核（见 guide FAQ）。
 */
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'

const { chromium } = pw
const CHROMIUM = process.env.CHROMIUM_BIN || '/usr/local/bin/chromium'
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage']

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = resolve(__dirname, '../src/tools/resume-jd-matcher/docs/shots')
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4173'
const URL = `${BASE}/#/t/resume-jd-matcher`
mkdirSync(SHOT_DIR, { recursive: true })

const RESUME = [
  '张三，本科，XX大学 计算机科学与技术，期望城市：上海',
  '5年前端开发经验，先后在两家互联网公司任职',
  '负责公司核心后台系统前端开发，用 vue3 和 js 独立完成多个业务模块，熟悉 node 与 docker',
  '参与搭建 cicd 流水线，推动前端性能优化，首屏提速 40%',
  '具备良好的沟通能力与团队协作'
].join('\n')

const JD = [
  '高级前端工程师　工作地点：上海',
  '任职要求：',
  '1. 本科及以上学历',
  '2. 3年以上前端开发经验',
  '3. 熟练 JavaScript、Vue、Node.js，了解 Docker、CI/CD',
  '4. 具备良好的沟通能力和团队协作',
  '岗位职责：',
  '负责 Web 应用前端开发与性能优化，参与组件库建设'
].join('\n')

async function newCtx(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}

async function assertNoOverflow(page, label) {
  const dims = await page.evaluate(() => ({
    de: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    db: document.body.scrollWidth - window.innerWidth
  }))
  if (dims.de > 2 || dims.db > 2) throw new Error(`[${label}] 横向溢出 de=${dims.de} db=${dims.db}`)
}

async function fillResumeAndJd(page) {
  // 1) txt 文件导入简历
  await page.locator('.file-btn input[type=file]').setInputFiles({
    name: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(RESUME, 'utf8')
  })
  await page.waitForFunction(() => {
    const t = document.querySelectorAll('textarea')[0]
    return t && t.value.includes('vue3')
  })
  // 2) 切到匹配诊断，填 JD
  await page.getByRole('button', { name: '匹配诊断', exact: true }).click()
  await page.getByPlaceholder('公司名称（选填）').fill('字节跳动')
  await page.getByPlaceholder('岗位名称（选填）').fill('高级前端工程师')
  await page.getByPlaceholder('粘贴招聘 JD 原文（含岗位职责、任职要求、学历/年限/地点/证书要求）').fill(JD)
}

async function shot(page, name) {
  const p = resolve(SHOT_DIR, name)
  await page.screenshot({ path: p, fullPage: true })
  const st = statSync(p)
  if (st.size < 8000) throw new Error(`截图 ${name} 仅 ${st.size} 字节，疑似空白`)
  console.log('  shot', name, st.size)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
  let failures = 0
  const ok = (cond, msg) => {
    if (!cond) { failures++; console.error('  ✗', msg) } else console.log('  ✓', msg)
  }

  // ---------- PC：免费匹配 -> 买断 -> 建议/求职信/看板 ----------
  const vpPC = { width: 1280, height: 900 }
  const ctx = await newCtx(browser, vpPC)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })

  await fillResumeAndJd(page)
  await shot(page, 'pc-1-resume-import.png')

  await page.getByRole('button', { name: '开始本地匹配' }).click()
  await page.waitForSelector('.result .score')
  const scoreTxt = await page.locator('.result .score').textContent()
  const score = Number((scoreTxt || '').trim())
  ok(!Number.isNaN(score) && score > 0, `免费匹配出分（score=${score}）`)

  // 三维雷达渲染
  ok((await page.locator('.radar polygon').count()) >= 1, '三维雷达 SVG 渲染')
  // 硬门槛：学历/年限/地点都应通过
  const gates = await page.locator('.gate-item').allInnerTexts()
  ok(gates.length >= 3 && gates.every((g) => g.includes('✓')), '学历/年限/地点硬门槛均通过')
  // 命中技能含 Vue（同义词也算能力匹配）
  const dimText = await page.locator('.result').innerText()
  ok(/技能匹配[\s\S]*Vue/.test(dimText), '技能命中列出 Vue')
  // 免费额度计数
  const usedLine = await page.locator('.tabs + section, section').first().innerText().catch(() => '')
  await shot(page, 'pc-2-match-result.png')

  // 专业功能门控（未解锁）
  ok((await page.getByText('可溯源改写建议为专业功能').count()) === 1, '改写建议未解锁时被门控')

  // 模拟买断：写计费存储后重载
  await page.evaluate(() => {
    localStorage.setItem(
      'fangzi:billing:v1',
      JSON.stringify({
        orders: [
          {
            id: 'ord_test_buy', toolId: 'resume-jd-matcher', kind: 'freemium-pro',
            amountCents: 4990, currency: 'CNY', status: 'paid', provider: 'local-mock',
            createdAt: new Date().toISOString()
          }
        ],
        usage: {}
      })
    )
  })
  await page.reload({ waitUntil: 'networkidle' })
  await fillResumeAndJd(page)
  await page.getByRole('button', { name: '开始本地匹配' }).click()
  await page.waitForSelector('.result .score')

  // 解锁后：同义词显式命名建议
  await page.waitForSelector('.sug-item')
  const sugText = await page.locator('.suggest').innerText()
  ok(/Vue/.test(sugText) && /标准名/.test(sugText), 'vue3 触发补标准名 Vue 的可溯源建议')
  ok(/JavaScript/.test(sugText), 'js 触发补标准名 JavaScript 建议')
  ok(sugText.includes('vue3'), '建议带来源原文别名（可溯源）')
  await shot(page, 'pc-3-suggestions.png')

  // 求职信：生成中文 + 切英文
  await page.getByRole('button', { name: '去写求职信 →' }).click()
  await page.getByRole('button', { name: '根据匹配结果生成' }).click()
  let cover = ''
  await page.waitForFunction(() => {
    const tas = document.querySelectorAll('textarea')
    return tas.length && tas[tas.length - 1].value.includes('字节跳动')
  })
  cover = await page.locator('textarea').last().inputValue()
  ok(cover.includes('高级前端工程师') && /Vue|JavaScript/.test(cover), '中文求职信含岗位与命中技能')
  await page.locator('select').last().selectOption('en')
  await page.getByRole('button', { name: '根据匹配结果生成' }).click()
  await page.waitForFunction(() => {
    const tas = document.querySelectorAll('textarea')
    return tas.length && /Dear Hiring Team/i.test(tas[tas.length - 1].value)
  })
  const coverEn = await page.locator('textarea').last().inputValue()
  ok(/Dear Hiring Team/i.test(coverEn) && /Vue|JavaScript/.test(coverEn), '英文求职信生成（含英文问候与命中技能）')
  await shot(page, 'pc-4-cover-letter.png')

  // 回到匹配页加入看板并流转状态
  await page.getByRole('button', { name: '匹配诊断', exact: true }).click()
  await page.waitForSelector('.result .score')
  await page.getByRole('button', { name: '加入投递看板' }).click()
  await page.waitForSelector('.board li')
  ok((await page.locator('.board li').count()) === 1, '看板出现 1 条投递记录')
  await page.locator('.board li select').first().selectOption('interview')
  await page.waitForTimeout(300)
  ok((await page.locator('.board li select').first().inputValue()) === 'interview', '状态流转为面试中并持久化')
  await shot(page, 'pc-5-board.png')
  await assertNoOverflow(page, 'PC')

  // ---------- 平板 ----------
  const ctxT = await newCtx(browser, { width: 834, height: 1112 })
  const tp = await ctxT.newPage()
  await tp.goto(URL, { waitUntil: 'networkidle' })
  await fillResumeAndJd(tp)
  await tp.getByRole('button', { name: '开始本地匹配' }).click()
  await tp.waitForSelector('.result .score')
  await assertNoOverflow(tp, '平板')
  await shot(tp, 'tablet-1-match.png')

  // ---------- 手机 ----------
  const ctxM = await newCtx(browser, { width: 375, height: 812 })
  const mp = await ctxM.newPage()
  await mp.goto(URL, { waitUntil: 'networkidle' })
  await fillResumeAndJd(mp)
  await mp.getByRole('button', { name: '开始本地匹配' }).click()
  await mp.waitForSelector('.result .score')
  await assertNoOverflow(mp, '手机')
  await shot(mp, 'mobile-1-match.png')

  await browser.close()
  if (failures) { console.error(`\nE2E 失败 ${failures} 项`); process.exit(1) }
  console.log('\n✅ resume-jd-matcher E2E 全部通过（PC/平板/手机）')
}

run().catch((e) => { console.error(e); process.exit(1) })
