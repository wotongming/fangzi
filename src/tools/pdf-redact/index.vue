<script setup lang="ts">
/**
 * PDF 遮罩（pdf-redact）——浏览器本地 PDF 真脱敏。
 * 框选敏感区域 → 该页光栅化真删文字层（导出后不可复制/搜索）→ 清空文档元数据。
 * 文件全程不出设备、无后端；原文件不改，导出为新 PDF。
 * 免费：每次 ≤3 页 + 基础框选；专业：不限页数、批量遮罩、元数据彻底清洗（买断 ¥129）。
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { inspectPdf, buildRedactedPdf, readMeta, pageText, type PageInfo } from './lib/engine'
import { clampRectToPage, type Rect } from './lib/geometry'
import { readPdfFile, FileRejected } from '../../../reusable-module/file-sniff/file-sniff'

useSeo({
  title: 'PDF 真脱敏 - 本地真删文字层+清元数据（不上传）',
  description:
    '合同/简历/账单对外发前本地框选敏感信息，真删文字层（不是画黑框、复制不出）并清空作者/标题等元数据，文件全程不上传浏览器本地处理。',
  type: 'SoftwareApplication',
  keywords: ['pdf脱敏', 'pdf打码', 'pdf去除文字', 'pdf元数据清理', '合同脱敏', '简历脱敏', '本地处理', '不上传']
})

const billing = useToolBilling('pdf-redact')
const pro = computed(() => billing.canUse('redact-pro').allowed)
const buying = ref(false)
async function unlock(): Promise<void> {
  if (buying.value) return
  buying.value = true
  try {
    await billing.buy()
    toast.value = '已解锁专业版（买断 ¥129）'
  } finally {
    buying.value = false
  }
}

const toast = ref('')
function notify(msg: string): void {
  toast.value = msg
  window.setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2600)
}

// ---------- 文件与页面 ----------
const fileName = ref('')
const origBuf = ref<ArrayBuffer | null>(null)
const pages = ref<PageInfo[]>([])
const cur = ref(0)
const loading = ref(false)
const busy = ref(false)
const done = ref(false)
const resultMeta = ref<Record<string, string> | null>(null)

// 每页遮罩（PDF 用户空间 pt）
const masks = reactive(new Map<number, Rect[]>())

const FREE_MAX_PAGES = 3
const overFreePages = computed(() => pages.value.length > FREE_MAX_PAGES && !pro.value)

async function onFile(e: Event): Promise<void> {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  if (!f) return // 用户取消选择：静默，不报错
  await loadFile(f)
  el.value = '' // 允许再次选同一文件
}

async function loadFile(f: File): Promise<void> {
  loading.value = true
  try {
    // 不信 file.type（安卓各 provider 常给 ""/octet-stream），按魔数 %PDF 校验
    const buf = await readPdfFile(f)
    const info = await inspectPdf(buf)
    origBuf.value = buf
    fileName.value = f.name
    pages.value = info.pages
    cur.value = 0
    masks.clear()
    done.value = false
    resultMeta.value = null
    notify(`已载入 ${f.name}（${info.numPages} 页）`)
    requestAnimationFrame(() => void renderPreview())
  } catch (err) {
    const msg = err instanceof FileRejected ? err.message : `打开失败：${(err as Error).message}（${f.name}）`
    notify(msg)
  } finally {
    loading.value = false
  }
}

// 预览：把当前页画到 canvas，并叠加遮罩层
const previewRef = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLDivElement | null>(null)
const scale = ref(1)

const page = computed(() => pages.value[cur.value] ?? null)
const curMasks = computed(() => masks.get(cur.value) ?? [])

async function renderPreview(): Promise<void> {
  if (!origBuf.value || !page.value) return
  const pdfjs = await import('pdfjs-dist')
  const pdf = await pdfjs.getDocument({ data: origBuf.value.slice(0) }).promise
  const pg = await pdf.getPage(cur.value + 1)
  // 预览宽度自适应容器
  const targetW = Math.min(720, overlay.value?.clientWidth ?? 720)
  scale.value = targetW / page.value.width
  const vp = pg.getViewport({ scale: scale.value })
  const canvas = previewRef.value!
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await pg.render({ canvasContext: ctx, viewport: vp }).promise
  await pdf.destroy()
}

// 拖拽框选
let dragging = false
let startX = 0
let startY = 0
const draft = ref<Rect | null>(null)

function evtPos(ev: PointerEvent): { px: number; py: number } {
  const el = overlay.value!
  const r = el.getBoundingClientRect()
  return { px: ev.clientX - r.left, py: ev.clientY - r.top }
}

function onDown(ev: PointerEvent): void {
  if (!page.value || busy.value) return
  ;(ev.target as HTMLElement).setPointerCapture(ev.pointerId)
  dragging = true
  const { px, py } = evtPos(ev)
  startX = px
  startY = py
  draft.value = { x: px, y: py, w: 0, h: 0 }
}
function onMove(ev: PointerEvent): void {
  if (!dragging || !overlay.value) return
  const { px, py } = evtPos(ev)
  const x = Math.min(startX, px)
  const y = Math.min(startY, py)
  draft.value = { x, y, w: Math.abs(px - startX), h: Math.abs(py - startY) }
}
function onUp(): void {
  if (!dragging || !draft.value || !page.value) return
  dragging = false
  if (draft.value.w < 6 || draft.value.h < 6) { draft.value = null; return }
  // 屏幕坐标（原点左上）→ PDF 用户空间（原点左下）
  const r = screenToPdf(draft.value)
  const masksForPage = masks.get(cur.value) ?? []
  masks.set(cur.value, [...masksForPage, r])
  draft.value = null
}

function screenToPdf(s: { x: number; y: number; w: number; h: number }): Rect {
  const p = page.value!
  return clampRectToPage(
    { x: s.x / scale.value, y: p.height - (s.y + s.h) / scale.value, w: s.w / scale.value, h: s.h / scale.value },
    p.width, p.height
  )!
}

// 预览层上把 PDF 矩形画回屏幕坐标
function toScreen(r: Rect): { left: number; top: number; width: number; height: number } {
  const p = page.value!
  return {
    left: r.x * scale.value,
    top: (p.height - r.y - r.h) * scale.value,
    width: r.w * scale.value,
    height: r.h * scale.value
  }
}

function removeMask(idx: number): void {
  const arr = masks.get(cur.value) ?? []
  arr.splice(idx, 1)
}

function goto(i: number): void {
  if (i < 0 || i >= pages.value.length) return
  cur.value = i
  void renderPreview()
}

// ---------- 导出 ----------
async function exportPdf(): Promise<void> {
  if (!origBuf.value || !page.value) return
  if (overFreePages.value) { notify('免费版每次最多 3 页，专业版不限页'); return }
  busy.value = true
  try {
    const res = await buildRedactedPdf(origBuf.value, masks)
    // 校验：导出后读元数据
    resultMeta.value = await readMeta(res.bytes.slice(0).buffer as ArrayBuffer)
    const blob = new Blob([res.bytes as unknown as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.value.replace(/\.pdf$/i, '') + '-redacted.pdf'
    a.click()
    URL.revokeObjectURL(url)
    done.value = true
    notify(`已导出真脱敏 PDF（${res.redactedPages.length} 页已真删文字层）`)
  } catch (err) {
    notify('导出失败，请重试')
  } finally {
    busy.value = false
  }
}

// —— E2E 测试接缝：不暴露 UI，仅供自动化真删/元数据断言 ——
;(window as unknown as Record<string, unknown>).__pdfRedact = {
  loadBuffer: async (buf: ArrayBuffer) => {
    const info = await inspectPdf(buf)
    origBuf.value = buf
    pages.value = info.pages
    cur.value = 0
    masks.clear()
    return info
  },
  build: async (masksByPage: Array<[number, Rect[]]>) =>
    buildRedactedPdf(origBuf.value!, new Map(masksByPage)),
  pageText: (buf: ArrayBuffer, pageIdx: number) => pageText(buf, pageIdx),
  readMeta: (buf: ArrayBuffer) => readMeta(buf)
}

onBeforeUnmount(() => { /* pdfjs doc 在 render 后即 destroy */ })
</script>

