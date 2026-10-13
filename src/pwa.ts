/**
 * PWA 注册：使用 workbox-window 注册由 vite-plugin-pwa 生成的 service worker。
 * 注册失败（非安全上下文 / 老旧浏览器）静默降级为普通网页，不影响功能。
 */
import { Workbox } from 'workbox-window'

export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return
  try {
    const wb = new Workbox(import.meta.env.BASE_URL + 'sw.js')
    wb.addEventListener('waiting', () => {
      // 发现新版本：提示用户刷新（简单策略：自动跳过等待并刷新）
      wb.addEventListener('controlling', () => window.location.reload())
      void wb.messageSkipWaiting()
    })
    void wb.register().catch(() => {
      /* 离线 / 文件缺失时忽略 */
    })
  } catch {
    /* 环境不支持时不阻塞应用 */
  }
}
