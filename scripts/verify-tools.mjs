#!/usr/bin/env node
/**
 * 工具框架强校验（CI / 构建前可执行）：
 *  1. 每个工具 manifest 字段完整、日期合法、计费规则自洽、id 唯一
 *  2. 网页工具必须有 index.vue；插件工具必须有 guide.md 与可解压的 zip，且 sha256/大小与声明一致
 *  3. 首页示例提问用「真实关键词检索引擎」回归：每个示例的第 1 名必须是其声明的工具（保证一定搜得到）
 *
 * 运行：npm run verify:tools（经 tsx 加载器直接执行 TS 检索核心）
 */
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const toolsDir = join(root, 'src', 'tools')

const errors = []
const warn = (m) => errors.push(m)

const { SearchEngine } = await import('../src/core/search/search-engine.ts')
const { SAMPLE_QUERIES } = await import('../src/core/sample-queries.ts')

const ids = new Set()
const docs = []
const tools = []

for (const id of readdirSync(toolsDir)) {
  const dir = join(toolsDir, id)
  if (!statSync(dir).isDirectory()) continue
  const manifestPath = join(dir, 'manifest.ts')
  if (!existsSync(manifestPath)) {
    warn(`[${id}] 缺少 manifest.ts`)
    continue
  }
  const mod = await import(`../src/tools/${id}/manifest.ts`)
  const m = mod.manifest
  tools.push({ id, manifest: m, dir })

  if (m.id !== id) warn(`[${id}] manifest.id "${m.id}" 与目录名不一致`)
  if (ids.has(m.id)) warn(`[${id}] id 重复`)
  ids.add(m.id)

  for (const f of ['name', 'tagline']) if (!m[f]) warn(`[${id}] 缺少 ${f}`)
  for (const f of ['targetUsers', 'scenarios', 'painPoints', 'keywords'])
    if (!Array.isArray(m[f]) || m[f].length === 0) warn(`[${id}] ${f} 必须是非空数组`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.createdAt ?? '')) warn(`[${id}] createdAt 非法`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.updatedAt ?? '')) warn(`[${id}] updatedAt 非法`)
  if (m.updatedAt < m.createdAt) warn(`[${id}] updatedAt 早于 createdAt`)

  if (m.type === 'web' && !existsSync(join(dir, 'index.vue'))) warn(`[${id}] 网页工具缺少 index.vue`)
  if (m.type === 'plugin' && !existsSync(join(dir, 'guide.md'))) warn(`[${id}] 插件工具缺少 guide.md`)

  const b = m.billing
  if (!b?.mode) warn(`[${id}] 缺少 billing.mode`)
  if (b?.mode === 'buyout' && b.priceCents === undefined) warn(`[${id}] buyout 缺少 priceCents`)
  if (b?.mode === 'usage' && b.pricePerUnitCents === undefined) warn(`[${id}] usage 缺少 pricePerUnitCents`)
  if (b?.mode === 'freemium' && !Array.isArray(b.features)) warn(`[${id}] freemium 缺少 features 清单`)

  if (m.type === 'plugin') {
    if (!Array.isArray(m.plugins) || m.plugins.length === 0) warn(`[${id}] 插件缺少 plugins 声明`)
    for (const p of m.plugins ?? []) {
      if (!String(p.packageUrl).startsWith('/plugins/')) warn(`[${id}] 插件包路径必须在 /plugins/ 下`)
      const zipPath = join(root, 'public', p.packageUrl)
      if (!existsSync(zipPath)) {
        warn(`[${id}] 插件包不存在：${p.packageUrl}`)
        continue
      }
      const buf = readFileSync(zipPath)
      const sha = createHash('sha256').update(buf).digest('hex')
      if (p.sha256 && sha !== p.sha256) warn(`[${id}] zip 的 sha256 与声明不一致\n  实际 ${sha}`)
      if (p.sizeBytes && buf.length !== p.sizeBytes)
        warn(`[${id}] zip 大小 ${buf.length} 与声明 ${p.sizeBytes} 不一致`)
      // zip 可解压性
      try {
        execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' })
      } catch {
        warn(`[${id}] zip 无法通过 unzip -t 完整性测试`)
      }
    }
  }

  docs.push({
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
  })
}

// —— 示例提问回归：用真实关键词引擎，第 1 名必须命中声明工具 ——
const engine = new SearchEngine(docs)
for (const q of SAMPLE_QUERIES) {
  const res = await engine.search(q.text, { ai: null })
  const top = res.hits[0]
  if (!top) {
    warn(`示例提问无任何命中：「${q.text}」期望 ${q.expectToolId}`)
  } else if (top.doc.id !== q.expectToolId) {
    warn(
      `示例提问首条命中错误：「${q.text}」\n  期望 ${q.expectToolId}，实际 ${top.doc.id}（得分 ${top.score.toFixed(3)}）`
    )
  }
}

console.log(`校验工具数：${tools.length}`)
if (errors.length) {
  console.error('\n❌ 校验失败：\n - ' + errors.join('\n - '))
  process.exit(1)
}
console.log('✅ 全部 manifest、插件包与示例提问回归校验通过')