<template>
  <div class="pr">
    <header class="pr-head">
      <h2>PDF 真脱敏</h2>
      <p class="pr-sub">框选合同/简历/账单里的敏感信息，<b>真删文字层</b>（不是画黑框、导出后复制不出），并清空作者/标题等元数据。文件全程在你浏览器本地处理，绝不上传。</p>
    </header>

    <input ref="file" type="file" accept="application/pdf,.pdf" @change="onFile" class="pr-input" />

    <div v-if="!pages.length && !loading" class="pr-drop">
      <p>选择一个 PDF 开始（原文件不会被修改，导出为新文件）</p>
      <label class="pr-btn">选择 PDF<input type="file" accept="application/pdf,.pdf" hidden @change="onFile" /></label>
    </div>
    <div v-if="loading" class="pr-drop">读取中…</div>

    <div v-if="pages.length" class="pr-main">
      <div class="pr-toolbar">
        <button class="pr-btn" @click="goto(cur - 1)">‹ 上一页</button>
        <span class="pr-pg">{{ cur + 1 }} / {{ pages.length }}</span>
        <button class="pr-btn" @click="goto(cur + 1)">下一页 ›</button>
        <span v-if="overFreePages" class="pr-warn">免费版限 3 页，专业版不限</span>
      </div>

      <div class="pr-stage" ref="overlay" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp">
        <canvas ref="previewRef" class="pr-canvas"></canvas>
        <div
          v-for="(m, i) in curMasks" :key="i"
          class="pr-mask" :style="toScreen(m)"
          @pointerdown.stop @click="removeMask(i)" :title="'点击移除'"
        ></div>
        <div v-if="draft" class="pr-mask draft" :style="draft"></div>
      </div>

      <div class="pr-side">
        <p class="pr-hint">在上方页面上<b>拖拽框选</b>要抹掉的区域（点黑块可移除）。含遮罩的页会光栅化真删该页文字。</p>
        <p class="pr-count">本页遮罩：{{ curMasks.length }} 块</p>
        <button class="pr-btn primary" :disabled="busy" @click="exportPdf">导出真脱敏 PDF</button>
        <p v-if="!pro" class="pr-buy" @click="unlock">专业版（买断 ¥129）：不限页数 · 彻底清元数据 →</p>
        <p v-if="done && resultMeta" class="pr-meta">
          元数据已清空：Author={{ resultMeta.Author === '' ? '空' : resultMeta.Author }} / Title={{ resultMeta.Title === '' ? '空' : resultMeta.Title }}
        </p>
      </div>
    </div>

    <p v-if="toast" class="pr-toast">{{ toast }}</p>
  </div>
