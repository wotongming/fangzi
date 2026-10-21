import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// 部署到域名根路径时无需修改；部署到子路径时设置 VITE_BASE=/子路径/
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/favicon-16.png'],
      manifest: {
        id: base,
        name: '方子 - 对症下药的工具箱',
        short_name: '方子',
        description: '覆盖生活、工作、合规等场景的单点工具集合，说说你遇到的问题，给你开个小方子。',
        lang: 'zh-CN',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        categories: ['productivity', 'utilities'],
        background_color: '#f7f6f2',
        theme_color: '#3f7d5e',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          // 独立 maskable 512：绿底满幅、核心居中于 80% 安全区，安卓启动器遮罩不切主体
          { src: `${base}icons/icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // 引入自托管模型分片合并层（/mf/ 下超 25MiB 的 onnx 透明分片合并）
        importScripts: [`${base}sw-model-shards.js`],
        // 新 SW 安装后立即接管已打开标签，保证首次访问 /mf 即被分片合并层拦截（不靠手动刷新时序）
        skipWaiting: true,
        clientsClaim: true,
        // 预缓存构建产物与静态应用外壳
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2,json}'],
        // mf 模型文件按需运行时获取（含 40MB onnx），不进安装期预缓存
        globIgnores: ['plugins/**', 'tools-index.json', 'mf/**', 'sw-model-shards.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 插件压缩包不进预缓存，按需运行时缓存（StaleWhileRevalidate）
            urlPattern: ({ url }) => url.pathname.includes('/plugins/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fangzi-plugins',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            // 工具索引：网络优先，离线回退缓存
            urlPattern: ({ url }) => url.pathname.endsWith('/tools-index.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fangzi-tools-index',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 5 }
            }
          },
          {
            // AI 推理资源：自托管 onnx/whisper wasm 首次使用后离线复用。
            // 注意：/mf/ 同源模型（含分片合并）由 importScripts 的 sw-model-shards.js 专门处理，这里排除，避免 404 抢先响应。
            urlPattern: ({ url }) =>
              !url.pathname.startsWith('/mf/') &&
              (url.pathname.includes('/onnx/') ||
                url.pathname.includes('/whisper/') ||
                url.hostname.includes('huggingface.co')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fangzi-ai-models',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90 }
            }
          },
          {
            // 小票本 OCR：自托管 tesseract worker/wasm 与语言包（>5MB 不进预缓存），首次识别后离线复用
            urlPattern: ({ url }) => url.pathname.startsWith('/tessdata/') || url.pathname.startsWith('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fangzi-tesseract',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 90 }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // matter.js 物理引擎独立本地 chunk（打进包内、被 PWA 预缓存，断网可玩；零 CDN 运行时）
        manualChunks(id: string) {
          if (id.includes('matter-js')) return 'matter-physics'
          return undefined
        }
      }
    }
  }
})
