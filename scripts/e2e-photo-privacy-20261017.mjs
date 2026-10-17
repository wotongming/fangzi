// E2E + 截图：photo-privacy（006 照片隐私清理）
// 三视口 PC1280x800 / 平板834x1112 / 手机375x812；强制 abort SW；真实运行界面截图。
import fs from 'node:fs'
import path from 'node:path'
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'

const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
const SHOTS = path.resolve('src/tools/photo-privacy/docs/shots')
fs.mkdirSync(SHOTS, { recursive: true })
const DL = '/tmp/pp-dl'
fs.mkdirSync(DL, { recursive: true })

// ---- 构造含 GPS/设备/时间 EXIF 的 APP1 段（小端 TIFF） ----
function buildApp1() {
  const IFD0 = 8, MAKE = 74, MODEL = 80, DATE = 87, LATR = 107, LNGR = 131, EXIFIFD = 156, GPSIFD = 174
  const TOTAL = 228
  const t = Buffer.alloc(TOTAL)
  t[0] = 0x49; t[1] = 0x49; t.writeUInt16LE(0x002a, 2); t.writeUInt32LE(IFD0, 4)
  const w16 = (o, v) => t.writeUInt16LE(v, o)
  const w32 = (o, v) => t.writeUInt32LE(v, o)
  const ent = (o, tag, type, cnt, val) => { w16(o, tag); w16(o + 2, type); w32(o + 4, cnt); w32(o + 8, val) }
  const setStr = (o, s) => { t.write(s, o, 'ascii'); t[o + s.length] = 0 }
  w16(IFD0, 5)
  let e = IFD0 + 2
  ent(e, 0x010f, 2, 6, MAKE); e += 12
  ent(e, 0x0110, 2, 7, MODEL); e += 12
  ent(e, 0x0112, 3, 1, 6); e += 12
  ent(e, 0x8769, 4, 1, EXIFIFD); e += 12
  ent(e, 0x8825, 4, 1, GPSIFD); e += 12
  w32(e, 0)
  setStr(MAKE, 'Apple'); setStr(MODEL, 'iPhone'); setStr(DATE, '2026:10:17 12:00:00')
  const rat = (o, n, d) => { w32(o, n); w32(o + 4, d) }
  rat(LATR, 32, 1); rat(LATR + 8, 3, 1); rat(LATR + 16, 9, 2)
  rat(LNGR, 118, 1); rat(LNGR + 8, 45, 1); rat(LNGR + 16, 30, 1)
  w16(EXIFIFD, 1)
  ent(EXIFIFD + 2, 0x9003, 2, 20, DATE)
  w32(EXIFIFD + 2 + 12, 0)
  w16(GPSIFD, 4)
  let g = GPSIFD + 2
  w16(g, 1); w16(g + 2, 2); w32(g + 4, 2); t[g + 8] = 0x4e; t[g + 9] = 0; g += 12
  ent(g, 2, 5, 3, LATR); g += 12
  w16(g, 3); w16(g + 2, 2); w32(g + 4, 2); t[g + 8] = 0x45; t[g + 9] = 0; g += 12
  ent(g, 4, 5, 3, LNGR); g += 12
  w32(g, 0)
  const payload = Buffer.concat([Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]), t])
  const seg = Buffer.alloc(2 + 2 + payload.length)
  seg[0] = 0xff; seg[1] = 0xe1
  seg.writeUInt16BE(payload.length + 2, 2)
  payload.copy(seg, 4)
  return seg
}

async function makeJpeg(page, withExif) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 480; c.height = 360
    const x = c.getContext('2d')
    x.fillStyle = '#9db8d6'; x.fillRect(0, 0, 480, 360)
    x.fillStyle = '#e07a5f'; x.fillRect(40, 40, 200, 140)
    x.fillStyle = '#fff'; x.font = '28px sans-serif'; x.fillText('ORDER 13800 13900', 40, 240)
    x.fillText('addr 86 road', 40, 290)
    return c.toDataURL('image/jpeg', 0.92)
  })
  const b64 = dataUrl.split(',')[1]
  const base = Buffer.from(b64, 'base64')
  if (!withExif) return base
  return Buffer.concat([base.subarray(0, 2), buildApp1(), base.subarray(2)])
}

