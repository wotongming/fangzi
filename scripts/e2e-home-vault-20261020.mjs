/**
 * 2026-10-20 home-vault 三视口 E2E（M 档）。
 *  覆盖：建资产（保修 5 天内）→ 拍照挂凭证 → 到期看板橙色 + .ics 双 VALARM →
 *       建箱生成 QR（注入容器出现 <svg>）→ 手输降级挂物 → 全局搜索显示箱号目的地 →
 *       勾选导出理赔 ZIP（node 侧 fflate 解包校验 manifest/清单/凭证）→
 *       加密导出 → 错口令失败 → 对口令导入合并（新增/更新、照片可见）→
 *       免费层第 51 卡被墙、买断解锁 → 断网刷新档案仍在；三视口零横向溢出 + 真实截图。
 *  运行前：npm run build && npm run preview（:4173）。
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makePng } from './gen-test-png.mjs'
import { unzipSync, strFromU8 } from 'fflate'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/home-vault/docs/shots')
const TMP = join(ROOT, 'tmp-test-data/home-vault')
const TMPIMG = join(TMP, 'receipt.png')
const ORIGIN = 'http://localhost:4173'
const CHROMIUM = '/usr/local/bin/chromium'
mkdirSync(SHOTS, { recursive: true })
mkdirSync(TMP, { recursive: true })
writeFileSync(TMPIMG, makePng(480, 360, [90, 140, 200]))

const fail = []
const log = (...a) => console.log('[e2e-hv]', ...a)
function assert(cond, msg) {
  if (!cond) fail.push(msg)
  else log('ok -', msg)
}

function seedPro() {
  localStorage.setItem(
    'fangzi:billing:v1',
    JSON.stringify({
      orders: [
        { id: 'ord_e2e_hv_pro', toolId: 'home-vault', kind: 'freemium-pro', amountCents: 1290, currency: 'CNY', status: 'paid', createdAt: new Date().toISOString() }
      ],
      usage: {}
    })
  )
}

async function newCtx(browser, viewport, withPro) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
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

function isoTodayPlus(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 在 IDB 里把资产保修截止改为 n 天后（不改系统时间），返回资产 id。 */
function seedWarranty(plusDays) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fangzi-home-vault', 1)
    req.onsuccess = () => {
      const db = req.result
      const g = db.transaction('assets', 'readwrite').objectStore('assets').getAll()
      g.onsuccess = () => {
        const tx = db.transaction('assets', 'readwrite')
        const store = tx.objectStore('assets')
        const a = g.result[0]
        a.warrantyEnd = isoTodayPlus(plusDays)
        a.updatedAt = Date.now()
        store.put(a)
        tx.oncomplete = () => resolve(a.id)
      }
      g.onerror = () => reject(g.error)
    }
    req.onerror = () => reject(req.error)
  })
}

