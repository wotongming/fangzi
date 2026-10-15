<script setup lang="ts">
/**
 * 电商上新模式（image-converter 子模式）：
 * 多平台规格 → 换底/留白 → 水印 → 批量重命名/按平台分目录 → ZIP + manifest.csv。
 * 复用现有批量队列、MODNet 抠图与计费框架；图片/底图/logo 全程仅在内存。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { fromDirectory, fromFileList, fromZip, runBatch, type BatchItem, type BatchTask } from '../lib/batch'
import { buildAccessSummary, consumeIfNeeded, type AccessSummary } from '../lib/monetization'
import { PLATFORM_PRESETS, getSeed, resolveSpec, kbToBytes } from '../ecom/presets'
import { processEcomImage } from '../ecom/compose'
import { buildEntryPath, buildManifestCsv, packZip, padIndex, renderName, type ManifestRow } from '../ecom/pack'
import { loadTemplate, saveTemplate } from '../ecom/templates'
import type { EcomBgMode, EcomFit, EcomFormat, EcomSpec, EcomWatermarkConf } from '../ecom/types'

const billing = useToolBilling('image-converter')
const summary = ref<AccessSummary>(buildAccessSummary(billing, billing.plan, billing.toolId))
watch(billing.billingVersion, () => {
  summary.value = buildAccessSummary(billing, billing.plan, billing.toolId)
})

// ---------- 导入 ----------
const items = ref<BatchItem[]>([])
function importFiles(files: FileList | null) {
  const list = fromFileList(files)
  if (list.length) {
    items.value = list
    resetRun()
  }
}
function importDir(e: Event) {
  const list = fromDirectory(Array.from((e.target as HTMLInputElement).files ?? []))
  if (list.length) {
    items.value = list
    resetRun()
  }
}
async function importZip(f: File | null) {
  if (!f) return
  try {
    items.value = await fromZip(f)
    resetRun()
  } catch {
    errorMsg.value = 'ZIP 解析失败，请确认文件未损坏'
  }
}

// ---------- 配置 ----------
const selectedKeys = ref<string[]>(['taobao-1x1-800'])
const outFormat = ref<EcomFormat>('image/jpeg')
const outQuality = ref(0.88)
const targetKb = ref(0)
const fitOverride = ref<EcomFit | ''>('')
const bgMode = ref<EcomBgMode>('none')
const bgColor = ref('#ffffff')
const bgImg = ref<HTMLImageElement | null>(null)
let bgUrl = ''
const wm = reactive<EcomWatermarkConf>({
  enabled: false,
  text: '',
  fontScale: 0.05,
  color: '#ffffff',
  opacity: 0.5,
  rotateDeg: 0,
  position: 'br',
  tile: false,
  tileGap: 0.28
})
const logoImg = ref<HTMLImageElement | null>(null)
let logoUrl = ''
const product = ref('')
const colorVar = ref('')
const nameTpl = ref('{product}_{platform}_{index}')

// 启动时恢复模板
;(() => {
  const t = loadTemplate()
  selectedKeys.value = t.specKeys
  product.value = t.product
  colorVar.value = t.color
  nameTpl.value = t.nameTpl
  Object.assign(wm, t.watermark)
  bgMode.value = t.bg.mode
  bgColor.value = t.bg.color
  const out = t.output
  if (out?.format) outFormat.value = out.format
  if (typeof out?.quality === 'number') outQuality.value = out.quality
  if (typeof out?.targetBytes === 'number') targetKb.value = Math.round(out.targetBytes / 1024)
  if (out?.fit) fitOverride.value = out.fit
})()

function persistTemplate() {
  saveTemplate({
    version: 1,
    name: '自定义上新模板',
    specKeys: selectedKeys.value,
    output: { format: outFormat.value, quality: outQuality.value, targetBytes: kbToBytes(targetKb.value), fit: fitOverride.value || undefined },
    bg: { mode: bgMode.value, color: bgColor.value },
    watermark: { ...wm },
    nameTpl: nameTpl.value,
    product: product.value,
    color: colorVar.value,
    updatedAt: Date.now()
  })
  savedHint.value = '模板已保存到本机'
  setTimeout(() => (savedHint.value = ''), 2000)
}
const savedHint = ref('')

function loadBgFile(f: File | null) {
  if (!f || !f.type.startsWith('image/')) return
  if (bgUrl) URL.revokeObjectURL(bgUrl)
  bgUrl = URL.createObjectURL(f)
  const img = new Image()
  img.onload = () => (bgImg.value = img)
  img.src = bgUrl
  bgMode.value = 'image'
}
function loadLogoFile(f: File | null) {
  if (!f || !f.type.startsWith('image/')) return
  if (logoUrl) URL.revokeObjectURL(logoUrl)
  logoUrl = URL.createObjectURL(f)
  const img = new Image()
  img.onload = () => (logoImg.value = img)
  img.src = logoUrl
}
onBeforeUnmount(() => {
  if (bgUrl) URL.revokeObjectURL(bgUrl)
  if (logoUrl) URL.revokeObjectURL(logoUrl)
})

function toggleSpec(key: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  selectedKeys.value = checked ? [...selectedKeys.value, key] : selectedKeys.value.filter((k) => k !== key)
}

const activeSpecs = computed<EcomSpec[]>(() =>
  selectedKeys.value
    .map((k) => getSeed(k))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((seed) =>
      resolveSpec(seed, {
        format: outFormat.value,
        quality: outQuality.value,
        targetBytes: kbToBytes(targetKb.value),
        fit: fitOverride.value || undefined,
        bgMode: bgMode.value,
        bgColor: bgColor.value
      })
    )
)

const outputCount = computed(() => items.value.length * activeSpecs.value.length)

const namePreview = computed(() => {
  if (!items.value.length) return '示例：商品名_taobao-1x1-800_01.jpg'
  const spec = activeSpecs.value[0]
  const base = items.value[0]!.name.replace(/\.[^.]+$/, '')
  const name = renderName(nameTpl.value, {
    base,
    product: product.value || base,
    color: colorVar.value || 'default',
    platform: spec?.key ?? 'platform',
    index: 1,
    ext: ''
  })
  return `${spec?.key ?? 'platform'}/${name}.${spec ? (spec.format === 'image/png' ? 'png' : spec.format === 'image/webp' ? 'webp' : 'jpg') : 'jpg'}`
})

// ---------- 运行 ----------
const running = ref(false)
const progress = ref({ done: 0, total: 0 })
const tasks = ref<BatchTask[]>([])
const errorMsg = ref('')
const zipOut = ref<{ url: string; size: number } | null>(null)
const resultPaths = new Map<string, { path: string; row: ManifestRow }>()

function resetRun() {
  tasks.value = []
  progress.value = { done: 0, total: 0 }
  zipOut.value = null
  resultPaths.clear()
}

const doneCount = computed(() => tasks.value.filter((t) => t.status === 'done').length)
const errorCount = computed(() => tasks.value.filter((t) => t.status === 'error').length)

async function start() {
  errorMsg.value = ''
  if (!items.value.length) {
    errorMsg.value = '请先导入商品图片（多选 / 文件夹 / ZIP）'
    return
  }
  if (!activeSpecs.value.length) {
    errorMsg.value = '请至少选择一个平台规格'
    return
  }
  if (!summary.value.unlocked) {
    errorMsg.value = '电商上新为专业批量能力，需解锁（见下方权益面板）'
    return
  }
  if (wm.enabled && wm.tile && !wm.text) {
    errorMsg.value = '已启用水印但未填写水印文字'
    return
  }
  resetRun()
  running.value = true

  // 展开为 原图 × 规格 的作业
  type EcomJob = BatchItem & { sourceId: string; spec: EcomSpec; sourceIndex: number }
  const jobs: EcomJob[] = []
  const total = items.value.length
  items.value.forEach((item, si) => {
    for (const spec of activeSpecs.value) {
      jobs.push({ id: `${item.id}::${spec.key}`, file: item.file, name: item.name, sourceId: item.id, spec, sourceIndex: si + 1 })
    }
  })
  progress.value = { done: 0, total: jobs.length }
  tasks.value = jobs.map((item) => ({ item, status: 'idle' as const }))
  const consumedSources = new Set<string>()

  try {
    await runBatch(
      jobs,
      async (_item, index) => {
        // runBatch 保证回调 index 与传入作业数组一致；用 index 取回带规格的扩展作业
        const job = jobs[index]!
        // 每个原图只扣一次免费/用量额度（而非每个规格）
        if (!consumedSources.has(job.sourceId)) {
          consumedSources.add(job.sourceId)
          consumeIfNeeded(summary.value, billing.toolId, billing.plan)
        }
        const base = job.name.replace(/\.[^.]+$/, '')
        const idx = padIndex(job.sourceIndex, total)
        const fileName = renderName(nameTpl.value, {
          base,
          product: product.value || base,
          color: colorVar.value || '',
          platform: job.spec.key,
          index: Number(idx),
          ext: ''
        })
        const ext = job.spec.format === 'image/png' ? 'png' : job.spec.format === 'image/webp' ? 'webp' : 'jpg'
        const out = await processEcomImage(job.file, job.spec, wm, { bgImage: bgImg.value, logo: logoImg.value })
        const path = buildEntryPath(job.spec.key, fileName, ext)
        const row: ManifestRow = {
          source: job.name,
          output: path,
          specLabel: job.spec.label,
          width: out.width,
          height: out.height,
          bytes: out.blob.size
        }
        resultPaths.set(job.id, { path, row })
        return { blob: out.blob, ext }
      },
      {
        concurrency: 1,
        cb: {
          onItem: (task, index) => {
            tasks.value = tasks.value.map((t, i) => (i === index ? task : t))
          },
          onProgress: (done, t) => (progress.value = { done, total: t })
        }
      }
    )
  } finally {
    running.value = false
    summary.value = buildAccessSummary(billing, billing.plan, billing.toolId)
  }
}

async function exportZip() {
  const ok = tasks.value.filter((t) => t.status === 'done' && t.result)
  if (!ok.length) {
    errorMsg.value = '没有可导出的结果'
    return
  }
  const entries = ok.map((t) => ({ path: resultPaths.get(t.item.id)!.path, blob: t.result!.blob }))
  const rows = ok.map((t) => resultPaths.get(t.item.id)!.row)
  const blob = await packZip(entries, buildManifestCsv(rows))
  if (zipOut.value?.url) URL.revokeObjectURL(zipOut.value.url)
  zipOut.value = { url: URL.createObjectURL(blob), size: blob.size }
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(2)} MB`
}
</script>

<template>
  <div class="ecom">
    <div class="card box">
      <h2>① 导入商品图</h2>
      <div class="import-row">
        <label class="btn">
          <input type="file" accept="image/*" multiple hidden @change="importFiles(($event.target as HTMLInputElement).files)" />
          选择多张图片
        </label>
        <label class="btn">
          <input type="file" webkitdirectory multiple hidden @change="importDir" />
          选择文件夹
        </label>
        <label class="btn">
          <input type="file" accept=".zip,application/zip" hidden @change="importZip(($event.target as HTMLInputElement).files?.[0] ?? null)" />
          导入 ZIP
        </label>
      </div>
      <p v-if="items.length" class="muted">已导入 {{ items.length }} 张原图，将产出 {{ outputCount }} 份规格图</p>
    </div>

    <div class="card box">
      <h2>② 选择平台规格（可多选，每个规格一个分目录）</h2>
      <div class="spec-grid">
        <label v-for="p in PLATFORM_PRESETS" :key="p.key" class="chk spec-item">
          <input type="checkbox" :checked="selectedKeys.includes(p.key)" @change="toggleSpec(p.key, $event)" />
          <span>{{ p.label }}</span>
        </label>
      </div>
      <div class="grid">
        <label>
          输出格式
          <select v-model="outFormat">
            <option value="image/jpeg">JPEG（平台通用、体积小）</option>
            <option value="image/webp">WebP</option>
            <option value="image/png">PNG（支持透明留白）</option>
          </select>
        </label>
        <label v-if="outFormat !== 'image/png'">
          质量 {{ Math.round(outQuality * 100) }}%
          <input v-model.number="outQuality" type="range" min="0.3" max="0.95" step="0.02" />
        </label>
        <label>
          目标体积 KB（0=不限，仅 JPEG/WebP）
          <input v-model.number="targetKb" type="number" min="0" step="50" placeholder="如 300" />
        </label>
        <label>
          比例适配（留空用各平台默认）
          <select v-model="fitOverride">
            <option value="">平台默认</option>
            <option value="cover">cover 裁剪铺满</option>
            <option value="contain">contain 完整留白</option>
          </select>
        </label>
      </div>
    </div>

    <div class="card box">
      <h2>③ 换底 / 白底图</h2>
      <div class="toggles">
        <label>
          方式
          <select v-model="bgMode">
            <option value="none">保持原图（不改底）</option>
            <option value="color">纯色底（AI 抠图后合成）</option>
            <option value="image">自定义底图（AI 抠图后合成）</option>
          </select>
        </label>
        <label v-if="bgMode === 'color'">底色 <input v-model="bgColor" type="color" /></label>
        <label v-if="bgMode === 'image'" class="btn">
          上传底图（仅本机内存）
          <input type="file" accept="image/*" hidden @change="loadBgFile(($event.target as HTMLInputElement).files?.[0] ?? null)" />
        </label>
      </div>
      <p v-if="bgMode !== 'none'" class="faint small">将调用本地 MODNet 抠出主体后合成到新底，发丝等细节以实际效果为准。</p>
    </div>

    <div class="card box">
      <h2>④ 水印</h2>
      <label class="chk"><input v-model="wm.enabled" type="checkbox" /> 启用文字水印</label>
      <div v-if="wm.enabled" class="grid">
        <label>水印文字<input v-model="wm.text" type="text" placeholder="店铺名 / 品牌名" /></label>
        <label>字号占短边 {{ Math.round(wm.fontScale * 100) }}%<input v-model.number="wm.fontScale" type="range" min="0.02" max="0.12" step="0.005" /></label>
        <label>颜色<input v-model="wm.color" type="color" /></label>
        <label>不透明度 {{ Math.round(wm.opacity * 100) }}%<input v-model.number="wm.opacity" type="range" min="0.1" max="1" step="0.05" /></label>
        <label>旋转 {{ wm.rotateDeg }}°<input v-model.number="wm.rotateDeg" type="range" min="-60" max="60" step="5" /></label>
        <label>
          位置
          <select v-model="wm.position">
            <option value="tl">左上</option><option value="tc">上中</option><option value="tr">右上</option>
            <option value="ml">左中</option><option value="mc">居中</option><option value="mr">右中</option>
            <option value="bl">左下</option><option value="bc">下中</option><option value="br">右下</option>
          </select>
        </label>
        <label class="chk"><input v-model="wm.tile" type="checkbox" /> 对角平铺</label>
        <label class="btn">
          叠加 logo（可选）
          <input type="file" accept="image/*" hidden @change="loadLogoFile(($event.target as HTMLInputElement).files?.[0] ?? null)" />
        </label>
      </div>
    </div>

    <div class="card box">
      <h2>⑤ 命名与分包</h2>
      <div class="grid">
        <label>商品名（{product}）<input v-model="product" type="text" placeholder="留空则用原文件名" /></label>
        <label>颜色/款式（{color}）<input v-model="colorVar" type="text" placeholder="如 red，可留空" /></label>
        <label class="wide">命名模板<input v-model="nameTpl" type="text" /></label>
      </div>
      <p class="faint small">可用变量：{base} 原名 · {product} 商品名 · {color} 颜色 · {platform} 平台 · {index} 序号</p>
      <p class="muted small">预览路径：{{ namePreview }}</p>
      <div class="actions">
        <button class="btn" @click="persistTemplate">保存为我的上新模板</button>
        <span v-if="savedHint" class="muted small">{{ savedHint }}</span>
      </div>
    </div>

    <div class="card box">
      <div class="actions">
        <button class="btn btn-primary" :disabled="running || !items.length || !activeSpecs.length" @click="start">
          {{ running ? `处理中 ${progress.done}/${progress.total}…` : `开始上新处理（${outputCount} 份）` }}
        </button>
      </div>
      <div v-if="running" class="bar"><i :style="{ width: progress.total ? (progress.done / progress.total) * 100 + '%' : '0%' }"></i></div>
      <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
      <p v-if="!summary.unlocked" class="faint small">电商上新随图片处理工作台买断/订阅/用量包解锁。</p>
    </div>

    <div v-if="tasks.length" class="card box">
      <h2>任务（{{ doneCount }} 成功 / {{ errorCount }} 失败 / {{ tasks.length - doneCount - errorCount }} 待处理）</h2>
      <ul class="task-list">
        <li v-for="t in tasks" :key="t.item.id" :class="t.status">
          <span class="name">{{ resultPaths.get(t.item.id)?.path ?? t.item.name }}</span>
          <span class="st">
            <template v-if="t.status === 'done'">{{ humanSize(t.result!.blob.size) }} · {{ t.ms?.toFixed(0) }}ms</template>
            <template v-else-if="t.status === 'error'">{{ t.error }}</template>
            <template v-else>{{ t.status === 'running' ? '处理中…' : '等待' }}</template>
          </span>
        </li>
      </ul>
      <div class="actions" v-if="doneCount && !running">
        <button class="btn btn-primary" @click="exportZip">导出上新资料包 ZIP（{{ doneCount }} 份，含 manifest.csv）</button>
      </div>
      <p v-if="zipOut" class="muted">ZIP 已生成：{{ humanSize(zipOut.size) }}</p>
    </div>
  </div>
</template>

<style scoped>
.ecom {
  display: grid;
  gap: 14px;
}
.spec-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}
.spec-item {
  gap: 8px;
  font-size: 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
}
.grid label.wide {
  flex-basis: 100%;
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
  margin-top: 12px;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--brand);
  transition: width 0.2s;
}
.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow: auto;
  display: grid;
  gap: 6px;
}
.task-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.task-list li.done {
  border-color: color-mix(in srgb, var(--brand) 50%, transparent);
}
.task-list li.error {
  border-color: var(--accent);
  color: var(--accent);
}
.task-list li.running {
  border-style: dashed;
}
.task-list .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-list .st {
  flex-shrink: 0;
  color: var(--text-2, inherit);
}
</style>
