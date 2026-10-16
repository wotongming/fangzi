import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'image-converter',
  name: '图片处理工作台',
  tagline: '本地图片转换压缩、电商上新（多平台规格/换底/水印/资料包）、批量工具链与 AI 增强（超分/去背景），数据不出端、离线可用',
  category: 'work',
  type: 'web',
  targetUsers: ['运营', '自媒体', '电商卖家', '跨境卖家', '摄影师', 'HR/行政', '开发者', '需要压缩/增强证件照与老照片的人'],
  scenarios: [
    '照片太大传不上系统，需要压缩到指定大小并批量处理',
    '把 PNG 截图转成体积更小的 WebP，并批量限制最大宽度',
    '客户照片/商品图含隐私不能上传云端，需要在本地做 AI 超分与去背景',
    '老照片模糊需要本地超分修复，证件照需要去背景导出',
    '一次处理几百张商品图：压缩 → 裁剪 → 去背景 → 打包 ZIP 导出',
    '电商上新：一批商品图一次导出淘宝/京东/拼多多/小红书/跨境等多平台规格，自动白底、加水印、按平台分目录并打包'
  ],
  painPoints: [
    '在线压缩/去背景担心隐私泄露且有水印',
    '云端 AI 工具单张限制、按量收费、必须上传原图',
    '批量处理要逐张操作，工具链（压缩/裁剪/转换/AI 增强）无法串联',
    '系统只接受特定格式或限制 200KB/2MB',
    '上新要按多个平台不同尺寸/白底/水印逐张改图，耗时且云工具限张限分辨率'
  ],
  keywords: [
    '图片转换', '图片压缩', '批量压缩', 'webp', 'jpeg', 'png', '格式转换', '压缩图片', '改尺寸',
    '证件照压缩', '照片太大', 'ai超分', '图片放大', '超分辨率', '去背景', '抠图', '背景移除',
    '老照片修复', '批量图片', 'zip导出', '本地处理', '不上传', 'image', 'upscale', 'background removal',
    '电商上新', '商品图', '主图', '白底图', '换底色', '加水印', '批量水印', '淘宝主图', '小红书配图', '跨境电商图片', 'sku图'
  ],
  billing: {
    mode: 'buyout',
    currency: 'CNY',
    priceCents: 1990,
    features: [
      { key: 'convert', label: '格式转换与压缩', free: true },
      { key: 'batch', label: '批量处理与工具链', free: false },
      { key: 'ecom', label: '电商上新（多平台规格/换底/水印/资料包）', free: false },
      { key: 'ai', label: 'AI 增强（超分/去背景）', free: false }
    ],
    subscription: { priceCentsPerMonth: 690, priceCentsPerYear: 6900 },
    usagePack: { priceCentsPerUnit: 290, unit: '张', freePerDay: 3 },
    platformSplit: {
      enabled: true,
      partnerRatePct: 20,
      note: '支持渠道分销：合作站点按售价 20% 分成，订单通过计费框架统一记录。'
    }
  },
  createdAt: '2026-10-09',
  updatedAt: '2026-10-16',
  version: '1.2.0',
  status: 'stable',
  author: 'fangzi'
}
