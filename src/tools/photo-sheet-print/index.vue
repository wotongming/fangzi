<script setup lang="ts">
/**
 * photo-sheet-print —— 作业/试卷照片成册打印。
 * 多图导入（相册/拍照）→ 旋转/排序/删除/备注 → A4 排版配置 → 本地预览分页 → 浏览器打印或导出 PDF。全程本地。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { manifest, FREE_PHOTO_LIMIT } from './manifest'
import { groupPages, normalizeConfig, pageCount, perPage, type SheetConfig } from './lib/layout'
import { importPhoto, photoUrl, PhotoRejected } from './lib/photos'
import { buildSheetPdf, download } from './lib/sheet-pdf'
import { listPhotos, removePhoto, saveConfig, savePhoto, clearPhotos, loadConfig } from './lib/store'
import type { PhotoItem } from './lib/models'

useSeo({
  title: '作业照片成册打印 - 本地 A4 多图排版与 PDF 导出 | 方子',
  description:
    '把群里随手拍的作业/试卷照片批量整理成 A4 成册：多图导入、旋转排序、每页张数/边距/纵横排版，本地预览后打印或导出 PDF，照片不上传。',
  type: 'SoftwareApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)

const photos = ref<PhotoItem[]>([])
const urls = new Map<string, string>()
const loading = ref(true)
const busy = ref(false)
const toast = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)

const config = reactive<SheetConfig>(
  normalizeConfig({ orientation: 'portrait', cols: 2, rows: 2, marginMm: 12, gapMm: 4, header: '' })
)

const pages = computed(() => groupPages(photos.value, perPage(config)))
const totalPages = computed(() => pageCount(photos.value.length, perPage(config)))

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2600)
}

function refreshUrl(photo: PhotoItem) {
  const old = urls.get(photo.id)
  if (old) URL.revokeObjectURL(old)
  urls.set(photo.id, photoUrl(photo))
}

async function reload() {
  photos.value = await listPhotos()
  for (const p of photos.value) if (!urls.has(p.id)) refreshUrl(p)
  loading.value = false
}

onMounted(async () => {
  try {
    const saved = await loadConfig()
    if (saved) Object.assign(config, saved)
  } catch {
    /* 首次无配置，沿用默认 */
  }
  await reload()
})

watch(
  config,
  () => {
    saveConfig(normalizeConfig({ ...config })).catch(() => {})
  },
  { deep: true }
)

onBeforeUnmount(() => {
  for (const u of urls.values()) URL.revokeObjectURL(u)
  urls.clear()
})

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await addFiles(files)
}

async function addFiles(files: File[]) {
  if (!files.length) return
  for (const file of files) {
    if (photos.value.length >= FREE_PHOTO_LIMIT && !billing.canUse('unlimited').allowed) {
      showToast(`免费版最多导入 ${FREE_PHOTO_LIMIT} 张，买断后不限张数`)
      await billing.buy()
      return
    }
    try {
      const photo = await importPhoto(file)
      await savePhoto(photo)
      photos.value.push(photo)
      refreshUrl(photo)
    } catch (err) {
      if (err instanceof PhotoRejected) showToast(err.message)
      else showToast(`导入失败：${file.name}`)
    }
  }
  showToast('已导入')
}

function rotate(photo: PhotoItem) {
  photo.rotation = ((photo.rotation + 90) % 360) as PhotoItem['rotation']
  savePhoto(photo).catch(() => {})
}

function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= photos.value.length) return
  const a = photos.value[i]!
  const b = photos.value[j]!
  const sa = a.seq
  a.seq = b.seq
  b.seq = sa
  photos.value.splice(i, 2, b, a)
  savePhoto(a).catch(() => {})
  savePhoto(b).catch(() => {})
}

async function remove(photo: PhotoItem) {
  await removePhoto(photo.id)
  const old = urls.get(photo.id)
  if (old) URL.revokeObjectURL(old)
  urls.delete(photo.id)
  photos.value = photos.value.filter((p) => p.id !== photo.id)
}

function renameCaption(photo: PhotoItem, caption: string) {
  photo.caption = caption
  savePhoto(photo).catch(() => {})
}

