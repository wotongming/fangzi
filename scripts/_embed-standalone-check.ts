/**
 * 006 独立产物校验：把“生成的单文件脚本”写进真实独立 HTML，用 file:// 打开验证
 *  - 五类模板中的剩余三类（feedback / calculator / countdown）真实可用
 *  - Shadow DOM 样式隔离：宿主页面的 div{border-radius:0}、button 样式不得影响组件内部
 *  - poweredBy:false 时无角标；过去时间倒计时显示到期文案
 * 运行：node --import tsx scripts/_embed-standalone-check.ts
 */
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
const { chromium } = pw
import { writeFileSync } from 'node:fs'
import { TEMPLATES, templateOf } from '../src/tools/embed-widget-builder/lib/templates.ts'
import { standaloneDoc } from '../src/tools/embed-widget-builder/lib/snippet.ts'

const results: Array<{ name: string; ok: boolean; detail?: string }> = []
async function check(name: string, fn: () => Promise<string> | string) {
  try { results.push({ name, ok: true, detail: await fn() }) }
  catch (e) { results.push({ name, ok: false, detail: (e as Error).message }) }
}

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })

async function openDoc(html: string, token: string) {
  const path = `/tmp/ewb-${token}.html`
  writeFileSync(path, html)
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await ctx.newPage()
  await page.goto('file://' + path, { waitUntil: 'load' })
  await page.waitForTimeout(200)
  return { page, ctx }
}

// 1) feedback：选项 + 提交
{
  const c = templateOf('feedback').defaults()
  const { page, ctx } = await openDoc(standaloneDoc(c, false), 'feedback')
  await check('feedback 渲染 3 个选项', () =>
    page.evaluate(() => {
      const el: any = document.querySelector('[data-key]')
      const chips = el.shadowRoot.querySelectorAll('.chips button').length
      if (chips !== 3) throw new Error('选项数=' + chips)
      return chips + ' 个'
    })
  )
  await check('feedback 选择并提交成功', () =>
    page.evaluate(async () => {
      const el: any = document.querySelector('[data-key]')
      const sr = el.shadowRoot
      sr.querySelector('.chips button[data-i="1"]').click()
      sr.querySelector('button[type=submit]').click()
      await new Promise((r) => setTimeout(r, 50))
      const ok = getComputedStyle(sr.querySelector('.ok')).display
      if (ok === 'none') throw new Error('成功提示未显示')
      return '已提交'
    })
  )
  await ctx.close()
}

// 2) calculator：默认计价、改数量实时更新、合计公式
{
  const c = templateOf('calculator').defaults()
  c.calc!.unitPrice = 99; c.calc!.fixedFee = 20; c.calc!.qtyDefault = 2
  const { page, ctx } = await openDoc(standaloneDoc(c, false), 'calc')
  await check('calculator 默认合计 = 2×99+20 = 218', () =>
    page.evaluate(() => {
      const el: any = document.querySelector('[data-key]')
      const t = el.shadowRoot.querySelector('[data-role=total]').textContent
      if (!t.includes('218.00')) throw new Error('合计=' + t)
      return t
    })
  )
  await check('calculator 数量改 3 实时变 317', () =>
    page.evaluate(async () => {
      const el: any = document.querySelector('[data-key]')
      const q = el.shadowRoot.querySelector('input[name=qty]'); q.value = '3'; q.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 50))
      const t = el.shadowRoot.querySelector('[data-role=total]').textContent
      if (!t.includes('317.00')) throw new Error('合计=' + t)
      return t
    })
  )
  await ctx.close()
}

// 3) countdown：未来显示天时分秒；过去显示到期文案
{
  const c = templateOf('countdown').defaults()
  c.countdown!.targetAt = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString().slice(0, 16)
  const { page, ctx } = await openDoc(standaloneDoc(c, false), 'cd')
  await check('countdown 未来时间显示天/时/分/秒', () =>
    page.evaluate(() => {
      const el: any = document.querySelector('[data-key]')
      const blocks = el.shadowRoot.querySelectorAll('.cd div').length
      if (blocks < 4) throw new Error('时间块=' + blocks)
      return blocks + ' 块'
    })
  )
  await ctx.close()

  const c2 = templateOf('countdown').defaults()
  c2.countdown!.targetAt = '2000-01-01T00:00'
  c2.countdown!.completeText = '活动已结束'
  const r2 = await openDoc(standaloneDoc(c2, false), 'cd-done')
  await check('countdown 过去时间显示到期文案', () =>
    r2.page.evaluate(() => {
      const el: any = document.querySelector('[data-key]')
      const d = getComputedStyle(el.shadowRoot.querySelector('[data-role=done]')).display
      const txt = el.shadowRoot.querySelector('[data-role=done]').textContent
      if (d === 'none' || !txt.includes('活动已结束')) throw new Error('未显示到期文案 display=' + d)
      return txt
    })
  )
  await r2.ctx.close()
}

// 4) Shadow DOM 样式隔离 + poweredBy 开关
{
  const c = templateOf('contact').defaults()
  c.theme.radius = 10
  c.poweredBy = false
  const { page, ctx } = await openDoc(standaloneDoc(c, false), 'iso')
  await check('样式隔离：宿主 div{border-radius:0} 不影响组件卡片（应为 18px）', () =>
    page.evaluate(() => {
      const el: any = document.querySelector('[data-key]')
      const r = getComputedStyle(el.shadowRoot.querySelector('.w')).borderRadius
      if (r !== '18px') throw new Error('卡片圆角=' + r + '（疑似被宿主样式污染）')
      return r
    })
  )
  await check('样式隔离：组件主按钮为主题绿而非宿主默认', () =>
    page.evaluate(() => {
      const el: any = document.querySelector('[data-key]')
      const bg = getComputedStyle(el.shadowRoot.querySelector('.btn')).backgroundColor
      if (!/rgb\(15,\s*122,\s*79\)/.test(bg)) throw new Error('按钮底色=' + bg)
      return bg
    })
  )
  await check('poweredBy:false 时无「由方子生成」角标', () =>
    page.evaluate(() => {
      const el: any = document.querySelector('[data-key]')
      if (el.shadowRoot.querySelector('.badge')) throw new Error('仍存在角标')
      return '无角标'
    })
  )
  await ctx.close()
}

let pass = 0
for (const r of results) { console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`); if (r.ok) pass++ }
console.log(`\n通过 ${pass}/${results.length}`)
process.exit(pass === results.length ? 0 : 1)
