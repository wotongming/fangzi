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
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
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
          // 同一 512 图标同时提供 maskable 用途，保证安卓启动器遮罩与安装校验都命中
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // 预缓存构建产物与静态应用外壳
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        globIgnores: ['plugins/**', 'tools-index.json'],
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
            // AI 推理资源：自托管 onnx/whisper wasm 与 HF 模型文件，首次使用后离线可复用
            urlPattern: ({ url }) =>
              url.pathname.includes('/onnx/') ||
              url.pathname.includes('/whisper/') ||
              url.hostname.includes('huggingface.co'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fangzi-ai-models',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90 }
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
    chunkSizeWarningLimit: 900
  }
})