const results = []
async function runViewport(browser, label, vp, full) {
  const ctx = await browser.newContext({
    viewport: vp,
    acceptDownloads: true,
    deviceScaleFactor: 2
  })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !/serviceWorker|sw\.js|registerSW|unknown error occurred when fetching the script|Failed to load resource.*(sw)/i.test(m.text())) errs.push(m.text())
  })
  page.on('pageerror', (e) => errs.push('pageerror:' + e.message))

  await page.goto(ORIGIN + '/#/t/photo-privacy', { waitUntil: 'networkidle' })
  await page.waitForSelector('.pp h1', { timeout: 15000 })
  await page.waitForTimeout(400)

  const jpg = await makeJpeg(page, true)
  await page.setInputFiles('.pick input[type=file]', { name: 'IMG_20261017_120000.jpg', mimeType: 'image/jpeg', buffer: jpg })
  await page.waitForSelector('.risk', { timeout: 10000 })
  const riskText = (await page.locator('.risk').innerText()).trim()
  const hasGps = /GPS/.test(riskText)
  results.push([label, '风险横幅含GPS', hasGps])

  await page.waitForSelector('.stage img', { timeout: 10000 })
  await page.locator('.stage').scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  const box = await page.locator('.stage').boundingBox()
  // 框选左下角文字区域（addr/order），归一化约 (0.05,0.55)->(0.75,0.92)
  await page.mouse.move(box.x + box.width * 0.06, box.y + box.height * 0.56)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.74, box.y + box.height * 0.9, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const maskCount = await page.locator('.stage .mask').count()
  results.push([label, '矩形遮罩已创建', maskCount >= 1])

  await page.screenshot({ path: path.join(SHOTS, `${label}-single-edit.png`) })

  await page.locator('button:has-text("一键清除隐私并生成")').click()
  await page.waitForSelector('.result .ok', { timeout: 20000 })
  const okText = await page.locator('.result .ok').innerText()
  results.push([label, '生成并提示已清空', /不含|清空|验证/.test(okText)])
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(SHOTS, `${label}-single-done.png`) })

  // 下载（单张）
  const dl1 = page.waitForEvent('download', { timeout: 15000 })
  await page.locator('.result .actions button:has-text("下载")').click()
  const d1 = await dl1
  await d1.saveAs(path.join(DL, `${label}-single.jpg`))

  if (full) {
    // 批量：选两张，触发专业版（mock 支付自动成功）后跑批
    await page.locator('.tabs button:has-text("批量处理")').click()
    await page.waitForTimeout(200)
    const j1 = await makeJpeg(page, true)
    const j2 = await makeJpeg(page, false)
    await page.setInputFiles('.card .pick input[type=file]', [
      { name: 'PXL_20261017_a.jpg', mimeType: 'image/jpeg', buffer: j1 },
      { name: 'shot_b.jpg', mimeType: 'image/jpeg', buffer: j2 }
    ])
    await page.waitForSelector('.rows li', { timeout: 10000 })
    const rowN = await page.locator('.rows li').count()
    results.push([label, '批量列表2行', rowN === 2])
    await page.screenshot({ path: path.join(SHOTS, 'pc-batch-list.png') })

    const dl2 = page.waitForEvent('download', { timeout: 40000 }).catch(() => null)
    await page.locator('button', { hasText: /开始批量处理|批量处理（专业）/ }).click()
    // 若弹的是购买，mock 下单自动成功后继续；等待 ZIP 按钮出现
    await page.waitForSelector('button:has-text("下载 ZIP")', { timeout: 40000 })
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll('button')].find((x) => /下载 ZIP/.test(x.textContent || ''))
        return b && !b.disabled
      },
      { timeout: 40000 }
    )
    const zipDl = page.waitForEvent('download', { timeout: 20000 })
    await page.locator('button:has-text("下载 ZIP")').click()
    const d2 = await zipDl
    await d2.saveAs(path.join(DL, 'pc-batch.zip'))
    results.push([label, '批量ZIP下载', true])
    void dl2
    await page.screenshot({ path: path.join(SHOTS, 'pc-batch-done.png') })
  }

  // 横向溢出
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  results.push([label, '无横向溢出(<=2px)', overflow <= 2])

  await ctx.close()
  return errs
}

const browser = await pw.chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const allErrs = []
allErrs.push(...(await runViewport(browser, 'pc', { width: 1280, height: 800 }, true)))
allErrs.push(...(await runViewport(browser, 'tablet', { width: 834, height: 1112 }, false)))
allErrs.push(...(await runViewport(browser, 'mobile', { width: 375, height: 812 }, false)))
await browser.close()

let pass = 0
for (const [vp, name, ok] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${vp}] ${name}`)
  if (ok) pass++
}
console.log(`\n断言 ${pass}/${results.length} 通过`)
const realErrs = allErrs.filter((x) => x && x.trim())
console.log('致命 console/page 错误数：', realErrs.length)
if (realErrs.length) console.log(realErrs.slice(0, 10).join('\n'))
// 下载文件落地检查
for (const f of ['pc-single.jpg', 'tablet-single.jpg', 'mobile-single.jpg', 'pc-batch.zip']) {
  const p = path.join(DL, f)
  const st = fs.existsSync(p) ? fs.statSync(p) : null
  console.log(st ? `下载 ${f} ${st.size} 字节` : `缺失 ${f}`)
}
const fail = results.some(([, , ok]) => !ok) || realErrs.length > 0
process.exit(fail ? 1 : 0)
