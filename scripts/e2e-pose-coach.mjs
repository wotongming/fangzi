/**
 * e2e-pose-coach.mjs —— 居家健身纠错教练无头 E2E
 *
 * 无头环境无真实摄像头/GPU：经页面自检接缝 window.__fzPoseInject 注入合成 33 点
 * 关键点（跳过摄像头与 MediaPipe 模型），驱动真实 CoachEngine+FSM+平滑+叠加+落库链路。
 * 覆盖：深蹲 2 次计数/HUD/IndexedDB 落库/买断解锁/Canvas2D 骨架截图/PC·平板·手机无横向溢出/
 * 自检模式不发起模型网络请求（隐私不出端）。
 *
 * 真机 MediaPipe GPU、真实摄像头与语音播报须上线前人工复测（见 guide）。
 */
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'

const { chromium } = pw
const CHROMIUM = process.env.CHROMIUM_BIN || '/usr/local/bin/chromium'
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage']
async function launch() {
  return chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
}
// 强制兼容路径并 abort SW，确保加载当前构建产物（本工具叠加为 Canvas2D，无头稳定可截）
async function newCompatContext(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true })
    } catch { /* ignore */ }
  })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = resolve(__dirname, '../src/tools/pose-fitness-coach/docs/shots')
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4173'
const URL = `${BASE}/#/t/pose-fitness-coach`
mkdirSync(SHOT_DIR, { recursive: true })

// 与 test/pose-exercises.test.ts 中深蹲底部/站立一致的合成坐标（侧面，左右同高）
function buildPose(kind) {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }))
  const set = (i, x, y, v = 0.97) => {
    p[i] = { x, y, z: 0, visibility: v }
    p[i + 1] = { x: x + 0.18, y, z: 0, visibility: v } // 右侧
  }
  // 鼻子/眼睛占位
  p[0] = { x: 0.42, y: 0.2, z: 0, visibility: 0.9 }
  if (kind === 'stand') {
    set(11, 0.42, 0.3) // 肩
    set(13, 0.34, 0.42) // 肘
    set(15, 0.3, 0.52) // 腕
    set(23, 0.42, 0.46) // 髋
    set(25, 0.41, 0.68) // 膝
    set(27, 0.4, 0.9) // 踝
  } else {
    // bottom：髋-膝-踝 ≈70°，过深蹲 deep 阈值
    set(11, 0.42, 0.36)
    set(13, 0.34, 0.5)
    set(15, 0.3, 0.58)
    set(23, 0.36, 0.62)
    set(25, 0.5, 0.62)
    set(27, 0.4, 0.9)
  }
  return p
}

// 注入深蹲序列：站(24)→底(26)→站(26)→底(26)→站(30)，共 2 次
const INJECT_SCRIPT = `
window.__squatFrame = 0;
window.__squatPhase = (f) => {
  if (f < 24) return 'stand';
  if (f < 50) return 'bottom';
  if (f < 76) return 'stand';
  if (f < 102) return 'bottom';
  return 'stand';
};
window.__fzPoseInject = () => {
  const kind = window.__squatPhase(window.__squatFrame);
  if (window.__squatFrame < 200) window.__squatFrame += 1;
  return ${buildPose.toString()} (kind);
};
`

const results = []
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

async function waitNum(page, want, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const n = await page.locator('.hud .num').first().textContent().catch(() => null)
    if ((n || '').trim() === String(want)) return true
    await page.waitForTimeout(150)
  }
  return false
}

async function noOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement
    return de.scrollWidth - de.clientWidth <= 2 && document.body.scrollWidth - window.innerWidth <= 2
  })
}

const browser = await launch()

