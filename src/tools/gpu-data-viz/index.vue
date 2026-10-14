<script setup lang="ts">
/**
 * GPU 大数据可视化面板（gpu-data-viz v1.0.0）
 * 本地处理，数据不出端：CSV/TSV/JSON 拖入 → GPU（WebGPU/WebGL2/Canvas2D）百万点渲染 → 缩放/平移/刷选 → PNG/CSV 导出。
 * 变现：免费增值（≤50 万点免费）+ 买断 + 订阅 + 用量包 + 平台分成（订单走 fangzi 计费框架）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { VizController, type InteractionMode } from './lib/chart'
import { detectBackend, type DetectResult } from './lib/render/detect'
import { buildDataset, inspectFile, inspectText, type InspectInfo } from './lib/loader'
import { makeSampleDataset } from './lib/sample'
import { formatCount, formatNumber, formatValue } from './lib/format'
import { exportPng, exportRawCsv, exportSelectionCsv } from './lib/export'
import { buildAccessSummary, consumeIfNeeded, purchase, type AccessSummary, type PurchasePath } from './lib/monetization'
import { FREE_POINT_LIMIT } from './lib/store'
import type { BackendKind, ChartType, Dataset, PointStats } from './lib/types'

useSeo({
  title: 'GPU大数据可视化面板 - 百万点CSV 60fps本地分析',
  description:
    '浏览器内 WebGPU/WebGL 加速的百万级数据点可视化：拖入 CSV/JSON 即绘散点密度、热力、折线图，缩放刷选、导出报告，数据全程本地不上传。',
  type: 'SoftwareApplication',
  keywords: ['webgpu', '大数据可视化', '百万点', 'csv 图表', '散点图', '热力图', '本地分析'],
  jsonLd: { offers: { '@type': 'Offer', price: '49.9', priceCurrency: 'CNY' } }
})

const billing = useToolBilling('gpu-data-viz')
const summary = ref<AccessSummary>(buildAccessSummary(billing, billing.plan, billing.toolId))
watch(billing.billingVersion, () => {
  summary.value = buildAccessSummary(billing, billing.plan, billing.toolId)
})

// ---------- 渲染后端 ----------
const dataCanvas = ref<HTMLCanvasElement | null>(null)
const hudCanvas = ref<HTMLCanvasElement | null>(null)
let controller: VizController | null = null
const backend = ref<BackendKind | null>(null)
const backendLabel = ref('正在探测 GPU 能力…')
const backendWarn = ref('')
const fps = ref(0)
const zoom = ref(1)
const hoverText = ref('')

// ---------- 数据载入 ----------
const dragging = ref(false)
const loading = ref(false)
const loadPhase = ref('')
const progressPct = ref(0)
const errorMsg = ref('')
const info = ref<InspectInfo | null>(null)
const dataset = ref<Dataset | null>(null)
const xIdx = ref(0)
const yIdx = ref(1)
const pasteText = ref('')
const showPaste = ref(false)

const chart = ref<ChartType>('scatter')
const mode = ref<InteractionMode>('pan')
const brushStats = ref<PointStats | null>(null)
const buyingPath = ref<PurchasePath | null>(null)
const showEmbed = ref(false)
const embedCode = ref('')
const copied = ref(false)

const numericColumns = computed(() =>
  info.value ? info.value.headers.map((name, i) => ({ name, i, type: info.value!.types[i]! })).filter((c) => c.type !== 'string') : []
)

/** 按权益计算本次允许载入的点数上限 */
const effectiveLimit = computed(() => (summary.value.unlocked ? Number.MAX_SAFE_INTEGER : FREE_POINT_LIMIT))
const willLoad = computed(() => (info.value ? Math.min(info.value.totalRows, effectiveLimit.value) : 0))

function yuan(cents?: number): string {
  return cents === undefined ? '—' : billing.priceText(cents)
}

async function pickFile(files: FileList | null): Promise<void> {
  const file = files?.[0]
  if (!file) return
  errorMsg.value = ''
  loadPhase.value = '正在扫描文件结构…'
  loading.value = true
  try {
    const inspected = await inspectFile(file)
    info.value = inspected
    dataset.value = null
    const nums = inspected.headers.map((_, i) => i).filter((i) => inspected.types[i] !== 'string')
    if (nums.length < 2) throw new Error('文件中至少需要两个数值或日期列')
    xIdx.value = nums[0]!
    yIdx.value = nums[1]!
    loadPhase.value = ''
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    info.value = null
  } finally {
    loading.value = false
  }
}

