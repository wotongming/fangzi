/**
 * shot-merge-planet-codex-20261020.mjs —— 合成宇宙（merge-planet）「19 天体图鉴」出图脚本（可选复用，不进 build/SW）。
 *
 * 不另写画法：页面内 import 游戏真实 game/render.ts 的 paintPlanet / drawSpaceBackground，
 * 按 logic.ts 的 TIERS 顺序逐个绘制。自启一次性 vite dev 服务源码，回传 dataURL 落盘 PNG。
 *
 * 用法：node scripts/shot-merge-planet-codex-20261020.mjs
 * 产物：docs/shots/mp-codex-pc.png、mp-codex-mobile.png
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pw from '/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js'
import { CHROMIUM, LAUNCH_ARGS } from './_gpu-ctx.mjs'

const { chromium } = pw
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'src/tools/mini-games/docs/shots')
const PORT = 5199
const BASE = `http://127.0.0.1:${PORT}`

function log(...a) { console.log('[codex]', ...a) }

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/')
      if (r.ok) return
    } catch {}
    await new Promise((s) => setTimeout(s, 500))
  }
  throw new Error('vite dev 启动超时')
}

// 在页面内：建两个离屏 canvas，走真实 paintPlanet 绘制，回传 dataURL
async function DRAW() {
  const { TIERS } = await import('/src/tools/mini-games/gpu-games/merge-planet/game/logic.ts')
  const { paintPlanet, drawSpaceBackground, makeStarfield } = await import(
    '/src/tools/mini-games/gpu-games/merge-planet/game/render.ts'
  )
  const TIME = 1.2
  const mk = (w, h) => {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    return c.getContext('2d')
  }
  const label = (ctx, cx, y, num, name) => {
    ctx.font = '600 20px "PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(226,236,255,0.95)'
    ctx.fillText(`${num} ${name}`, cx, y)
  }
  const groupHeader = (ctx, x, y, w, text) => {
    ctx.font = '700 22px "PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(150,196,255,0.95)'
    ctx.fillText(text, x + w / 2, y)
    ctx.strokeStyle = 'rgba(120,160,230,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x + 30, y + 14); ctx.lineTo(x + w - 30, y + 14); ctx.stroke()
  }
  const drawOne = (ctx, idx, cx, cy, r) =>
    paintPlanet(ctx, idx, cx, cy, r, { popScale: 1, timeSec: TIME, seed: idx * 131 + 17 })

  // —— PC 1600×1200，5 列 ——
  const pc = mk(1600, 1200)
  drawSpaceBackground(pc, 1600, 1200, makeStarfield(1600, 1200, 180), TIME)
  pc.textAlign = 'center'
  pc.font = '800 40px "PingFang SC","Microsoft YaHei",system-ui,sans-serif'
  pc.fillStyle = '#eaf2ff'
  pc.fillText('合成宇宙 · 19 天体图鉴', 800, 72)
  pc.font = '500 18px system-ui,sans-serif'
  pc.fillStyle = 'rgba(180,205,240,0.8)'
  pc.fillText('陨石 → 月球 → … → 宇宙，同级合成逐级进化，合成宇宙即通关', 800, 108)
  const cols = [160, 480, 800, 1120, 1440]
  const R = 50
  groupHeader(pc, 0, 168, 1600, '行星 · 1–10')
  for (let i = 0; i < 10; i++) {
    const cx = cols[i % 5]
    const cy = i < 5 ? 290 : 470
    drawOne(pc, i, cx, cy, R)
    label(pc, cx, cy + 78, i + 1, TIERS[i].name)
  }
  groupHeader(pc, 0, 640, 1600, '恒星一生 · 11–14')
  for (let k = 0; k < 4; k++) {
    const idx = 10 + k
    drawOne(pc, idx, cols[k], 770, R)
    label(pc, cols[k], 770 + 78, idx + 1, TIERS[idx].name)
  }
  const bx = cols[4]
  pc.strokeStyle = 'rgba(150,120,255,0.6)'; pc.lineWidth = 2
  pc.beginPath(); pc.arc(bx, 770, R, 0, Math.PI * 2); pc.stroke()
  pc.font = '700 20px system-ui,sans-serif'
  pc.fillStyle = 'rgba(210,196,255,0.95)'
  pc.fillText('合成宇宙', bx, 770 - 6); pc.fillText('= 通关', bx, 770 + 22)
  groupHeader(pc, 0, 940, 1600, '宇宙结构 · 15–19')
  for (let k = 0; k < 5; k++) {
    const idx = 14 + k
    drawOne(pc, idx, cols[k], 1070, R)
    label(pc, cols[k], 1070 + 78, idx + 1, TIERS[idx].name)
  }

  // —— 手机 420 宽，两列长图 ——
  const W = 420
  const colX = [112, 308]
  const cellH = 150
  const rows = 5 + 2 + 3
  const H = 120 + rows * cellH + 3 * 84
  const mob = mk(W, H)
  drawSpaceBackground(mob, W, H, makeStarfield(W, H, 150), TIME)
  mob.textAlign = 'center'
  mob.font = '800 30px "PingFang SC","Microsoft YaHei",system-ui,sans-serif'
  mob.fillStyle = '#eaf2ff'
  mob.fillText('合成宇宙 · 19 天体图鉴', W / 2, 56)
  let y = 120
  const Rm = 46
  const section = (header, from, count) => {
    y += 28 // 段间留白，避免分组标题压到上一行
    groupHeader(mob, 0, y, W, header)
    y += 58
    for (let k = 0; k < count; k++) {
      const idx = from + k
      const cx = colX[k % 2]
      const cy = y + 62
      drawOne(mob, idx, cx, cy, Rm)
      label(mob, cx, cy + 72, idx + 1, TIERS[idx].name)
      if (k % 2 === 1) y += cellH
    }
    if (count % 2 === 1) y += cellH
  }
  section('行星 · 1–10', 0, 10)
  section('恒星一生 · 11–14', 10, 4)
  section('宇宙结构 · 15–19', 14, 5)

  return { pc: pc.canvas.toDataURL('image/png'), mob: mob.canvas.toDataURL('image/png') }
}

function decodeDataUrl(url) {
  return Buffer.from(url.split(',')[1], 'base64')
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: true
  })
  let browser
  try {
    await waitServer()
    browser = await chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e.message)))
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    const { pc, mob } = await page.evaluate(DRAW)
    writeFileSync(join(SHOTS, 'mp-codex-pc.png'), decodeDataUrl(pc))
    writeFileSync(join(SHOTS, 'mp-codex-mobile.png'), decodeDataUrl(mob))
    log('saved mp-codex-pc.png, mp-codex-mobile.png', errs.length ? 'pageerror=' + errs.join('|') : '')
  } finally {
    await browser?.close()
    vite.kill()
  }
}

main().catch((e) => {
  console.error('[codex] 失败:', e)
  process.exit(1)
})
