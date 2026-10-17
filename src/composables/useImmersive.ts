/**
 * useImmersive —— 工具页沉浸/全屏状态（模块级单例，供 App 外壳与 ToolRunner 共享）。
 *
 * 两层沉浸：
 *  1) 应用内沉浸态（active）：隐藏应用顶栏/底部 Tab/页脚，工具内容铺满安全区。
 *     纯前端 class 切换，全平台可用（含不支持元素全屏的 iOS Safari），是保底体验。
 *  2) 系统全屏（渐进增强）：在用户手势内调用 Fullscreen API；能力缺失或被拒绝时静默停留应用内沉浸态。
 *
 * 约束：必须由用户手势触发 enter/toggle（Fullscreen API 要求）；路由离开工具页时应调用 exit()。
 */
import { readonly, ref } from 'vue'

const active = ref(false)
const sysFullscreen = ref(false)

const THEME_NORMAL = '#3f7d5e'
const THEME_IMMERSIVE = '#ffffff'

const canFullscreen =
  typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function'

let bound = false
function setThemeColor(color: string): void {
  if (typeof document === 'undefined') return
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', color)
}

function handleFsChange(): void {
  sysFullscreen.value = Boolean(document.fullscreenElement)
  // 用户按 Esc / 系统手势退出系统全屏时，同步退出应用内沉浸
  if (!sysFullscreen.value) active.value = false
}

function bindOnce(): void {
  if (bound || typeof document === 'undefined') return
  bound = true
  document.addEventListener('fullscreenchange', handleFsChange)
}

async function enter(): Promise<void> {
  active.value = true
  setThemeColor(THEME_IMMERSIVE)
  bindOnce()
  if (canFullscreen) {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    } catch {
      /* 系统全屏被拒或不可用：保留应用内沉浸态，不打扰用户 */
    }
  }
}

async function exit(): Promise<void> {
  active.value = false
  setThemeColor(THEME_NORMAL)
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    try {
      await document.exitFullscreen()
    } catch {
      /* 忽略退出异常 */
    }
  }
}

function toggle(): Promise<void> {
  return active.value ? exit() : enter()
}

export function useImmersive() {
  return {
    active: readonly(active),
    sysFullscreen: readonly(sysFullscreen),
    canFullscreen,
    enter,
    exit,
    toggle
  }
}