function onDrop(e: DragEvent): void {
  dragging.value = false
  void pickFile(e.dataTransfer?.files ?? null)
}

async function loadPasted(): Promise<void> {
  const text = pasteText.value.trim()
  if (!text) {
    errorMsg.value = '请先粘贴 CSV/JSON 数据'
    return
  }
  errorMsg.value = ''
  loading.value = true
  loadPhase.value = '正在解析粘贴数据…'
  try {
    const inspected = inspectText(text)
    info.value = inspected
    const nums = inspected.headers.map((_, i) => i).filter((i) => inspected.types[i] !== 'string')
    if (nums.length < 2) throw new Error('至少需要两个数值或日期列')
    xIdx.value = nums[0]!
    yIdx.value = nums[1]!
    await doBuild()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
    loadPhase.value = ''
  }
}

async function doBuild(): Promise<void> {
  if (!info.value) return
  errorMsg.value = ''
  loading.value = true
  loadPhase.value = '正在载入并归一化数据…'
  progressPct.value = 0
  try {
    const ds = await buildDataset(info.value, xIdx.value, yIdx.value, effectiveLimit.value, (loaded, total) => {
      progressPct.value = total > 0 ? Math.round((loaded / Math.min(total, effectiveLimit.value)) * 100) : 0
    })
    dataset.value = ds
    brushStats.value = null
    chart.value = 'scatter'
    controller?.setChart('scatter')
    controller?.setDataset(ds)
    loadPhase.value = ''
    if (ds.truncated) {
      errorMsg.value = `免费版已载入前 ${formatNumber(FREE_POINT_LIMIT)} 点，源文件共 ${formatNumber(ds.totalRows)} 点；解锁专业版可全量载入。`
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
    progressPct.value = 0
  }
}

async function loadSample(): Promise<void> {
  errorMsg.value = ''
  loading.value = true
  loadPhase.value = '正在生成 100 万示例点…'
  try {
    // 让出一帧渲染 loading
    await new Promise((r) => setTimeout(r, 30))
    const n = summary.value.unlocked ? 1_000_000 : Math.min(500_000, FREE_POINT_LIMIT)
    const ds = makeSampleDataset(n)
    info.value = null
    dataset.value = ds
    brushStats.value = null
    chart.value = 'scatter'
    controller?.setChart('scatter')
    controller?.setDataset(ds)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
    loadPhase.value = ''
  }
}

// ---------- 图表交互 ----------
function setChart(c: ChartType): void {
  chart.value = c
  controller?.setChart(c)
}
function setMode(m: InteractionMode): void {
  mode.value = m
  controller?.setMode(m)
}
function zoomBy(f: number): void {
  controller?.zoom(f)
}
function resetView(): void {
  controller?.resetView()
}
function clearBrush(): void {
  brushStats.value = null
  mode.value = 'pan'
  controller?.clearBrush()
}

// ---------- 导出 ----------
function requirePro(): boolean {
  if (summary.value.unlocked) return true
  errorMsg.value = '该操作属于专业能力（买断 / 订阅 / 用量包任一即可），见下方权益面板。'
  return false
}

function doExportPng(): void {
  if (!controller || !dataset.value) return
  exportPng(controller.getDataCanvas(), controller.getHudCanvas(), dataset.value.sourceName)
}

function doExportSelection(): void {
  if (!controller || !dataset.value) return
  if (!requirePro()) return
  const sel = controller.getSelection()
  consumeIfNeeded(summary.value, billing.toolId, billing.plan)
  summary.value = buildAccessSummary(billing, billing.plan, billing.toolId)
  exportSelectionCsv(dataset.value, sel.length > 0 ? sel : undefined)
}

function doExportRaw(): void {
  if (!dataset.value) return
  if (!requirePro()) return
  if (!exportRawCsv(dataset.value)) errorMsg.value = '该数据集较大或来自示例数据，请使用「导出选区/全部（X/Y）」。'
}

function openEmbed(): void {
  if (!requirePro()) return
  const origin = typeof location !== 'undefined' ? location.origin : 'https://你的域名'
  embedCode.value = `<!-- 方子 GPU 大数据可视化面板 · 嵌入式图表（部署后将域名替换为你的 EdgeOne Pages 域名） -->
<iframe
  src="${origin}/#/t/gpu-data-viz?embed=1"
  title="GPU 大数据可视化面板"
  width="960" height="600"
  style="border:1px solid #e3e0d8;border-radius:12px"
  loading="lazy" allow="clipboard-write"></iframe>`
  showEmbed.value = true
}

async function copyEmbed(): Promise<void> {
  try {
    await navigator.clipboard.writeText(embedCode.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    errorMsg.value = '复制失败，请手动选择文本复制。'
  }
}

// ---------- 付费 ----------
async function onPurchase(path: PurchasePath): Promise<void> {
  buyingPath.value = path
  errorMsg.value = ''
  try {
    await purchase(billing, path)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    buyingPath.value = null
  }
}

// ---------- 生命周期 ----------
// 注意：图表 canvas 位于 v-if="dataset" 的区块内，组件 onMounted 时尚未挂载，
// 因此不能在 onMounted 里初始化渲染器；改为在 dataset 就绪、DOM 更新后（post watcher）初始化。
let initTried = false
async function ensureController(): Promise<void> {
  if (initTried || !dataset.value || !dataCanvas.value || !hudCanvas.value) return
  initTried = true
  let detect: DetectResult
  try {
    detect = await detectBackend()
  } catch {
    detect = { backend: 'canvas2d', label: 'Canvas2D（CPU 模式）' }
  }
  backendLabel.value = detect.label
  backendWarn.value = detect.webgpuError ?? ''
  controller = new VizController(dataCanvas.value, hudCanvas.value, {
    onBackend: (kind, err) => {
      backend.value = kind
      if (err) backendWarn.value = err
    },
    onViewChange: (z) => (zoom.value = z),
    onHover: (t) => (hoverText.value = t),
    onBrush: (s) => (brushStats.value = s),
    onFps: (f) => (fps.value = f)
  })
  controller.attach()
  try {
    await controller.init(detect.backend)
    backend.value = detect.backend
    // canvas 晚于数据挂载：初始化完成后把当前数据集与图型补灌进渲染器
    controller.setDataset(dataset.value)
    controller.setChart(chart.value)
    controller.setMode(mode.value)
  } catch (e) {
    backendLabel.value = '渲染后端初始化失败'
    backendWarn.value = e instanceof Error ? e.message : String(e)
  }
}

watch(dataset, () => void ensureController(), { flush: 'post' })
onMounted(() => void ensureController())
onBeforeUnmount(() => controller?.destroy())

const backendBadgeClass = computed(() => `badge badge-${backend.value ?? 'detect'}`)
</script>

<template>
  <article class="viz tool-pad">
    <header class="card head">
      <h1>GPU 大数据可视化面板</h1>
      <p class="tagline muted">百万级数据点浏览器内 60fps 分析：拖入 CSV/TSV/JSON，GPU 聚合渲染、缩放刷选、导出报告，数据全程不出端。</p>
      <div class="badge-row">
        <span :class="backendBadgeClass">{{ backendLabel }}</span>
        <span class="badge badge-muted">FPS {{ fps }}</span>
        <span class="badge badge-muted">缩放 {{ zoom.toFixed(1) }}×</span>
        <span v-if="dataset" class="badge badge-muted">已载入 {{ formatCount(dataset.rowCount) }} 点</span>
      </div>
      <p v-if="backendWarn" class="faint small warn-text">{{ backendWarn }}（已自动切换兼容后端，不影响使用）</p>
    </header>

    <!-- 数据导入 -->
    <section class="card box" aria-label="数据导入">
      <h2>1. 导入数据</h2>
      <div
        class="dropzone"
        :class="{ active: dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <p>把 <b>.csv / .tsv / .json</b> 文件拖到这里，或</p>
        <label class="btn btn-primary">
          选择文件
          <input type="file" accept=".csv,.tsv,.txt,.json" class="hidden-file" @change="pickFile(($event.target as HTMLInputElement).files)" />
        </label>
        <button class="btn btn-link" @click="showPaste = !showPaste">{{ showPaste ? '收起粘贴框' : '直接粘贴数据' }}</button>
        <button class="btn btn-link" @click="loadSample">载入 100 万点示例</button>
      </div>
      <div v-if="showPaste" class="paste-box">
        <textarea
          v-model="pasteText"
          rows="5"
          placeholder="首行表头，例如：&#10;时间,温度&#10;2026-10-01 00:00,72.3&#10;2026-10-01 00:01,73.1&#10;也支持 [{&quot;x&quot;:1,&quot;y&quot;:2}] 对象数组 JSON"
        ></textarea>
        <button class="btn" :disabled="loading" @click="loadPasted">解析并载入</button>
      </div>

      <div v-if="loading" class="loading-row">
        <span class="spinner"></span>
        <span>{{ loadPhase }}</span>
        <span v-if="progressPct > 0" class="muted small">{{ progressPct }}%</span>
      </div>
      <p v-if="errorMsg" class="error-text small">{{ errorMsg }}</p>

      <!-- 轴选择 -->
      <div v-if="info && !dataset" class="axis-box">
        <p class="muted small">检测到 {{ formatNumber(info.totalRows) }} 行、{{ info.headers.length }} 列。选择坐标轴后载入：</p>
        <div class="axis-row">
          <label>
            X 轴
            <select v-model.number="xIdx">
              <option v-for="c in numericColumns" :key="c.i" :value="c.i">{{ c.name }}（{{ c.type }}）</option>
            </select>
          </label>
          <label>
            Y 轴
            <select v-model.number="yIdx">
              <option v-for="c in numericColumns" :key="c.i" :value="c.i">{{ c.name }}（{{ c.type }}）</option>
            </select>
          </label>
          <button class="btn btn-primary" :disabled="loading || xIdx === yIdx" @click="doBuild">
            载入 {{ formatCount(willLoad) }} 点
          </button>
        </div>
        <p v-if="xIdx === yIdx" class="error-text small">X 轴与 Y 轴不能是同一列。</p>
        <p v-if="info.totalRows > FREE_POINT_LIMIT && !summary.unlocked" class="faint small">
          文件 {{ formatNumber(info.totalRows) }} 行超过免费额度，本次载入前 {{ formatNumber(FREE_POINT_LIMIT) }} 点；解锁专业版可全量载入。
        </p>
      </div>
    </section>

    <!-- 图表区 -->
    <section v-if="dataset" class="card box" aria-label="图表">
      <div class="toolbar">
        <div class="seg">
          <button :class="{ on: chart === 'scatter' }" @click="setChart('scatter')">散点密度</button>
          <button :class="{ on: chart === 'heatmap' }" @click="setChart('heatmap')">热力图</button>
          <button :class="{ on: chart === 'line' }" @click="setChart('line')">折线（按列均值）</button>
        </div>
        <div class="seg">
          <button :class="{ on: mode === 'pan' }" @click="setMode('pan')">✋ 平移</button>
          <button :class="{ on: mode === 'brush' }" @click="setMode('brush')">▱ 框选</button>
        </div>
        <div class="seg">
          <button @click="zoomBy(1 / 1.3)" title="放大">＋</button>
          <button @click="zoomBy(1.3)" title="缩小">－</button>
          <button @click="resetView">重置</button>
        </div>
        <div class="seg">
          <button @click="doExportPng">导出 PNG</button>
          <button @click="doExportSelection">{{ brushStats ? '导出选区 CSV' : '导出 CSV（X/Y）' }}</button>
          <button v-if="dataset.rawLines" @click="doExportRaw">导出原始行</button>
          <button @click="openEmbed">嵌入组件</button>
        </div>
      </div>

      <div class="canvas-wrap">
        <canvas ref="dataCanvas" class="layer data-layer"></canvas>
        <canvas ref="hudCanvas" class="layer hud-layer"></canvas>
        <div v-if="loading" class="canvas-mask">{{ loadPhase }} {{ progressPct > 0 ? progressPct + '%' : '' }}</div>
      </div>

      <div class="stat-bar">
        <span class="muted small">{{ hoverText || '滚轮缩放 · 拖拽平移 · 切换框选后拖出矩形筛选（双击般的极小拖动可清除选区）' }}</span>
      </div>

      <div v-if="brushStats" class="card brush-card">
        <div class="brush-head">
          <b>选区统计（{{ formatNumber(brushStats.count) }} 点）</b>
          <button class="btn btn-link" @click="clearBrush">清除选区</button>
        </div>
        <div class="brush-grid">
          <div><span>{{ dataset.xMeta.name }}</span>min <b>{{ formatValue(brushStats.xMin, dataset.xMeta.type) }}</b></div>
          <div><span>{{ dataset.xMeta.name }}</span>avg <b>{{ formatValue(brushStats.xAvg, dataset.xMeta.type) }}</b></div>
          <div><span>{{ dataset.xMeta.name }}</span>max <b>{{ formatValue(brushStats.xMax, dataset.xMeta.type) }}</b></div>
          <div><span>{{ dataset.yMeta.name }}</span>min <b>{{ formatValue(brushStats.yMin, dataset.yMeta.type) }}</b></div>
          <div><span>{{ dataset.yMeta.name }}</span>avg <b>{{ formatValue(brushStats.yAvg, dataset.yMeta.type) }}</b></div>
          <div><span>{{ dataset.yMeta.name }}</span>max <b>{{ formatValue(brushStats.yMax, dataset.yMeta.type) }}</b></div>
        </div>
      </div>
    </section>

    <!-- 嵌入代码弹层 -->
    <div v-if="showEmbed" class="modal-mask" @click.self="showEmbed = false">
      <div class="card modal">
        <h2>嵌入式图表组件</h2>
        <p class="muted small">把下方 iframe 代码放入你自己的网页/系统，用户即可在你的页面内使用该 GPU 面板（数据仍在各自浏览器本地处理）。</p>
        <textarea v-model="embedCode" rows="8" readonly></textarea>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="copyEmbed">{{ copied ? '已复制 ✓' : '复制代码' }}</button>
          <button class="btn" @click="showEmbed = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 权益面板（五种变现） -->
    <section class="card box monet" aria-label="权益与变现">
      <h2>权益与解锁（本地演示支付，正式上线对接真实收银台）</h2>
      <p class="muted small">
        免费层：单次 ≤{{ formatNumber(summary.freePointLimit) }} 点、三种图型、缩放平移刷选、PNG 截图。专业能力：全量数据（百万级）、CSV/报告导出、嵌入组件。
        买断 / 订阅 / 用量包任一即可；今日免费专业操作剩余 {{ summary.freeRemainingToday }} 次。
      </p>
      <div class="monet-grid">
        <div class="monet-item" :class="{ owned: summary.buyoutOwned }">
          <h3>买断（推荐）</h3>
          <p class="price">{{ yuan(summary.prices.buyout) }} · 一次付费永久使用</p>
          <p class="faint small">解锁全部专业能力</p>
          <button v-if="!summary.buyoutOwned" class="btn btn-primary" :disabled="buyingPath === 'buyout'" @click="onPurchase('buyout')">
            {{ buyingPath === 'buyout' ? '支付中…' : '立即买断' }}
          </button>
          <span v-else class="owned-tag">已买断 ✓</span>
        </div>
        <div class="monet-item" :class="{ owned: summary.proOwned }">
          <h3>订阅</h3>
          <p class="price">{{ yuan(summary.prices.subscriptionMonth) }}/月 · {{ yuan(summary.prices.subscriptionYear) }}/年</p>
          <p class="faint small">订阅期内解锁全部专业能力</p>
          <div class="row">
            <button v-if="!summary.proOwned" class="btn" :disabled="buyingPath === 'subscription-month'" @click="onPurchase('subscription-month')">
              {{ buyingPath === 'subscription-month' ? '支付中…' : '月付' }}
            </button>
            <button v-if="!summary.proOwned" class="btn" :disabled="buyingPath === 'subscription-year'" @click="onPurchase('subscription-year')">
              {{ buyingPath === 'subscription-year' ? '支付中…' : '年付' }}
            </button>
            <span v-else class="owned-tag">订阅生效中 ✓</span>
          </div>
        </div>
        <div class="monet-item">
          <h3>用量包</h3>
          <p class="price">{{ yuan(summary.prices.usagePerUnit) }}/次 ×50</p>
          <p class="faint small">不限时有效，先扣每日 2 次免费额度再扣用量包</p>
          <button class="btn" :disabled="buyingPath === 'usage-pack'" @click="onPurchase('usage-pack')">
            {{ buyingPath === 'usage-pack' ? '支付中…' : '购买 50 次用量包' }}
          </button>
        </div>
      </div>
      <p v-if="summary.split.enabled" class="faint small">平台分成：{{ summary.split.ratePct }}%（{{ summary.split.note }}）</p>
    </section>
  </article>
</template>

<style scoped>
.viz {
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
  margin: 0 0 10px;
}
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.badge {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(63, 125, 94, 0.25);
}
.badge-webgpu {
  background: #e8f4ee;
  color: #2f6f51;
}
.badge-webgl2 {
  background: #eef2fb;
  color: #3b5794;
}
.badge-canvas2d {
  background: #f6efe2;
  color: #8a6420;
}
.badge-detect,
.badge-muted {
  background: #f1f0ea;
  color: #5b6560;
  border-color: rgba(0, 0, 0, 0.08);
}
.warn-text {
  margin: 8px 0 0;
  color: #9a6a1a;
}
.box {
  padding: 18px 20px;
}
.box h2 {
  margin: 0 0 12px;
  font-size: 16px;
}
.dropzone {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 20px;
  border: 1.5px dashed #c9c6ba;
  border-radius: 12px;
  background: #fbfaf6;
}
.dropzone.active {
  border-color: #3f7d5e;
  background: #eef6f1;
}
.hidden-file {
  display: none;
}
.btn {
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid #d2cfc4;
  background: #fff;
  color: #333c38;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-primary {
  background: #3f7d5e;
  border-color: #3f7d5e;
  color: #fff;
}
.btn-link {
  border: none;
  background: none;
  color: #2f6f51;
  text-decoration: underline;
}
.paste-box {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}
.paste-box textarea,
.modal textarea {
  width: 100%;
  border: 1px solid #d2cfc4;
  border-radius: 8px;
  padding: 10px;
  font: inherit;
  box-sizing: border-box;
  resize: vertical;
}
.loading-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid #cfe0d7;
  border-top-color: #3f7d5e;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.error-text {
  color: #b3432f;
  margin: 8px 0 0;
}
.axis-box {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #ece9df;
}
.axis-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  margin-top: 8px;
}
.axis-row label {
  font-size: 13px;
  display: grid;
  gap: 4px;
}
.axis-row select {
  padding: 7px 10px;
  border: 1px solid #d2cfc4;
  border-radius: 8px;
  min-width: 180px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.seg {
  display: inline-flex;
  border: 1px solid #d2cfc4;
  border-radius: 8px;
  overflow: hidden;
}
.seg button {
  border: none;
  background: #fff;
  padding: 7px 12px;
  font-size: 13px;
  cursor: pointer;
  border-right: 1px solid #e6e3d9;
  color: #3d4642;
}
.seg button:last-child {
  border-right: none;
}
.seg button.on {
  background: #3f7d5e;
  color: #fff;
}
.canvas-wrap {
  position: relative;
  width: 100%;
  height: 56vh;
  min-height: 420px;
  border: 1px solid #e3e0d8;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.hud-layer {
  touch-action: none;
  cursor: grab;
}
.canvas-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.72);
  font-size: 14px;
}
.stat-bar {
  margin-top: 8px;
  min-height: 18px;
}
.brush-card {
  margin-top: 12px;
  padding: 12px 14px;
  background: #f4f9f6;
}
.brush-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.brush-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 6px 18px;
  font-size: 13px;
}
.brush-grid span {
  color: #5b6560;
  margin-right: 6px;
}
.monet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.monet-item {
  border: 1px solid #e3e0d8;
  border-radius: 12px;
  padding: 14px;
  background: #fdfcf9;
}
.monet-item.owned {
  border-color: #3f7d5e;
  background: #f0f7f3;
}
.monet-item h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.price {
  margin: 0 0 4px;
  font-weight: 600;
}
.row {
  display: flex;
  gap: 8px;
}
.owned-tag {
  color: #2f6f51;
  font-size: 13px;
  font-weight: 600;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(30, 36, 33, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}
.modal {
  width: min(680px, 100%);
  padding: 20px 22px;
  background: #fff;
}
.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  justify-content: flex-end;
}
.small {
  font-size: 12px;
}
.faint {
  color: #7a827d;
}
@media (max-width: 640px) {
  .canvas-wrap {
    height: 52vh;
    min-height: 320px;
  }
  .seg button {
    padding: 7px 9px;
    font-size: 12px;
  }
}
</style>
