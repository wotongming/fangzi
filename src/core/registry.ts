/**
 * 工具注册中心（可扩展框架核心）。
 *
 * 新增一个网页工具只需：
 *   src/tools/<tool-id>/manifest.ts   —— 工具元数据（名称/关键词/计费等）
 *   src/tools/<tool-id>/index.vue     —— 工具界面（type=web 时必需）
 *   src/tools/<tool-id>/guide.md      —— 用户使用指导（可选，详情页“用户指导”入口）
 *
 * 新增一个插件工具只需：
 *   src/tools/<tool-id>/manifest.ts   —— type=plugin，声明 plugins 下载包
 *   src/tools/<tool-id>/guide.md      —— 插件使用手册（插件工具必需）
 *   public/plugins/<tool-id>/*.zip    —— 可下载的插件压缩包
 *
 * 本文件用 import.meta.glob 自动发现，无需手动 import / 改路由表 / 改搜索逻辑。
 */

import type { Component } from 'vue'
import type { SearchDocument, ToolManifest } from './types'

interface ManifestModule {
  manifest: ToolManifest
}

const manifestModules = import.meta.glob<ManifestModule>('../tools/*/manifest.ts', { eager: true })
const componentLoaders = import.meta.glob<Component>('../tools/*/index.vue')
const guideRaw = import.meta.glob<string>('../tools/*/guide.md', {
  eager: true,
  query: '?raw',
  import: 'default'
})
// 回退：pipeline 工具的使用指导以 docs/guide_*.md 形式归档。root guide.md 优先；
// 若缺失则取该工具 docs/ 下第一份 guide 作为指导正文（截图为源码文档、不随站发布，需剥离图片引用避免裂图）。
const docsGuideRaw = import.meta.glob<string>('../tools/*/docs/guide_*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
})

function stripMdImages(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function resolveGuide(slug: string): string | null {
  const root = guideRaw[`../tools/${slug}/guide.md`]
  if (root && root.trim()) return root
  const prefix = `../tools/${slug}/docs/`
  const key = Object.keys(docsGuideRaw)
    .filter((p) => p.startsWith(prefix))
    .sort()[0]
  if (key) {
    const md = docsGuideRaw[key]
    if (md && md.trim()) return stripMdImages(md)
  }
  return null
}

export interface RegisteredTool {
  manifest: ToolManifest
  /** 网页工具的懒加载组件加载器；插件工具为 null */
  loadComponent: (() => Promise<Component>) | null
  /** 用户指导 / 插件手册 Markdown 原文 */
  guide: string | null
}

function slugFromPath(path: string): string {
  const m = path.match(/\.\.\/tools\/([^/]+)\//)
  if (!m) throw new Error(`无法从路径解析工具 id：${path}`)
  return m[1]!
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime())
}

function validate(tool: RegisteredTool, slug: string): void {
  const m = tool.manifest
  const problems: string[] = []
  if (m.id !== slug) problems.push(`manifest.id "${m.id}" 与目录名 "${slug}" 不一致`)
  if (!m.name) problems.push('缺少 name')
  if (!m.tagline) problems.push('缺少 tagline')
  if (!Array.isArray(m.keywords) || m.keywords.length === 0) problems.push('keywords 至少 1 个')
  if (!isValidDate(m.createdAt) || !isValidDate(m.updatedAt)) problems.push('日期需为 YYYY-MM-DD')
  if (m.updatedAt < m.createdAt) problems.push('updatedAt 不能早于 createdAt')
  if (!m.billing || !m.billing.mode) problems.push('缺少 billing.mode')

  if (m.type === 'web' && !tool.loadComponent) {
    problems.push('网页工具缺少 index.vue')
  }
  if (m.type === 'plugin') {
    if (!tool.guide) problems.push('插件工具缺少 guide.md 使用手册')
    if (!m.plugins || m.plugins.length === 0) problems.push('插件工具缺少 plugins 下载包声明')
    for (const p of m.plugins ?? []) {
      if (!p.packageUrl.startsWith('/plugins/')) problems.push('插件包需放在 /plugins/ 目录下')
      if (!/\.zip$/.test(p.packageUrl)) problems.push(`插件包应为 zip：${p.packageUrl}`)
      if (!p.version) problems.push('插件包缺少 version')
    }
  }
  if (m.billing.mode === 'buyout' && m.billing.priceCents === undefined)
    problems.push('buyout 模式需声明 priceCents')
  if (m.billing.mode === 'usage' && m.billing.pricePerUnitCents === undefined)
    problems.push('usage 模式需声明 pricePerUnitCents')

  if (problems.length) {
    throw new Error(`工具 [${slug}] 元数据不合法：\n - ${problems.join('\n - ')}`)
  }
}

function buildRegistry(): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  for (const [path, mod] of Object.entries(manifestModules)) {
    const slug = slugFromPath(path)
    const manifest = mod.manifest
    const componentPath = `../tools/${slug}/index.vue`
    const rawLoader = componentLoaders[componentPath]
    const tool: RegisteredTool = {
      manifest,
      loadComponent: rawLoader ? () => rawLoader().then((c) => (c as { default: Component }).default) : null,
      guide: resolveGuide(slug)
    }
    validate(tool, slug)
    tools.push(tool)
  }

  // id 唯一性
  const ids = new Set<string>()
  for (const t of tools) {
    if (ids.has(t.manifest.id)) throw new Error(`工具 id 重复：${t.manifest.id}`)
    ids.add(t.manifest.id)
  }

  // “最新工具”与列表稳定排序：按创建时间倒序、id 兜底
  tools.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt) || a.manifest.id.localeCompare(b.manifest.id))
  return tools
}

const registry = buildRegistry()

export function allTools(): RegisteredTool[] {
  return registry
}

export function getTool(id: string): RegisteredTool | undefined {
  return registry.find((t) => t.manifest.id === id)
}

export function toSearchDocument(m: ToolManifest): SearchDocument {
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    category: m.category,
    type: m.type,
    targetUsers: m.targetUsers,
    scenarios: m.scenarios,
    painPoints: m.painPoints,
    keywords: m.keywords,
    updatedAt: m.updatedAt
  }
}

/** 首页“最新工具”数量 */
export const LATEST_LIMIT = 6