try {
  // ---------- PC：深蹲计数 → HUD → 落库 ----------
  const ctx = await newCompatContext(browser, { width: 1280, height: 900 })
  const page = await ctx.newPage()
  const modelHits = []
  page.on('request', (r) => {
    const u = r.url()
    if (/storage\.googleapis\.com|vision_wasm_internal\.(wasm|js)|pose_landmarker/i.test(u)) modelHits.push(u)
  })
  const consoleErrs = []
  page.on('pageerror', (e) => consoleErrs.push(String(e)))

  await page.addInitScript(INJECT_SCRIPT)
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.ex-pick', { timeout: 8000 })
  check('PC 无横向溢出（空闲页）', await noOverflow(page))

  // 默认选中深蹲（免费），开始
  await page.locator('.ex-btn', { hasText: '深蹲' }).click()
  await page.getByRole('button', { name: /开始跟练/ }).click()
  await page.waitForSelector('.hud', { timeout: 8000 })

  const counted2 = await waitNum(page, 2)
  check('深蹲合成 2 次往返计数=2（HUD）', counted2)
  check('自检模式未发起模型/wasm 网络请求（隐私不出端）', modelHits.length === 0, `${modelHits.length} 个`)

  // 骨架叠加截图（Canvas2D，无头可截）
  await page.waitForTimeout(500)
  const pcShot = `${SHOT_DIR}/pc-squat-running.png`
  await page.locator('.stage').screenshot({ path: pcShot })
  const st = statSync(pcShot)
  check('PC 运行态骨架截图有效', st.size > 20000, `${st.size}B`)

  // 结束并保存 → 历史
  await page.getByRole('button', { name: /结束并保存/ }).click()
  await page.locator('.tabs button', { hasText: '历史趋势' }).click()
  await page.waitForTimeout(600)
  const hist = await page.locator('.history li').first().textContent().catch(() => '')
  check('训练记录已落 IndexedDB 并显示（深蹲·2）', /深蹲/.test(hist) && /\b2\b/.test(hist), hist.replace(/\s+/g, ' ').trim().slice(0, 40))

  // 计划/设置 Tab 无报错
  await page.locator('.tabs button', { hasText: '设置' }).click()
  await page.waitForTimeout(200)
  check('页面无未捕获 JS 异常', consoleErrs.length === 0, consoleErrs.slice(0, 2).join(' | '))
  await ctx.close()

  // ---------- PC：买断解锁（Pro 动作门控 → 购买后出现开始按钮） ----------
  const ctx2 = await newCompatContext(browser, { width: 1280, height: 900 })
  const p2 = await ctx2.newPage()
  await p2.goto(URL, { waitUntil: 'networkidle' })
  await p2.waitForSelector('.ex-pick')
  await p2.locator('.ex-btn', { hasText: '弓步蹲' }).click()
  const gateVisible = await p2.locator('.gate', { hasText: '专业动作' }).isVisible()
  check('Pro 动作（弓步蹲）默认显示购买门控', gateVisible)
  await p2.locator('.gate .btn-primary', { hasText: /升级专业版/ }).click()
  await p2.waitForTimeout(500)
  const startAfterBuy = await p2.getByRole('button', { name: /开始跟练/ }).isVisible()
  check('买断后门控消失、可开始跟练（解锁生效）', startAfterBuy)
  await ctx2.close()

  // ---------- 平板 ----------
  const tctx = await newCompatContext(browser, { width: 834, height: 1112 })
  const tp = await tctx.newPage()
  await tp.addInitScript(INJECT_SCRIPT)
  await tp.goto(URL, { waitUntil: 'networkidle' })
  await tp.waitForSelector('.ex-pick')
  check('平板无横向溢出', await noOverflow(tp))
  await tp.locator('.ex-btn', { hasText: '深蹲' }).click()
  await tp.getByRole('button', { name: /开始跟练/ }).click()
  await tp.waitForSelector('.hud', { timeout: 8000 })
  await waitNum(tp, 2)
  await tp.waitForTimeout(400)
  const tabShot = `${SHOT_DIR}/tablet-squat.png`
  await tp.screenshot({ path: tabShot })
  check('平板运行态截图有效', statSync(tabShot).size > 20000, `${statSync(tabShot).size}B`)
  await tctx.close()

  // ---------- 手机 ----------
  const mctx = await newCompatContext(browser, { width: 375, height: 812 })
  const mp = await mctx.newPage()
  await mp.goto(URL, { waitUntil: 'networkidle' })
  await mp.waitForSelector('.ex-pick')
  check('手机无横向溢出', await noOverflow(mp))
  const mobShot = `${SHOT_DIR}/mobile-idle.png`
  await mp.screenshot({ path: mobShot })
  check('手机空闲页截图有效', statSync(mobShot).size > 10000, `${statSync(mobShot).size}B`)
  // 手机选 Pro 动作门控可点（窄屏不遮挡）
  await mp.locator('.ex-btn', { hasText: '臀桥' }).click()
  check('手机 Pro 门控按钮可见可点', await mp.locator('.gate .btn-primary').isVisible())
  await mctx.close()
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join('; '))
  process.exit(1)
}
