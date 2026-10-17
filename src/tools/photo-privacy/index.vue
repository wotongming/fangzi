<script setup lang="ts">
/**
 * 照片隐私清理工作台（photo-privacy）
 * 本地一键清除 EXIF/GPS、区域打码、文件名清洗与压缩；图片全程不出设备。
 * 免费：去元数据 + 单张 + 单个矩形遮挡；专业：模糊/多区域/涂抹、批量 ZIP、场景预设。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { readMeta, type MetaInfo } from './lib/exif'
import { processImage, supportsWebp, resolveOutType, type OutMime } from './lib/process'
import type { Mask } from './lib/redact'
import { type RedactMode } from './lib/redact'
import { safeName } from './lib/naming'
import { PRESETS, type Preset } from './lib/preset'
import { runBatch, packZip, type BatchOutput } from './lib/batch'

useSeo({
  title: '照片隐私清理 - 本地去除照片GPS定位/EXIF与打码',
  description:
    '发图前本地一键清除照片 GPS、拍摄时间、设备型号等 EXIF 隐私，框选马赛克/模糊打码、清洗文件名并压缩，支持批量打包，照片全程不上传。',
  type: 'SoftwareApplication',
  keywords: ['去exif', '照片定位', '马赛克打码', '隐私保护', '批量去信息', '本地处理'],
  jsonLd: { offers: { '@type': 'Offer', price: '12.9', priceCurrency: 'CNY' } }
})

const billing = useToolBilling('photo-privacy')
const pro = computed(() => billing.canUse('redact-pro').allowed)
const batchPro = computed(() => billing.canUse('batch').allowed)
const presetPro = computed(() => billing.canUse('preset').allowed)
const buying = ref(false)
async function unlock(): Promise<void> {
  if (buying.value) return
  buying.value = true
  try {
    await billing.buy()
    toast.value = '已解锁专业功能'
  } finally {
    buying.value = false
  }
}

const toast = ref('')
function notify(msg: string): void {
  toast.value = msg
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 2600)
}

const webpOk = ref(true)
onMounted(() => {
  webpOk.value = supportsWebp()
})

type Tab = 'single' | 'batch'
const tab = ref<Tab>('single')

// ---------- 通用输出设置 ----------
const out = reactive({
  format: 'jpeg' as 'jpeg' | 'webp' | 'png',
  quality: 0.85,
  maxEdge: 2048,
  redactMode: 'mosaic' as RedactMode,
  cleanName: true,
  prefix: 'photo'
})
const outType = computed<OutMime>(() =>
  resolveOutType(out.format === 'jpeg' ? 'image/jpeg' : out.format === 'webp' ? 'image/webp' : 'image/png')
)

// ---------- 单张 ----------
interface SingleItem {
  file: File
  url: string
  meta: MetaInfo
  masks: Mask[]
  tool: 'rect' | 'path'
}
const single = ref<SingleItem | null>(null)
const result = ref<{ url: string; name: string; size: number; meta: MetaInfo } | null>(null)
const processing = ref(false)
const stageEl = ref<HTMLElement | null>(null)

async function onSingleFile(f: File | null): Promise<void> {
  if (!f) return
  const meta = await readMeta(f)
  if (meta.kind === 'unsupported') {
    notify('暂不支持该格式（如 HEIC/RAW），请先转为 JPG 后再处理')
    return
  }
  if (single.value?.url) URL.revokeObjectURL(single.value.url)
  if (result.value?.url) URL.revokeObjectURL(result.value.url)
  result.value = null
  single.value = { file: f, url: URL.createObjectURL(f), meta, masks: [], tool: 'rect' }
}

function addMask(normalized: number[] | number[][], shape: 'rect' | 'path'): void {
  const coords = shape === 'rect' ? (normalized as number[]) : (normalized as number[][]).flat()
  // 免费用户：最多 1 个矩形；模糊/涂抹/多区域需专业版
  const needPro =
    out.redactMode === 'blur' || shape === 'path' || (single.value?.masks.length ?? 0) >= 1
  if (needPro && !pro.value) {
    void unlock()
    return
  }
  single.value?.masks.push({ id: `m${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, shape, coords })
}
function removeMask(id: string): void {
  if (!single.value) return
  single.value.masks = single.value.masks.filter((m) => m.id !== id)
}

// 框选交互（Pointer Events，同时兼容鼠标 / 触摸）
let drawing = false
let startX = 0
let startY = 0
let pathPts: number[][] = []
function rel(e: PointerEvent): [number, number] {
  const el = stageEl.value
  if (!el) return [0, 0]
  const r = el.getBoundingClientRect()
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  return [x, y]
}
function onDown(e: PointerEvent): void {
  if (!single.value) return
  // 必须在 currentTarget（.stage）上捕获，否则指针落到子元素 img 时后续 move/up 会被 retarget
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  drawing = true
  const [x, y] = rel(e)
  startX = x
  startY = y
  pathPts = [[x, y]]
}
function onMove(e: PointerEvent): void {
  if (!drawing || !single.value) return
  if (single.value.tool === 'path') pathPts.push(rel(e))
}
function onUp(e: PointerEvent): void {
  if (!drawing || !single.value) return
  drawing = false
  const [x, y] = rel(e)
  if (single.value.tool === 'path') {
    pathPts.push([x, y])
    if (pathPts.length >= 2) addMask(pathPts, 'path')
  } else {
    const coords = [startX, startY, x, y]
    if (Math.abs(x - startX) > 0.01 && Math.abs(y - startY) > 0.01) addMask(coords, 'rect')
  }
}

function maskStyle(m: Mask): Record<string, string> {
  let x0: number, y0: number, x1: number, y1: number
  if (m.shape === 'rect' && m.coords.length >= 4) {
    x0 = m.coords[0]!
    y0 = m.coords[1]!
    x1 = m.coords[2]!
    y1 = m.coords[3]!
  } else {
    const xs = m.coords.filter((_, i) => i % 2 === 0)
    const ys = m.coords.filter((_, i) => i % 2 === 1)
    x0 = Math.min(...xs)
    x1 = Math.max(...xs)
    y0 = Math.min(...ys)
    y1 = Math.max(...ys)
  }
  return {
    left: `${Math.min(x0, x1) * 100}%`,
    top: `${Math.min(y0, y1) * 100}%`,
    width: `${Math.abs(x1 - x0) * 100}%`,
    height: `${Math.abs(y1 - y0) * 100}%`
  }
}

async function processSingle(): Promise<void> {
  if (!single.value || processing.value) return
  processing.value = true
  try {
    const res = await processImage(single.value.file, {
      outType: outType.value,
      quality: out.quality,
      maxEdge: out.maxEdge || undefined,
      masks: single.value.masks,
      redactMode: out.redactMode
    })
    const used = new Set<string>()
    const name = safeName(single.value.file.name, res.blob.type, {
      clean: out.cleanName,
      prefix: out.prefix,
      random: true,
      used
    })
    const meta = await readMeta(res.blob)
    if (result.value?.url) URL.revokeObjectURL(result.value.url)
    result.value = { url: URL.createObjectURL(res.blob), name, size: res.blob.size, meta }
  } catch (err) {
    notify(err instanceof Error ? err.message : '处理失败，请重试')
  } finally {
    processing.value = false
  }
}

function downloadBlob(url: string, name: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ---------- 批量 ----------
interface BatchRow {
  id: number
  file: File
  meta: MetaInfo | null
  error?: string
}
const batchRows = ref<BatchRow[]>([])
const batchRunning = ref(false)
const batchDone = ref(0)
const batchOutputs = ref<{ name: string; blob: Blob }[]>([])
let batchSeq = 0

async function onBatchFiles(files: FileList | null): Promise<void> {
  if (!files) return
  for (const file of Array.from(files)) {
    const meta = await readMeta(file)
    batchRows.value.push({ id: ++batchSeq, file, meta: meta.kind === 'unsupported' ? null : meta, error: meta.kind === 'unsupported' ? '不支持的格式' : undefined })
  }
}
function clearBatch(): void {
  batchRows.value = []
  batchOutputs.value = []
  batchDone.value = 0
}

async function startBatch(): Promise<void> {
  const valid = batchRows.value.filter((r) => !r.error)
  if (!valid.length) return
  if (valid.length > 1 && !batchPro.value) {
    await unlock()
    if (!billing.canUse('batch').allowed) return
  }
  batchRunning.value = true
  batchDone.value = 0
  batchOutputs.value = []
  const used = new Set<string>()
  const outs: { name: string; blob: Blob }[] = []
  const results: BatchOutput[] = await runBatch(
    valid.map((r) => ({ id: r.id, file: r.file })),
    { outType: outType.value, quality: out.quality, maxEdge: out.maxEdge, redactMode: out.redactMode },
    (_d, _t, cur) => {
      batchDone.value = _d
      if (!cur.error && cur.blob.size) {
        const src = valid.find((r) => r.id === cur.id)
        const name = safeName(src?.file.name ?? 'photo.jpg', cur.blob.type, {
          clean: out.cleanName,
          prefix: out.prefix,
          random: true,
          used
        })
        outs.push({ name, blob: cur.blob })
      }
    }
  )
  void results
  batchOutputs.value = outs
  batchRunning.value = false
  if (outs.length) notify(`已处理 ${outs.length} 张，可下载 ZIP`)
}

async function downloadZip(): Promise<void> {
  if (!batchOutputs.value.length) return
  const zip = await packZip(batchOutputs.value)
  const url = URL.createObjectURL(zip)
  downloadBlob(url, `photos-safe-${Date.now()}.zip`)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ---------- 预设 ----------
function applyPreset(p: Preset): void {
  if (!presetPro.value) {
    void unlock()
    return
  }
  out.format = p.outType === 'image/png' ? 'png' : p.outType === 'image/webp' ? 'webp' : 'jpeg'
  out.quality = p.quality
  out.maxEdge = p.maxEdge
  out.redactMode = p.redactMode
  out.cleanName = p.cleanName
  out.prefix = p.prefix
  notify(`已套用「${p.name}」预设，记得按提示手动遮挡敏感区域`)
}
const presetList = PRESETS

function fmtSize(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
</script>

<template>
  <div class="pp">
    <header class="pp-head">
      <h1>照片隐私清理工作台</h1>
      <p class="sub">发图前清除 <b>GPS 定位 / 拍摄时间 / 设备型号</b> 等 EXIF，框选打码、清洗文件名、压缩，<b>照片全程不上传</b>。</p>
      <div class="tabs">
        <button :class="{ active: tab === 'single' }" @click="tab = 'single'">单张处理</button>
        <button :class="{ active: tab === 'batch' }" @click="tab = 'batch'">批量处理</button>
      </div>
    </header>

    <!-- 通用设置 -->
    <section class="card opts">
      <div class="opt">
        <label>格式</label>
        <select v-model="out.format">
          <option value="jpeg">JPEG（通用）</option>
          <option value="webp" :disabled="!webpOk">WebP（更小）</option>
          <option value="png">PNG（截图/无损）</option>
        </select>
      </div>
      <div class="opt" v-if="out.format !== 'png'">
        <label>质量 {{ Math.round(out.quality * 100) }}%</label>
        <input type="range" min="0.4" max="1" step="0.01" v-model.number="out.quality" />
      </div>
      <div class="opt">
        <label>最长边 {{ out.maxEdge ? out.maxEdge + 'px' : '原尺寸' }}</label>
        <input type="range" min="0" max="4096" step="128" v-model.number="out.maxEdge" />
      </div>
      <div class="opt">
        <label>打码方式</label>
        <select v-model="out.redactMode">
          <option value="mosaic">马赛克</option>
          <option value="blur">模糊（专业）</option>
          <option value="solid">纯色遮挡</option>
        </select>
      </div>
      <div class="opt">
        <label><input type="checkbox" v-model="out.cleanName" /> 清洗文件名</label>
        <input class="prefix" type="text" v-model="out.prefix" placeholder="前缀" :disabled="!out.cleanName" />
      </div>
    </section>

    <!-- 预设 -->
    <section class="card">
      <div class="card-title">场景预设 <span class="pro-tag" v-if="!presetPro">专业</span></div>
      <div class="presets">
        <button v-for="p in presetList" :key="p.id" class="preset" @click="applyPreset(p)">
          <b>{{ p.name }}</b><span>{{ p.desc }}</span>
        </button>
      </div>
    </section>

    <!-- 单张 -->
    <section v-if="tab === 'single'" class="card">
      <label class="pick">
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden @change="onSingleFile(($event.target as HTMLInputElement).files?.[0] ?? null)" />
        <span class="btn btn-primary">＋ 选择照片</span>
      </label>

      <div v-if="single" class="editor">
        <div class="risk" :class="{ danger: single.meta.risks.length }">
          <template v-if="single.meta.risks.length">
            ⚠ 原图将泄露：<b>{{ single.meta.risks.join('、') }}</b>
            <span v-if="single.meta.gps" class="gps">（{{ single.meta.gps.lat.toFixed(5) }}, {{ single.meta.gps.lng.toFixed(5) }}）</span>
          </template>
          <template v-else>✅ 未发现 GPS / 设备等 EXIF 信息</template>
        </div>

        <div class="toolbar">
          <button class="btn" :class="{ active: single.tool === 'rect' }" @click="single.tool = 'rect'">矩形框选</button>
          <button class="btn" :class="{ active: single.tool === 'path' }" @click="single.tool = 'path'">自由涂抹<span class="pro-tag">专业</span></button>
          <span class="hint">在图上拖拽框选要遮挡的区域</span>
        </div>

        <div
          ref="stageEl"
          class="stage"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
        >
          <img :src="single.url" alt="待处理照片" draggable="false" />
          <div v-for="m in single.masks" :key="m.id" class="mask" :class="out.redactMode" :style="maskStyle(m)">
            <button class="del" @click.stop="removeMask(m.id)">✕</button>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-primary" :disabled="processing" @click="processSingle">
            {{ processing ? '处理中…' : '一键清除隐私并生成' }}
          </button>
        </div>

        <div v-if="result" class="result">
          <div class="ok">✅ 已生成，文件不含 GPS / 设备 / 时间等元数据（{{ result.meta.risks.length ? '仍有异常' : '已验证清空' }}）</div>
          <img :src="result.url" alt="处理结果" />
          <div class="actions">
            <span class="fname">{{ result.name }} · {{ fmtSize(result.size) }}</span>
            <button class="btn btn-primary" @click="downloadBlob(result.url, result.name)">下载</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 批量 -->
    <section v-else class="card">
      <label class="pick">
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onBatchFiles(($event.target as HTMLInputElement).files)" />
        <span class="btn btn-primary">＋ 选择多张照片</span>
      </label>
      <p class="hint">批量统一清除元数据、缩放压缩、清洗文件名并打包 ZIP；区域打码请在「单张处理」逐张进行。</p>

      <ul v-if="batchRows.length" class="rows">
        <li v-for="r in batchRows" :key="r.id" :class="{ bad: !!r.error }">
          <span class="rn">{{ r.file.name }}</span>
          <span class="rmeta" v-if="r.error">{{ r.error }}</span>
          <span class="rmeta" v-else-if="r.meta && r.meta.risks.length">⚠ {{ r.meta.risks.join('、') }}</span>
          <span class="rmeta ok" v-else>无 EXIF</span>
        </li>
      </ul>

      <div class="actions" v-if="batchRows.length">
        <button class="btn btn-primary" :disabled="batchRunning" @click="startBatch">
          {{ batchRunning ? `处理中 ${batchDone}/${batchRows.filter((r) => !r.error).length}` : batchPro ? '开始批量处理' : '批量处理（专业）' }}
        </button>
        <button class="btn" :disabled="batchRunning || !batchOutputs.length" @click="downloadZip">下载 ZIP（{{ batchOutputs.length }}）</button>
        <button class="btn btn-ghost" :disabled="batchRunning" @click="clearBatch">清空</button>
      </div>
    </section>

    <!-- 专业版 -->
    <section class="card pay" v-if="!pro">
      <div class="card-title">升级专业版</div>
      <p class="hint">免费：清除 EXIF/GPS、单张处理、一个矩形遮挡。专业版：模糊与多区域/自由涂抹、批量不限量打包、场景预设与文件名模板。</p>
      <button class="btn btn-primary big" :disabled="buying" @click="unlock">
        {{ buying ? '支付中…' : `一次性解锁 ${billing.priceText(billing.plan.priceCents)}` }}
      </button>
    </section>

    <p v-if="toast" class="toast">{{ toast }}</p>
  </div>
</template>

<style scoped>
.pp {
  max-width: var(--maxw);
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pp-head h1 { font-size: 22px; margin: 0 0 6px; color: var(--ink); }
.sub { color: var(--ink-soft); margin: 0 0 10px; line-height: 1.6; }
.tabs { display: flex; gap: 8px; }
.tabs button { flex: 0 0 auto; padding: 8px 18px; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius); cursor: pointer; }
.tabs button.active { background: var(--brand); color: #fff; border-color: var(--brand); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; box-shadow: var(--shadow-sm); }
.card-title { font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.opts { display: flex; flex-wrap: wrap; gap: 14px 22px; }
.opt { display: flex; flex-direction: column; gap: 6px; min-width: 150px; font-size: 13px; color: var(--ink-soft); }
.opt select, .opt input[type='text'] { padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.opt .prefix { width: 110px; }
.presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.preset { text-align: left; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px; background: var(--bg); cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.preset b { color: var(--ink); }
.preset span { font-size: 12px; color: var(--ink-faint); line-height: 1.4; }
.btn { padding: 8px 14px; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
.btn-primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.btn-ghost { background: transparent; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.active { outline: 2px solid var(--brand); }
.btn.big { font-size: 16px; padding: 12px 22px; }
.pick { display: inline-block; }
.toolbar { display: flex; align-items: center; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
.hint { font-size: 12px; color: var(--ink-faint); }
.risk { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--ink-soft); margin: 10px 0; line-height: 1.6; }
.risk.danger { background: #fdecec; color: #b3261e; }
.gps { font-size: 12px; }
.stage { position: relative; width: 100%; border: 1px dashed var(--line); border-radius: var(--radius-sm); overflow: hidden; touch-action: none; user-select: none; }
.stage img { display: block; width: 100%; height: auto; }
.mask { position: absolute; border: 2px solid #ff3b30; box-sizing: border-box; pointer-events: none; }
.mask.mosaic { background: repeating-conic-gradient(#888 0% 25%, #ddd 0% 50%) 50% / 16px 16px; }
.mask.blur { background: rgba(120, 120, 120, .55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.mask.solid { background: #111; }
.del { position: absolute; top: -10px; right: -10px; width: 22px; height: 22px; border-radius: 50%; border: none; background: #ff3b30; color: #fff; cursor: pointer; font-size: 12px; pointer-events: auto; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.result { margin-top: 14px; border-top: 1px dashed var(--line); padding-top: 12px; }
.result .ok { color: #1a7f37; margin-bottom: 8px; }
.result img { max-width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--line); }
.fname { font-size: 13px; color: var(--ink-soft); word-break: break-all; }
.rows { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; }
.rows li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 13px; }
.rows li.bad { opacity: .7; }
.rn { color: var(--ink); word-break: break-all; }
.rmeta { color: #b3261e; white-space: nowrap; }
.rmeta.ok { color: #1a7f37; }
.pro-tag { font-size: 11px; background: var(--accent); color: #fff; border-radius: 6px; padding: 0 5px; margin-left: 4px; }
.pay .btn { margin-top: 8px; }
.toast { position: fixed; left: 50%; bottom: calc(var(--tab-h, 0px) + 24px); transform: translateX(-50%); background: rgba(0, 0, 0, .82); color: #fff; padding: 10px 16px; border-radius: 20px; font-size: 13px; z-index: 50; max-width: 86vw; }
@media (max-width: 820px) {
  .pp { padding: 12px; }
  .opt { flex: 1 1 40%; min-width: 0; }
  .presets { grid-template-columns: 1fr 1fr; }
}
</style>