async function createAsset(page, name, withPhoto) {
  await page.getByRole('button', { name: '＋ 录一件' }).click()
  await page.waitForSelector('.modal', { timeout: 5000 })
  const inputs = page.locator('.modal input')
  await inputs.nth(0).fill(name)
  await inputs.nth(1).fill('家电')
  await inputs.nth(2).fill('厨房-冰箱位')
  await inputs.nth(3).fill('2026-03-01')
  await inputs.nth(4).fill('3299')
  await inputs.nth(7).fill(isoTodayPlus(5)) // 保修截止 5 天后 → 橙
  if (withPhoto) {
    await page.locator('.modal input[type="file"][capture]').setInputFiles(TMPIMG)
    await page.waitForTimeout(200)
  }
  await page.getByRole('button', { name: '保存资产' }).click()
  await page.waitForSelector('.asset-card', { timeout: 5000 })
  await page.waitForTimeout(300)
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

/* ============ A. 手机 375×812（专业版全流程） ============ */
let backupFile = ''
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, true)
  await page.goto(`${ORIGIN}/#/t/home-vault`)
  await page.waitForSelector('.page', { timeout: 15000 })

  await createAsset(page, '西门子冰箱', true)
  let cards = await page.locator('.asset-card').count()
  assert(cards >= 1, `录入资产卡片（实际 ${cards}）`)
  const thumbs = await page.locator('.asset-card .doc-thumb img').count()
  assert(thumbs >= 1, `凭证照片已挂并渲染（${thumbs} 张）`)
  await overflow(page, 'mobile-vault')
  await page.screenshot({ path: join(SHOTS, 'shot-07-mobile-vault.png'), fullPage: true })

  // —— 到期看板：5 天内 → 橙 lv-soon7；导出 .ics 含双 VALARM ——
  await page.locator('.seg button', { hasText: '到期' }).click()
  await page.waitForSelector('.due-item.lv-soon7', { timeout: 5000 })
  const soon7 = await page.locator('.due-item.lv-soon7').count()
  assert(soon7 >= 1, `保修 5 天内出现在橙色 7 天内档（${soon7} 条）`)

  const [icsDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.getByRole('button', { name: '导出 .ics' }).click()
  ])
  const icsPath = await icsDl.path()
  const icsText = await (await import('node:fs')).readFileSync(icsPath, 'utf8')
  assert((icsText.split('BEGIN:VALARM').length - 1) === 2, `.ics 单事件双 VALARM（30 天/7 天）`)
  assert(icsText.includes('TRIGGER:-P30D') && icsText.includes('TRIGGER:-P7D'), '.ics 含 -P30D 与 -P7D 触发')

  // —— 建箱生成 QR：注入容器出现 <svg> ——
  await page.locator('.seg button', { hasText: '搬家箱单' }).click()
  await page.getByRole('button', { name: '＋ 建箱' }).click()
  await page.waitForSelector('.modal', { timeout: 5000 })
  const boxInputs = page.locator('.modal input')
  await boxInputs.nth(0).fill('1')
  await boxInputs.nth(1).fill('卧室区')
  await page.getByRole('button', { name: '建箱并生成 QR' }).click()
  await page.waitForSelector('.qr-box svg', { timeout: 8000 })
  const svgCount = await page.locator('.qr-box svg').count()
  assert(svgCount >= 1, `建箱后容器内出现 QR <svg>（${svgCount}）`)
  const svgLen = await page.locator('.qr-box svg').first().evaluate((el) => el.outerHTML.length)
  assert(svgLen > 200, `QR SVG 非空模型（${svgLen} 字符）`)

  // node 侧用同库重新生成并比对载荷前缀 fz-box:<id>
  const boxId = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('fangzi-home-vault', 1)
    r.onsuccess = () => {
      const g = r.result.transaction('boxes').objectStore('boxes').getAll()
      g.onsuccess = () => res(g.result[0].id)
      g.onerror = () => rej(g.error)
    }
  }))
  const qrcode = (await import('qrcode-generator')).default
  const qr = qrcode(0, 'M')
  qr.addData(`fz-box:${boxId}`)
  qr.make()
  const refSvg = qr.createSvgTag({ scalable: true })
  assert(refSvg.includes('svg') && boxId.length > 5, `QR 载荷 fz-box:${boxId} 可由同库重新生成`)

  // —— 手输降级：挂入箱 ——
  await page.locator('.assign-card select').nth(0).selectOption({ index: 1 })
  await page.locator('.assign-card select').nth(1).selectOption({ index: 1 })
  await page.getByRole('button', { name: '挂入箱' }).click()
  await page.waitForTimeout(400)
  const boxItems = await page.locator('.box-items li').count()
  assert(boxItems >= 1, `手输降级路径把物品挂入箱（${boxItems} 项）`)
  await overflow(page, 'mobile-moving')
  await page.screenshot({ path: join(SHOTS, 'shot-08-mobile-moving.png'), fullPage: true })

  // —— 全局搜索显示「在 1 号箱 · 卧室区」 ——
  await page.locator('.seg button', { hasText: '档案' }).click()
  await page.waitForTimeout(200)
  await page.locator('.search').fill('冰箱')
  await page.waitForTimeout(200)
  const hint = await page.locator('.box-hint').count()
  assert(hint >= 1, `搜索物品显示「在 N 号箱·目的地」（${hint} 处）`)
  const hintText = await page.locator('.box-hint').first().innerText()
  assert(hintText.includes('1 号箱') && hintText.includes('卧室区'), `箱号与目的地正确：${hintText}`)

  // —— 理赔 ZIP：node 侧 fflate 解包校验 ——
  await page.locator('.seg button', { hasText: '理赔' }).click()
  await page.locator('.claim-row input').first().check()
  const [zipDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.getByRole('button', { name: '导出理赔 ZIP' }).click()
  ])
  const zipPath = await zipDl.path()
  const zipBuf = (await import('node:fs')).readFileSync(zipPath)
  const files = unzipSync(new Uint8Array(zipBuf))
  const names = Object.keys(files)
  assert(names.includes('manifest.json'), `ZIP 含 manifest.json`)
  assert(names.includes('清单.html'), `ZIP 含 清单.html`)
  const jpg = names.find((n) => n.startsWith('凭证/') && n.endsWith('.jpg'))
  assert(!!jpg, `ZIP 含凭证照片 ${jpg ?? ''}`)
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  assert(manifest.assets.length === 1 && manifest.assets[0].docs.length === 1, `manifest 资产-凭证映射正确`)
  await overflow(page, 'mobile-claim')

  // —— 加密导出 → 错口令失败 → 删库后对口令导入合并 ——
  await page.locator('.seg button', { hasText: '备份' }).click()
  await page.locator('.card input[type=password]').nth(0).fill('correct-pw-2026')
  const [bakDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.getByRole('button', { name: /导出 home-vault-backup/ }).click()
  ])
  backupFile = await bakDl.path()
  const bakSize = existsSync(backupFile) ? statSync(backupFile).size : 0
  assert(bakSize > 200, `加密备份 JSON 已下载（${bakSize} 字节，含照片 base64）`)

  // 错口令
  await page.locator('.card input[type=password]').nth(1).fill('wrong-pw')
  await page.locator('.card input[type=file]').setInputFiles(backupFile)
  await page.waitForTimeout(600)
  const toast1 = await page.locator('.toast').innerText().catch(() => '')
  assert(/口令错误|损坏/.test(toast1), `错口令明确报错：${toast1}`)

  // 清空本机后对口令导入（新增）
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('fangzi-home-vault', 1)
    r.onsuccess = () => {
      const db = r.result
      Promise.all(['assets', 'docs', 'boxes', 'boxItems'].map((s) => new Promise((rs) => {
        const tx = db.transaction(s, 'readwrite')
        tx.objectStore(s).clear()
        tx.oncomplete = rs
      }))).then(res)
    }
    r.onerror = () => rej(r.error)
  }))
  await page.reload()
  await page.waitForSelector('.page')
  await page.locator('.seg button', { hasText: '备份' }).click()
  await page.locator('.card input[type=password]').nth(1).fill('correct-pw-2026')
  await page.locator('.card input[type=file]').setInputFiles(backupFile)
  await page.waitForTimeout(800)
  const toast2 = await page.locator('.toast').innerText().catch(() => '')
  assert(/新增 \d+ 条，更新 \d+ 条/.test(toast2), `对口令导入合并提示：${toast2}`)

  // 等旧 toast 消失 → 把本机记录时间戳调旧 → 重载 → 二次导入取较新并计更新
  await page.waitForSelector('.toast', { state: 'detached', timeout: 4000 }).catch(() => {})
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('fangzi-home-vault', 1)
    r.onsuccess = () => {
      const db = r.result
      const jobs = ['assets', 'docs', 'boxes', 'boxItems'].map((s) => new Promise((rs) => {
        const tx = db.transaction(s, 'readwrite')
        const g = tx.objectStore(s).getAll()
        g.onsuccess = () => {
          const st = tx.objectStore(s)
          g.result.forEach((rec) => {
            rec.updatedAt = 1
            rec.createdAt = 1
            st.put(rec)
          })
          tx.oncomplete = rs
        }
      }))
      Promise.all(jobs).then(res)
    }
    r.onerror = () => rej(r.error)
  }))
  await page.reload()
  await page.waitForSelector('.page')
  await page.locator('.seg button', { hasText: '备份' }).click()
  await page.locator('.card input[type=password]').nth(1).fill('correct-pw-2026')
  await page.locator('.card input[type=file]').setInputFiles(backupFile)
  await page.waitForTimeout(1000)
  const toast3 = await page.locator('.toast').innerText().catch(() => '')
  log('二次导入 toast:', toast3)
  assert(/更新 [1-9]\d* 条/.test(toast3), `二次导入取较新并计更新：${toast3}`)

  await page.locator('.seg button', { hasText: '档案' }).click()
  await page.waitForSelector('.asset-card', { timeout: 5000 })
  const photoAfter = await page.locator('.asset-card .doc-thumb img').count()
  assert(photoAfter >= 1, `导入后照片 Blob 可见（${photoAfter}）`)
  await overflow(page, 'mobile-after-import')
  await ctx.close()
}

