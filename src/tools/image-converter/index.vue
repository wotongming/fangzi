<script setup lang="ts">
/**
 * 图片处理工作台（image-converter v1.1.0）
 * 本地处理，数据不出端：单张转换压缩（默认）/ 裁剪 / AI 去背景 / AI 超分 / 批量工具链 / ZIP 导出
 * 变现：免费增值（基础转换免费）+ 买断 + 订阅 + 用量包 + 平台分成（订单走 fangzi 计费框架）
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import {
  runChain,
  validateChain,
  stripExif,
  type ConvertParams,
  type CropParams,
  type JobItem,
  type StepDef,
  type StepRuntime
} from './lib/pipeline'
import { detectRuntime, runtimeLabel } from './lib/ai/loader'
import { runAi } from './lib/ai/enhance'
import { fromDirectory, fromFileList, fromZip, runBatch, zipResults, type BatchItem, type BatchTask } from './lib/batch'
import { convertInWorker } from './lib/worker'
import {
  buildAccessSummary,
  consumeIfNeeded,
  purchase,
  type AccessSummary,
  type PurchasePath
} from './lib/monetization'

useSeo({
  title: '图片处理工作台 - 本地AI超分/去背景/批量压缩',
  description:
    '本地图片转换、压缩、批量工具链与 AI 增强（超分/去背景），全程本地处理不上传，支持 ZIP 批量导出。',
  type: 'SoftwareApplication',
  keywords: ['图片压缩', 'ai超分', '去背景', '抠图', '批量图片', '格式转换', '本地处理'],
  jsonLd: { offers: { '@type': 'Offer', price: '29.9', priceCurrency: 'CNY' } }
})

const billing = useToolBilling('image-converter')
const summary = ref<AccessSummary>(buildAccessSummary(billing, billing.plan, billing.toolId))
watch(billing.billingVersion, () => {
  summary.value = buildAccessSummary(billing, billing.plan, billing.toolId)
})

const runtime = ref<'webgpu' | 'wasm'>('wasm')
const supportsWebp = ref(true)
onMounted(async () => {
  runtime.value = await detectRuntime()
  const canvas = document.createElement('canvas')
  supportsWebp.value = canvas.toDataURL('image/webp').startsWith('data:image/webp')
})

const tab = ref<'single' | 'batch'>('single')
const buyingPath = ref<PurchasePath | null>(null)

// ---------- 单张模式 ----------
const file = ref<File | null>(null)
const format = ref<'image/webp' | 'image/jpeg' | 'image/png'>('image/webp')
const quality = ref(0.8)
const maxWidth = ref(1920)
const enableCrop = ref(false)
const cropW = ref(0)
const cropH = ref(0)
const cropMode = ref<'center' | 'top' | 'free'>('center')
const enableUpscale = ref(false)
const enableBgremove = ref(false)
const stripExifFlag = ref(false)

const beforeSize = ref(0)
const singleResult = ref<{ url: string; size: number; log: string[]; ext: string } | null>(null)
const working = ref(false)
const progress = ref(0)
const errorMsg = ref('')
const abortCtrl = ref<AbortController | null>(null)

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(2)} MB`
}

function loadImageBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解析失败'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, q?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), mime, q)
  })
}

async function convertOnMain(blob: Blob, p: ConvertParams): Promise<Blob> {
  const img = await loadImageBlob(blob)
  const scale = Math.min(1, p.maxWidth / img.naturalWidth)
  const outW = Math.max(1, Math.round(img.naturalWidth * scale))
  const outH = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  if (p.format === 'image/jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, outW, outH)
  }
  ctx.drawImage(img, 0, 0, outW, outH)
  return canvasToBlob(canvas, p.format, p.format === 'image/png' ? undefined : p.quality)
}

async function cropOnMain(blob: Blob, p: CropParams): Promise<Blob> {
  const img = await loadImageBlob(blob)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const cw = Math.max(1, Math.min(p.width > 0 ? p.width : W, W))
  const ch = Math.max(1, Math.min(p.height > 0 ? p.height : H, H))
  const sx = p.mode === 'free' && p.x != null ? Math.min(Math.max(0, p.x), W - cw) : Math.floor((W - cw) / 2)
  const sy =
    p.mode === 'top' ? 0 : p.mode === 'free' && p.y != null ? Math.min(Math.max(0, p.y), H - ch) : Math.floor((H - ch) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch)
  return canvasToBlob(canvas, 'image/png')
}

const stepRuntime: StepRuntime = {
  async run(step: StepDef, input: Blob, fileName: string): Promise<Blob> {
    switch (step.id) {
      case 'convert': {
        const p = step.params as ConvertParams
        // 优先 Worker 加速（OffscreenCanvas），失败回退主线程
        const wb = await convertInWorker(new File([input], fileName, { type: input.type }), {
          maxWidth: p.maxWidth,
          format: p.format,
          quality: p.quality
        })
        return wb ?? convertOnMain(input, p)
      }
      case 'crop':
        return cropOnMain(input, step.params as CropParams)
      case 'bgremove':
        return (await runAi('bgremove', input)).blob
      case 'upscale':
        return (await runAi('upscale', input)).blob
      default:
        throw new Error(`未知步骤：${step.id}`)
    }
  }
}

function hasAiStep(steps: StepDef[]): boolean {
  return steps.some((s) => s.enabled && (s.id === 'bgremove' || s.id === 'upscale'))
}

function consumeAiIfUsed(steps: StepDef[]): void {
  if (!hasAiStep(steps)) return
  consumeIfNeeded(summary.value, billing.toolId, billing.plan)
  summary.value = buildAccessSummary(billing, billing.plan, billing.toolId)
}

function singleSteps(): StepDef[] {
  const steps: StepDef[] = [
    { id: 'convert', label: '转换压缩', enabled: true, params: { format: format.value, quality: quality.value, maxWidth: maxWidth.value } as ConvertParams }
  ]
  if (enableCrop.value) {
    steps.push({ id: 'crop', label: '裁剪', enabled: true, params: { width: cropW.value, height: cropH.value, mode: cropMode.value } as CropParams })
  }
  if (enableBgremove.value) {
    steps.push({ id: 'bgremove', label: 'AI 去背景', enabled: summary.value.unlocked, params: { model: 'bgremove' } })
  }
  if (enableUpscale.value) {
    steps.push({ id: 'upscale', label: 'AI 超分 4x', enabled: summary.value.unlocked, params: { model: 'upscale' } })
  }
  return steps
}

async function pick(files: FileList | null) {
  const f = files?.[0]
  if (!f || !f.type.startsWith('image/')) return
  file.value = f
  beforeSize.value = f.size
  singleResult.value = null
  await processSingle()
}

async function processSingle() {
  if (!file.value) return
  const steps = singleSteps()
  const check = validateChain(steps)
  if (!check.ok) {
    errorMsg.value = check.error ?? '工具链不合法'
    return
  }
  if (hasAiStep(steps) && !summary.value.unlocked) {
    errorMsg.value = 'AI 增强需要解锁（买断 / 订阅 / 用量包），见下方权益面板'
    return
  }
  working.value = true
  errorMsg.value = ''
  progress.value = 0
  singleResult.value = null
  abortCtrl.value = new AbortController()
  try {
    const item: JobItem = { id: 'single', file: file.value }
    const r = await runChain(
      item,
      steps,
      stepRuntime,
      (_stepDef, i, total) => (progress.value = Math.round((i / total) * 100)),
      abortCtrl.value.signal
    )
    let blob = r.blob
    const log = [...r.stepLog]
    if (stripExifFlag.value) {
      blob = await stripExif(blob)
      log.push('清除 EXIF/GPS')
    }
    const prevUrl = currentResultUrl()
    const url = URL.createObjectURL(blob)
    singleResult.value = { url, size: blob.size, log, ext: r.ext }
    if (prevUrl) URL.revokeObjectURL(prevUrl)
    consumeAiIfUsed(steps)
    progress.value = 100
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '处理失败'
  } finally {
    working.value = false
  }
}

function cancelSingle() {
  abortCtrl.value?.abort()
  working.value = false
  errorMsg.value = '已取消'
}

function currentResultUrl(): string {
  return singleResult.value?.url ?? ''
}

function downloadResult() {
  if (!singleResult.value || !file.value) return
  const a = document.createElement('a')
  a.href = singleResult.value.url
  const base = file.value.name.replace(/\.[^.]+$/, '')
  a.download = `${base}.${singleResult.value.ext}`
  a.click()
}

// ---------- 批量工具链 ----------
const batchItems = ref<BatchItem[]>([])
const batchTasks = ref<BatchTask[]>([])
const batchRunning = ref(false)
const batchProgress = ref({ done: 0, total: 0 })
const batchConvert = ref(true)
const batchCrop = ref(false)
const batchUpscale = ref(false)
const batchBgremove = ref(false)
const batchError = ref('')
const batchZip = ref<{ url: string; size: number } | null>(null)

function resetBatch() {
  batchTasks.value = []
  batchProgress.value = { done: 0, total: 0 }
  batchZip.value = null
}

function importFiles(files: FileList | null) {
  const items = fromFileList(files)
  if (items.length) {
    batchItems.value = items
    resetBatch()
  }
}

function importDir(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  const items = fromDirectory(files)
  if (items.length) {
    batchItems.value = items
    resetBatch()
  }
}

async function importZipFile(f: File | null) {
  if (!f) return
  try {
    batchItems.value = await fromZip(f)
    resetBatch()
  } catch {
    batchError.value = 'ZIP 解析失败，请确认文件未损坏'
  }
}

function batchSteps(): StepDef[] {
  const steps: StepDef[] = []
  if (batchConvert.value) {
    steps.push({ id: 'convert', label: '转换压缩', enabled: true, params: { format: format.value, quality: quality.value, maxWidth: maxWidth.value } as ConvertParams })
  }
  if (batchCrop.value) {
    steps.push({ id: 'crop', label: '裁剪', enabled: true, params: { width: cropW.value, height: cropH.value, mode: cropMode.value } as CropParams })
  }
  if (batchBgremove.value) {
    steps.push({ id: 'bgremove', label: 'AI 去背景', enabled: summary.value.unlocked, params: { model: 'bgremove' } })
  }
  if (batchUpscale.value) {
    steps.push({ id: 'upscale', label: 'AI 超分 4x', enabled: summary.value.unlocked, params: { model: 'upscale' } })
  }
  return steps
}

async function startBatch() {
  if (!batchItems.value.length) {
    batchError.value = '请先导入图片（多选 / 文件夹 / ZIP）'
    return
  }
  if (!summary.value.unlocked) {
    batchError.value = '批量工具链需要解锁（买断 / 订阅 / 用量包），见下方权益面板'
    return
  }
  const steps = batchSteps()
  const check = validateChain(steps)
  if (!check.ok) {
    batchError.value = check.error ?? '工具链不合法'
    return
  }
  batchError.value = ''
  batchRunning.value = true
  batchZip.value = null
  batchTasks.value = batchItems.value.map((item) => ({ item, status: 'idle' as const }))
  batchProgress.value = { done: 0, total: batchItems.value.length }
  try {
    await runBatch(
      batchItems.value,
      async (item) => {
        const r = await runChain({ id: item.id, file: item.file }, steps, stepRuntime)
        consumeAiIfUsed(steps)
        return { blob: r.blob, ext: r.ext }
      },
      {
        concurrency: 1,
        cb: {
          onItem: (task, index) => {
            batchTasks.value = batchTasks.value.map((t, i) => (i === index ? task : t))
          },
          onProgress: (done, total) => (batchProgress.value = { done, total })
        }
      }
    )
  } finally {
    batchRunning.value = false
  }
}

async function exportZip() {
  const ok = batchTasks.value.filter((t) => t.status === 'done' && t.result)
  if (!ok.length) {
    batchError.value = '没有可导出的结果'
    return
  }
  const items = ok.map((t) => ({
    name: `${t.item.name.replace(/\.[^.]+$/, '')}.${t.result!.ext}`,
    blob: t.result!.blob
  }))
  const blob = await zipResults(items)
  if (batchZip.value?.url) URL.revokeObjectURL(batchZip.value.url)
  batchZip.value = { url: URL.createObjectURL(blob), size: blob.size }
}

const batchDoneCount = computed(() => batchTasks.value.filter((t) => t.status === 'done').length)
const batchErrorCount = computed(() => batchTasks.value.filter((t) => t.status === 'error').length)

// ---------- 变现 ----------
async function onPurchase(path: PurchasePath) {
  buyingPath.value = path
  try {
    await purchase(billing, path)
    summary.value = buildAccessSummary(billing, billing.plan, billing.toolId)
  } finally {
    buyingPath.value = null
  }
}

function yuan(cents?: number): string {
  if (cents == null) return ''
  return `¥${(cents / 100).toFixed(cents % 100 ? 1 : 0)}`
}
</script>

<template>
  <article class="tool-pad">
    <header class="card head">
      <h1>图片处理工作台</h1>
      <p class="tagline">
        本地转换、压缩、裁剪、批量工具链与 AI 超分/去背景 —— 图片不离开你的设备，模型首次使用按需下载并缓存。
      </p>
      <p class="badge-row">
        <span class="badge">{{ runtimeLabel(runtime) }}</span>
        <span class="badge">浏览器本地推理</span>
        <span v-if="summary.unlocked" class="badge badge-pro">已解锁 AI/批量</span>
        <span v-else class="badge badge-free">基础转换免费 · AI/批量需解锁</span>
      </p>
    </header>

    <nav class="tabs">
      <button :class="{ active: tab === 'single' }" @click="tab = 'single'">单张处理</button>
      <button :class="{ active: tab === 'batch' }" @click="tab = 'batch'">
        批量工具链{{ summary.unlocked ? '' : '（🔒）' }}
      </button>
    </nav>

    <!-- ================= 单张处理 ================= -->
    <section v-if="tab === 'single'" aria-label="单张处理">
      <label class="picker card">
        <input type="file" accept="image/*" hidden @change="pick(($event.target as HTMLInputElement).files)" />
        <span v-if="file">已选择：{{ file.name }}（再次选择可换图）</span>
        <span v-else>点击选择图片（仅在本地处理，不上传）</span>
      </label>

      <div class="card box controls">
        <h2>工具链设置</h2>
        <div class="grid">
          <label>
            输出格式
            <select v-model="format">
              <option value="image/webp" :disabled="!supportsWebp">WebP（体积最小）</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG（无损）</option>
            </select>
          </label>
          <label v-if="format !== 'image/png'">
            质量 {{ Math.round(quality * 100) }}%
            <input v-model.number="quality" type="range" min="0.3" max="1" step="0.05" />
          </label>
          <label>
            最大宽度 {{ maxWidth }}px
            <input v-model.number="maxWidth" type="range" min="120" max="4096" step="16" />
          </label>
        </div>

        <div class="toggles">
          <label class="chk"><input v-model="enableCrop" type="checkbox" /> 裁剪</label>
          <template v-if="enableCrop">
            <label>宽 <input v-model.number="cropW" type="number" min="0" placeholder="0=不限" /></label>
            <label>高 <input v-model.number="cropH" type="number" min="0" placeholder="0=不限" /></label>
            <select v-model="cropMode">
              <option value="center">居中</option>
              <option value="top">顶部对齐</option>
              <option value="free">自由起点</option>
            </select>
          </template>
          <label class="chk">
            <input v-model="enableBgremove" type="checkbox" :disabled="!summary.unlocked" /> AI 去背景
          </label>
          <label class="chk">
            <input v-model="enableUpscale" type="checkbox" :disabled="!summary.unlocked" /> AI 超分 4x
          </label>
          <label class="chk"><input v-model="stripExifFlag" type="checkbox" /> 清除 EXIF/GPS</label>
        </div>
        <p v-if="!summary.unlocked" class="faint small">AI 步骤需解锁后启用；基础转换始终免费。</p>

        <div class="actions">
          <button class="btn btn-primary" :disabled="working || !file" @click="processSingle">
            {{ working ? `处理中 ${progress}%…` : '开始处理' }}
          </button>
          <button v-if="working" class="btn" @click="cancelSingle">取消</button>
        </div>
      </div>

      <p v-if="errorMsg && tab === 'single'" class="err">{{ errorMsg }}</p>

      <div v-if="singleResult" class="card box result">
        <img :src="singleResult.url" alt="处理结果预览" />
        <div class="meta">
          <h2>处理结果</h2>
          <p>原始：{{ humanSize(beforeSize) }}</p>
          <p>处理后：<b>{{ humanSize(singleResult.size) }}</b></p>
          <p class="faint small">步骤：{{ singleResult.log.join(' → ') }}</p>
          <button class="btn btn-primary" @click="downloadResult" :disabled="working">下载 .{{ singleResult.ext }}</button>
        </div>
      </div>
    </section>

    <!-- ================= 批量工具链 ================= -->
    <section v-if="tab === 'batch'" aria-label="批量工具链">
      <div class="card box">
        <h2>导入图片</h2>
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
            <input type="file" accept=".zip,application/zip" hidden @change="importZipFile(($event.target as HTMLInputElement).files?.[0] ?? null)" />
            导入 ZIP
          </label>
        </div>
        <p v-if="batchItems.length" class="muted">已导入 {{ batchItems.length }} 张图片</p>
      </div>

      <div class="card box">
        <h2>工具链（步骤顺序执行）</h2>
        <div class="toggles">
          <label class="chk"><input v-model="batchConvert" type="checkbox" /> 转换压缩</label>
          <label class="chk"><input v-model="batchCrop" type="checkbox" /> 裁剪</label>
          <template v-if="batchCrop">
            <label>宽 <input v-model.number="cropW" type="number" min="0" placeholder="0=不限" /></label>
            <label>高 <input v-model.number="cropH" type="number" min="0" placeholder="0=不限" /></label>
            <select v-model="cropMode">
              <option value="center">居中</option>
              <option value="top">顶部对齐</option>
              <option value="free">自由起点</option>
            </select>
          </template>
          <label class="chk"><input v-model="batchBgremove" type="checkbox" :disabled="!summary.unlocked" /> AI 去背景</label>
          <label class="chk"><input v-model="batchUpscale" type="checkbox" :disabled="!summary.unlocked" /> AI 超分 4x</label>
        </div>
        <div class="actions">
          <button class="btn btn-primary" :disabled="batchRunning || !batchItems.length" @click="startBatch">
            {{ batchRunning ? `批量处理中 ${batchProgress.done}/${batchProgress.total}…` : '开始批量处理' }}
          </button>
        </div>
        <div v-if="batchRunning" class="bar"><i :style="{ width: batchProgress.total ? (batchProgress.done / batchProgress.total) * 100 + '%' : '0%' }"></i></div>
        <p v-if="batchError && tab === 'batch'" class="err">{{ batchError }}</p>
      </div>

      <div v-if="batchTasks.length" class="card box">
        <h2>任务列表（{{ batchDoneCount }} 成功 / {{ batchErrorCount }} 失败 / {{ batchTasks.length - batchDoneCount - batchErrorCount }} 待处理）</h2>
        <ul class="task-list">
          <li v-for="t in batchTasks" :key="t.item.id" :class="t.status">
            <span class="name">{{ t.item.name }}</span>
            <span class="st">
              <template v-if="t.status === 'done'">{{ humanSize(t.result!.blob.size) }} · {{ t.ms?.toFixed(0) }}ms</template>
              <template v-else-if="t.status === 'error'">{{ t.error }}</template>
              <template v-else>{{ t.status === 'running' ? '处理中…' : '等待' }}</template>
            </span>
          </li>
        </ul>
        <div class="actions" v-if="batchDoneCount && !batchRunning">
          <button class="btn btn-primary" @click="exportZip">导出 ZIP（{{ batchDoneCount }} 张）</button>
        </div>
        <p v-if="batchZip" class="muted">ZIP 已生成：{{ humanSize(batchZip.size) }}</p>
      </div>
    </section>

    <!-- ================= 权益面板（五种变现） ================= -->
    <section class="card box monet" aria-label="权益与变现">
      <h2>权益与解锁（本地演示支付，正式上线对接真实收银台）</h2>
      <p class="muted small">
        基础转换压缩：<b>免费</b>。AI 增强与批量工具链：买断 / 订阅 / 用量包任一即可使用；今日免费额度：{{
          summary.freeRemainingToday
        }} 张（用量包口径，用完自动消耗已购额度）。
      </p>
      <div class="monet-grid">
        <div class="monet-item" :class="{ owned: summary.buyoutOwned }">
          <h3>买断（推荐）</h3>
          <p class="price">{{ yuan(summary.prices.buyout) }} · 一次付费永久使用</p>
          <p class="faint small">解锁 AI/批量全部功能</p>
          <button v-if="!summary.buyoutOwned" class="btn btn-primary" :disabled="buyingPath === 'buyout'" @click="onPurchase('buyout')">
            {{ buyingPath === 'buyout' ? '支付中…' : '立即买断' }}
          </button>
          <span v-else class="owned-tag">已买断 ✓</span>
        </div>
        <div class="monet-item" :class="{ owned: summary.proOwned }">
          <h3>订阅</h3>
          <p class="price">{{ yuan(summary.prices.subscriptionMonth) }}/月 · {{ yuan(summary.prices.subscriptionYear) }}/年</p>
          <p class="faint small">订阅期内解锁 AI/批量全部功能</p>
          <div class="row">
            <button v-if="!summary.proOwned" class="btn" :disabled="buyingPath === 'subscription-month'" @click="onPurchase('subscription-month')">
              {{ buyingPath === 'subscription-month' ? '支付中…' : '订阅 月付' }}
            </button>
            <button v-if="!summary.proOwned" class="btn" :disabled="buyingPath === 'subscription-year'" @click="onPurchase('subscription-year')">
              {{ buyingPath === 'subscription-year' ? '支付中…' : '订阅 年付' }}
            </button>
            <span v-else class="owned-tag">订阅生效中 ✓</span>
          </div>
        </div>
        <div class="monet-item">
          <h3>用量包</h3>
          <p class="price">{{ yuan(summary.prices.usagePerUnit) }}/{{ billing.plan.usagePack?.unit ?? '张' }} ×100</p>
          <p class="faint small">不限时有效，先扣每日免费额度再扣用量包</p>
          <button class="btn" :disabled="buyingPath === 'usage-pack'" @click="onPurchase('usage-pack')">
            {{ buyingPath === 'usage-pack' ? '支付中…' : '购买 100 张用量包' }}
          </button>
        </div>
      </div>
      <p v-if="summary.split.enabled" class="faint small">
        平台分成：{{ summary.split.ratePct }}%（{{ summary.split.note }}）
      </p>
      <p class="faint small">
        已解锁状态：{{ summary.unlocked ? '可用' : '未解锁' }}（买断 {{ summary.buyoutOwned ? '✓' : '—' }} · 订阅 {{ summary.proOwned ? '✓' : '—' }} · 用量剩余 {{ summary.usage.remaining }} 张）
      </p>
    </section>
  </article>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.head {
  padding: 20px 22px;
}
.head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}
.tagline {
  margin: 0 0 8px;
  color: var(--text-2, inherit);
}
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
.badge {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--text-2, inherit);
}
.badge-pro {
  color: var(--brand-dark);
  border-color: var(--brand);
  background: color-mix(in srgb, var(--brand) 12%, transparent);
}
.badge-free {
  color: var(--accent);
  border-color: var(--accent);
}
.tabs {
  display: flex;
  gap: 8px;
}
.tabs button {
  padding: 8px 18px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}
.tabs button.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}
.picker {
  display: block;
  text-align: center;
  padding: 30px 20px;
  border: 2px dashed var(--line);
  cursor: pointer;
}
.picker:hover {
  border-color: var(--brand);
}
.box {
  padding: 16px 18px;
}
.box h2 {
  margin: 0 0 10px;
  font-size: 16px;
}
.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  min-width: 160px;
  flex: 1;
}
select,
input[type='range'],
input[type='number'] {
  padding: 6px 8px;
}
.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  margin-top: 12px;
}
.toggles label.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
}
.actions {
  margin-top: 14px;
  display: flex;
  gap: 10px;
}
.err {
  color: var(--accent);
  margin: 0;
  padding: 10px 14px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.result {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.result img {
  max-width: min(360px, 100%);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.meta {
  flex: 1;
  min-width: 220px;
}
.meta p {
  margin: 6px 0;
}
.import-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.import-row label.btn {
  cursor: pointer;
  display: inline-block;
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
.monet {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
}
.monet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 10px;
}
.monet-item {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
}
.monet-item.owned {
  border-color: var(--brand);
}
.monet-item h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.monet-item .price {
  font-weight: 700;
  color: var(--brand-dark);
  margin: 0 0 4px;
}
.owned-tag {
  color: var(--brand-dark);
  font-weight: 700;
  font-size: 13px;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.row .btn {
  padding: 6px 10px;
  font-size: 13px;
}
.btn {
  padding: 8px 16px;
}
</style>