async function clearAll() {
  if (!photos.value.length) return
  if (!confirm('确定清空本次导入的全部照片吗？此操作只影响本机记录。')) return
  await clearPhotos()
  for (const u of urls.values()) URL.revokeObjectURL(u)
  urls.clear()
  photos.value = []
  showToast('已清空')
}

async function exportPdf() {
  if (!photos.value.length) return showToast('先导入照片再导出')
  if (!billing.canUse('high-res-pdf').allowed) {
    showToast('高清 PDF 导出为买断功能')
    await billing.buy()
    return
  }
  busy.value = true
  try {
    const blob = await buildSheetPdf(photos.value, normalizeConfig({ ...config }))
    const stamp = new Date().toISOString().slice(0, 10)
    download(blob, `作业成册-${stamp}.pdf`)
    showToast('PDF 已导出')
  } catch (e) {
    showToast('导出失败：' + (e as Error).message)
  } finally {
    busy.value = false
  }
}

async function printSheet() {
  if (!photos.value.length) return showToast('先导入照片再打印')
  if (!billing.canUse('high-res-pdf').allowed) {
    showToast('整册打印为买断功能')
    await billing.buy()
    return
  }
  window.print()
}

function urlOf(photo: PhotoItem): string {
  return urls.get(photo.id) ?? ''
}
</script>

<template>
  <article class="pc">
    <header class="hero no-print">
      <h1>{{ manifest.name }}</h1>
      <p class="tagline">{{ manifest.tagline }}</p>
      <p class="privacy">🔒 照片只在本机浏览器处理与保存，不上传、无账号；离线可用。</p>
    </header>

    <section class="card no-print">
      <div class="bar">
        <h2>① 导入照片</h2>
        <span class="count">已选 {{ photos.length }} 张 · 共 {{ totalPages }} 页（每页 {{ perPage(config) }} 张）</span>
      </div>
      <div class="pick-row">
        <button class="primary" @click="fileInput?.click()">相册选择多张</button>
        <button @click="cameraInput?.click()">拍照</button>
        <button class="ghost" @click="clearAll">清空全部</button>
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPick" />
        <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="onPick" />
      </div>
      <p class="hint">免费版最多 {{ FREE_PHOTO_LIMIT }} 张；图片自动校正手机照片方向、压缩到适合打印的尺寸，元数据不随导出保留。</p>
    </section>

    <section class="card no-print" v-if="photos.length">
      <h2>② 照片列表（旋转 / 排序 / 备注）</h2>
      <ul class="thumbs">
        <li v-for="(photo, i) in photos" :key="photo.id" class="thumb">
          <img :src="urlOf(photo)" :alt="photo.name" :style="`transform: rotate(${photo.rotation}deg)`" />
          <div class="t-actions">
            <button title="左移" @click="move(i, -1)">←</button>
            <button title="右移" @click="move(i, 1)">→</button>
            <button title="顺时针旋转" @click="rotate(photo)">旋转</button>
            <button class="danger" title="删除" @click="remove(photo)">删除</button>
          </div>
          <input
            class="caption"
            :value="photo.caption"
            placeholder="备注（学科/日期/错题）"
            @change="renameCaption(photo, ($event.target as HTMLInputElement).value)"
          />
        </li>
      </ul>
    </section>

    <section class="card no-print" v-if="photos.length">
      <h2>③ 排版设置</h2>
      <div class="cfg-grid">
        <label>方向
          <select v-model="config.orientation">
            <option value="portrait">纵向 A4</option>
            <option value="landscape">横向 A4</option>
          </select>
        </label>
        <label>每页列数
          <input type="number" min="1" max="6" v-model.number="config.cols" />
        </label>
        <label>每页行数
          <input type="number" min="1" max="6" v-model.number="config.rows" />
        </label>
        <label>页边距（mm）
          <input type="number" min="4" max="40" v-model.number="config.marginMm" />
        </label>
        <label>图间距（mm）
          <input type="number" min="0" max="20" v-model.number="config.gapMm" />
        </label>
        <label class="wide">页眉标题（可留空）
          <input v-model="config.header" placeholder="如：三年级数学 · 2026 秋季作业" />
        </label>
      </div>
      <div class="bar actions">
        <button class="primary" :disabled="busy" @click="printSheet">{{ busy ? '生成中…' : '打印成册' }}</button>
        <button :disabled="busy" @click="exportPdf">导出 PDF</button>
      </div>
      <p class="hint">打印走浏览器系统打印对话框；导出 PDF 为 150 DPI 成册文件。预览仅用于查看分页与留白，不裁切图片。</p>
    </section>

    <section v-if="loading" class="card no-print"><p>载入中…</p></section>
    <section v-else-if="!photos.length" class="card no-print">
      <p class="empty">还没有照片，先在上方从相册选择或拍照导入。</p>
    </section>

    <!-- 打印预览区（打印时保留，其余区块隐藏） -->
    <section v-if="photos.length" class="preview">
      <h2 class="no-print">④ 打印预览（{{ totalPages }} 页）</h2>
      <article v-for="(page, pi) in pages" :key="pi" class="sheet" :class="config.orientation">
        <header v-if="config.header" class="sheet-head">{{ config.header }}<span>第 {{ pi + 1 }} 页</span></header>
        <div class="sheet-grid" :style="`grid-template-columns: repeat(${config.cols}, 1fr); grid-template-rows: repeat(${config.rows}, 1fr);`">
          <figure v-for="photo in page" :key="photo.id" class="cell">
            <img :src="urlOf(photo)" :alt="photo.name" :style="`transform: rotate(${photo.rotation}deg)`" />
            <figcaption v-if="photo.caption">{{ photo.caption }}</figcaption>
          </figure>
        </div>
      </article>
    </section>

    <p v-if="toast" class="toast no-print">{{ toast }}</p>
  </article>