</template>

<style scoped>
.pr { max-width: 980px; margin: 0 auto; padding: 16px; }
.pr-head h2 { font-size: 20px; margin: 0 0 6px; }
.pr-sub { color: #556; font-size: 13px; line-height: 1.6; margin: 0 0 12px; }
.pr-sub b { color: #1f7a4d; }
.pr-input { display: none; }
.pr-drop { border: 2px dashed #cdd6d0; border-radius: 12px; padding: 40px; text-align: center; color: #667; }
.pr-btn { display: inline-block; border: 1px solid #1f7a4d; background: #fff; color: #1f7a4d; border-radius: 10px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
.pr-btn.primary { background: #1f7a4d; color: #fff; }
.pr-main { display: grid; grid-template-columns: 1fr 240px; gap: 16px; }
@media (max-width: 760px) { .pr-main { grid-template-columns: 1fr; } }
.pr-toolbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; }
.pr-pg { font-size: 14px; color: #445; }
.pr-warn { color: #b26a00; font-size: 12px; }
.pr-stage { position: relative; display: inline-block; background: #e9ece9; border-radius: 8px; touch-action: none; user-select: none; align-self: start; max-width: 100%; }
.pr-canvas { display: block; max-width: 100%; height: auto; }
.pr-mask { position: absolute; background: rgba(220, 40, 40, 0.35); border: 1px solid #d00; box-sizing: border-box; }
.pr-mask.draft { background: rgba(220,40,40,0.2); }
.pr-side { font-size: 13px; color: #445; }
.pr-hint { line-height: 1.6; }
.pr-buy { color: #1f7a4d; cursor: pointer; text-decoration: underline; }
.pr-meta { background: #eef7f1; border-radius: 8px; padding: 8px; font-size: 12px; }
.pr-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #222; color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 13px; }
</style>
