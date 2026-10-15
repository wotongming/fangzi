/**
 * _gpu-ctx.mjs —— GPU 工具无头 E2E 公共上下文（pipeline-coder 共享脚本）。
 *
 * 背景与正确用法见 pipeline-coder skill：references/gpu-headless-testing.md
 *  - 可视渲染 / 交互 / 截图 E2E：用 newCompatContext（强制 WebGL2，无头软渲染也能稳定出图）。
 *  - WebGPU compute/离屏正确性：用缓冲/纹理读回断言，不用截图（见 skill 文档）。
 *
 * 用法：
 *   import { launch, newCompatContext, SW_NOISE } from './_gpu-ctx.mjs'
 *   const browser = await launch()
 *   const ctx = await newCompatContext(browser, { width: 1280, height: 800 })
 */

// Playwright 可能是项目依赖，也可能是全局预装模块；两者兼容。
async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    return await import('/opt/vm/preinstall/npm-global/lib/node_modules/playwright/index.js')
  }
}

export const CHROMIUM = process.env.CHROMIUM_BIN || '/usr/local/bin/chromium'
export const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage']
export const SW_NOISE = /fetching the script|serviceWorker|An unknown error occurred when fetching/i

export async function launch() {
  const { chromium } = await loadPlaywright()
  return chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS })
}

/**
 * 模拟“不支持 WebGPU”的浏览器，强制应用降级到 WebGL2；
 * 同时 abort Service Worker，确保加载到当前构建产物而非旧预缓存。
 */
export async function newCompatContext(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true })
    } catch {}
  })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}

/**
 * 需要真实尝试 WebGPU 时使用（仅用于探测降级/缓冲读回，不可用于断言上屏像素）。
 * 无头下 launch 需自行加 '--enable-unsafe-webgpu'（或在 launch(extraArgs) 传入）。
 */
export async function newWebGpuContext(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  await ctx.route('**/sw.js', (r) => r.abort())
  await ctx.route('**/registerSW.js', (r) => r.abort())
  return ctx
}

/** 标准三视口 */
export const VIEWPORTS = {
  pc: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 375, height: 812 }
}

/** 断言页面无横向溢出（返回溢出像素数） */
export async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}
