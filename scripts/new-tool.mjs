#!/usr/bin/env node
/**
 * 工具脚手架：npm run new:tool -- <tool-id> <web|plugin> ["工具名称"]
 * 生成 manifest.ts / index.vue（web）/ guide.md（plugin）骨架，新增工具后无需改核心代码。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const [id, type = 'web', name = id] = process.argv.slice(2)

if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
  console.error('用法：npm run new:tool -- <kebab-case-id> <web|plugin> ["工具名称"]')
  process.exit(1)
}
if (!['web', 'plugin'].includes(type)) {
  console.error('类型必须是 web 或 plugin')
  process.exit(1)
}

const dir = join(root, 'src', 'tools', id)
if (existsSync(dir)) {
  console.error(`目录已存在：src/tools/${id}`)
  process.exit(1)
}
mkdirSync(dir, { recursive: true })

const today = new Date().toISOString().slice(0, 10)
const manifest = `import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: '${id}',
  name: ${JSON.stringify(name)},
  tagline: '一句话说明这个工具解决什么问题',
  category: 'work',
  type: '${type}',
  targetUsers: ['目标用户'],
  scenarios: ['具体使用场景（口语化，参与检索）'],
  painPoints: ['解决的痛点'],
  keywords: ['关键词', '同义词', '口语说法'],
  billing: { mode: 'free' },
  createdAt: '${today}',
  updatedAt: '${today}',
  version: '0.1.0',
  status: 'beta'${
    type === 'plugin'
      ? `,
  plugins: [
    {
      platform: 'browser-chromium',
      packageUrl: '/plugins/${id}/${id}-chrome-0.1.0.zip',
      sha256: '<打包后用 sha256sum 生成并回填>',
      sizeBytes: 0,
      version: '0.1.0',
      minHostVersion: 'Chrome 102 及以上'
    }
  ]`
      : ''
  }
}
`

const guide = `# ${name} · 用户指导

## 这个工具解决什么问题


## 怎么用
1.
2.

## 注意事项 / 边界

`

writeFileSync(join(dir, 'manifest.ts'), manifest)
writeFileSync(join(dir, 'guide.md'), guide)

if (type === 'web') {
  const vue = `<script setup lang="ts">
// 工具内部逻辑写在这里；需要计费时：
// import { useToolBilling } from '@/composables/useToolBilling'
// const billing = useToolBilling('${id}')
</script>

<template>
  <div class="card" style="padding: 24px">
    <h2>${name}</h2>
    <p class="muted">在这里实现工具界面与逻辑。</p>
  </div>
</template>
`
  writeFileSync(join(dir, 'index.vue'), vue)
}

console.log(`已生成工具骨架：src/tools/${id}/（type=${type}）`)
console.log('接下来：')
console.log('  1. 补全 manifest.ts 的关键词、场景、计费规则（质量决定搜索命中率）')
console.log('  2. ' + (type === 'web' ? '完善 index.vue 与 guide.md' : '编写 guide.md 手册，并把插件 zip 放到 public/plugins/' + id + '/'))
console.log('  3. 运行 npm run verify:tools 校验；并更新根 README 工具清单')
