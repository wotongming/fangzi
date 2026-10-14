# use-seo — GEO/AEO 友好元信息注入

为 SPA/PWA 页面注入动态 Title、Meta Description、Keywords 与 JSON-LD 结构化数据，
适配 2026 年 AI 搜索（GEO/AEO）趋势：让页面内容更容易被搜索引擎与 AI 引用。

- 位置：`use-seo/use-seo.ts`
- 依赖：Vue（`onUnmounted`；非 Vue 环境删掉该分支即可）
- 授权：MIT（fangzi 内部模块）
- 沉淀日期：2026-10-15（图片处理工作台 pipeline 001 沉淀）

## 快速开始

```ts
import { useSeo } from '@/composables/useSeo'

useSeo({
  title: '图片处理工作台 - 本地AI超分与去背景',
  description: '本地图片转换、压缩、批量工具链与 AI 增强（超分/去背景），数据不出端、离线可用。',
  type: 'SoftwareApplication',
  keywords: ['图片压缩', 'ai超分', '去背景', '批量图片'],
  jsonLd: { offers: { '@type': 'Offer', price: '29.9', priceCurrency: 'CNY' } }
})
```

## API

| 参数 | 说明 |
|---|---|
| `title` | 覆盖 `document.title`（含路由场景） |
| `description` | 覆盖 `meta[name=description]` |
| `type` | schema.org 类型，默认 `WebApplication` |
| `keywords` | 可选，写入 `meta[name=keywords]` 与 JSON-LD `keywords` |
| `jsonLd` | 额外 JSON-LD 字段，与默认对象浅合并 |
| `siteName` | 站点名，默认 `fangzi` |

## 说明

- 自动注入 `SoftwareApplication`（页面级）与 `WebSite`（站点级）两组 JSON-LD，均为 2026 年仍受支持的 evergreen 类型。
- 页面卸载时自动移除页面级 script 标签，避免多工具页切换后 schema 叠加污染。
- 配合语义化 HTML（`article/section`、规范 h1→h3 层级）使用效果最佳。
