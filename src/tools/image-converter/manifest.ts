import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'image-converter',
  name: '图片格式转换压缩器',
  tagline: '本地把图片在 PNG/JPEG/WebP 间转换并压缩，控制质量与尺寸，不上传',
  category: 'work',
  type: 'web',
  targetUsers: ['运营', '自媒体', '开发者', '需要压缩证件照/截图的人'],
  scenarios: ['照片太大传不上系统，需要压缩到指定大小', '把 PNG 截图转成体积更小的 WebP', '批量限制图片最大宽度并导出'],
  painPoints: ['在线压缩担心隐私泄露且有水印', '系统只接受特定格式或限制 200KB/2MB'],
  keywords: ['图片转换', '图片压缩', 'webp', 'jpeg', 'png', '格式转换', '压缩图片', '改尺寸', '证件照压缩', '照片太大', 'image'],
  billing: {
    mode: 'buyout',
    currency: 'CNY',
    priceCents: 2990
  },
  createdAt: '2026-10-09',
  updatedAt: '2026-10-14',
  version: '1.0.0',
  status: 'beta'
}