</template>

<style scoped>
.pc { width: 100%; max-width: 920px; margin: 0 auto; padding: 16px; box-sizing: border-box; min-width: 0; overflow-wrap: anywhere; }
.hero h1 { font-size: 22px; margin: 0 0 6px; }
.tagline { color: #374151; margin: 0 0 4px; line-height: 1.6; }
.privacy { color: #047857; font-size: 13px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 14px 0; }
h2 { font-size: 16px; margin: 0 0 10px; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.count { color: #6b7280; font-size: 13px; }
.pick-row { display: flex; gap: 8px; flex-wrap: wrap; }
button { min-height: 44px; padding: 0 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #f9fafb; cursor: pointer; font-size: 15px; }
button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
button.ghost { color: #6b7280; }
button.danger { color: #b91c1c; }
.hint { color: #6b7280; font-size: 13px; margin: 8px 0 0; }
.empty { color: #9ca3af; }
.thumbs { list-style: none; padding: 0; margin: 10px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.thumb { border: 1px solid #eef2f7; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.thumb img { width: 100%; height: 110px; object-fit: contain; background: #f8fafc; border-radius: 6px; transition: transform .2s; }
.t-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.t-actions button { min-height: 38px; padding: 0 10px; font-size: 13px; }
.caption { min-height: 40px; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; }
.cfg-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.cfg-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #374151; }
.cfg-grid .wide { grid-column: span 3; }
.cfg-grid input, .cfg-grid select { min-height: 44px; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; }
.actions { margin-top: 4px; }
.preview { margin: 20px 0; }
.preview h2 { margin-bottom: 12px; }
.sheet { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; margin: 14px 0; padding: 16px; }
.sheet.portrait { aspect-ratio: 210 / 297; }
.sheet.landscape { aspect-ratio: 297 / 210; }
.sheet-head { display: flex; justify-content: space-between; font-size: 13px; color: #374151; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; margin-bottom: 8px; }
.sheet-grid { display: grid; gap: 6px; height: calc(100% - 34px); }
.cell { margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.cell img { max-width: 100%; max-height: 100%; object-fit: contain; }
.cell figcaption { font-size: 12px; color: #6b7280; margin-top: 2px; }
.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #111827; color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 14px; z-index: 50; }
@media (max-width: 640px) {
  .cfg-grid { grid-template-columns: 1fr 1fr; }
  .cfg-grid .wide { grid-column: span 2; }
}
@media print {
  .no-print, .toast { display: none !important; }
  .pc { padding: 0; max-width: none; }
  .sheet { border: none; border-radius: 0; margin: 0; padding: 0; page-break-after: always; aspect-ratio: auto; }
  .preview { margin: 0; }
}
</style>