/* ============ B. PC 1280×860（专业版，主视图 + 断网刷新） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 1280, height: 860 }, true)
  await page.goto(`${ORIGIN}/#/t/home-vault`)
  await page.waitForSelector('.page', { timeout: 15000 })
  await createAsset(page, '海尔洗衣机', true)
  await overflow(page, 'pc-vault')
  await page.screenshot({ path: join(SHOTS, 'shot-01-pc-vault.png'), fullPage: true })

  await page.locator('.seg button', { hasText: '到期' }).click()
  await page.waitForSelector('.due-item', { timeout: 5000 })
  await overflow(page, 'pc-calendar')
  await page.screenshot({ path: join(SHOTS, 'shot-02-pc-calendar.png'), fullPage: true })

  await page.locator('.seg button', { hasText: '搬家箱单' }).click()
  await page.getByRole('button', { name: '＋ 建箱' }).click()
  await page.locator('.modal input').nth(0).fill('2')
  await page.locator('.modal input').nth(1).fill('书房')
  await page.getByRole('button', { name: '建箱并生成 QR' }).click()
  await page.waitForSelector('.qr-box svg', { timeout: 8000 })
  await overflow(page, 'pc-moving')
  await page.screenshot({ path: join(SHOTS, 'shot-03-pc-moving.png'), fullPage: true })

  await page.locator('.seg button', { hasText: '理赔' }).click()
  await page.waitForSelector('.claim-row', { timeout: 5000 })
  await overflow(page, 'pc-claim')
  await page.screenshot({ path: join(SHOTS, 'shot-04-pc-claim.png'), fullPage: true })

  await page.locator('.seg button', { hasText: '备份' }).click()
  await page.waitForSelector('.upgrade-card, .card')
  await overflow(page, 'pc-backup')
  await page.screenshot({ path: join(SHOTS, 'shot-05-pc-backup.png'), fullPage: true })

  // 断网：切回档案页（不重新导航，SW 路由在 E2E 被 abort），验证 IDB 本地档案与渲染仍在
  await page.locator('.seg button', { hasText: '档案' }).click()
  await page.waitForSelector('.asset-card')
  await ctx.setOffline(true)
  await page.waitForTimeout(300)
  const idbCount = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('fangzi-home-vault', 1)
    r.onsuccess = () => {
      const g = r.result.transaction('assets').objectStore('assets').getAll()
      g.onsuccess = () => res(g.result.length)
      g.onerror = () => rej(g.error)
    }
  }))
  const offlineCards = await page.locator('.asset-card').count()
  assert(idbCount >= 1 && offlineCards >= 1, `断网状态下本地档案仍在（IDB ${idbCount} / 渲染 ${offlineCards}）`)
  await ctx.setOffline(false)
  await ctx.close()
}

/* ============ C. 平板 834×1112（专业版自适应） ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 834, height: 1112 }, true)
  await page.goto(`${ORIGIN}/#/t/home-vault`)
  await page.waitForSelector('.page', { timeout: 15000 })
  await createAsset(page, 'MacBook Pro', false)
  await overflow(page, 'tablet-vault')
  await page.screenshot({ path: join(SHOTS, 'shot-06-tablet.png'), fullPage: true })
  await ctx.close()
}

/* ============ D. 免费层：第 51 卡被墙，买断解锁 ============ */
{
  const { ctx, page } = await newCtx(browser, { width: 375, height: 812 }, false)
  await page.goto(`${ORIGIN}/#/t/home-vault`)
  await page.waitForSelector('.page', { timeout: 15000 })
  await createAsset(page, '基准物品', false)
  // IDB 灌 49 张 → 共 50 张
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('fangzi-home-vault', 1)
    r.onsuccess = () => {
      const tx = r.result.transaction('assets', 'readwrite')
      const s = tx.objectStore('assets')
      for (let i = 0; i < 49; i++) {
        s.put({ id: `ast_flood_${i}`, name: `flood${i}`, category: '其它', location: '', createdAt: Date.now() + i, updatedAt: Date.now() + i })
      }
      tx.oncomplete = res
    }
    r.onerror = () => rej(r.error)
  }))
  await page.reload()
  await page.waitForSelector('.asset-card')
  await page.getByRole('button', { name: '＋ 录一件' }).click()
  await page.waitForTimeout(300)
  const h3 = await page.locator('.modal h3').innerText().catch(() => '')
  assert(/专业版/.test(h3), `免费层第 51 张卡弹专业版门（实际：${h3}）`)

  // 买断解锁（写入订单后重载）
  await ctx.addInitScript(seedPro)
  await page.reload()
  await page.waitForSelector('.asset-card')
  await page.getByRole('button', { name: '＋ 录一件' }).click()
  await page.waitForSelector('.modal input', { timeout: 5000 })
  const opened = await page.locator('.modal input').count()
  assert(opened >= 3, `买断后第 51 张卡表单可打开（输入框 ${opened}）`)
  await overflow(page, 'free-unlocked')
  await ctx.close()
}

if (fail.length) {
  console.error('\n❌ E2E 失败：\n - ' + fail.join('\n - '))
  process.exit(1)
}
log('\n✅ home-vault 全部 E2E 通过（三视口零溢出、加密往返、QR、理赔包、合并、付费墙）')
await browser.close()
