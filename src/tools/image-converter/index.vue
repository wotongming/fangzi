<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'

const billing = useToolBilling('image-converter')
const owned = ref(billing.canUse().allowed)
const buying = ref(false)
watch(billing.billingVersion, () => (owned.value = billing.canUse().allowed))

async function buy() {
  buying.value = true
  try {
    await billing.buy('buyout')
  } finally {
    buying.value = false
  }
}

const supportsWebp = ref(true)
onMounted(() => {
  const canvas = document.createElement('canvas')
  supportsWebp.value = canvas.toDataURL('image/webp').startsWith('data:image/webp')
})

const file = ref<File | null>(null)
const format = ref<'image/webp' | 'image/jpeg' | 'image/png'>('image/webp')
const quality = ref(0.8)
const maxWidth = ref(1920)
const beforeSize = ref(0)
const afterUrl = ref('')
const afterSize = ref(0)
const working = ref(false)
const dims = ref({ w: 0, h: 0, outW: 0, outH: 0 })

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(2)} MB`
}

async function pick(files: FileList | null) {
  const f = files?.[0]
  if (!f || !f.type.startsWith('image/')) return
  file.value = f
  beforeSize.value = f.size
  afterUrl.value = ''
  afterSize.value = 0
  await convert()
}

async function loadImage(f: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f)
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

async function convert() {
  if (!file.value) return
  working.value = true
  try {
    const img = await loadImage(file.value)
    const scale = Math.min(1, maxWidth.value / img.naturalWidth)
    const outW = Math.round(img.naturalWidth * scale)
    const outH = Math.round(img.naturalHeight * scale)
    dims.value = { w: img.naturalWidth, h: img.naturalHeight, outW, outH }

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')!
    // JPEG 不支持透明，铺白底
    if (format.value === 'image/jpeg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, outW, outH)
    }
    ctx.drawImage(img, 0, 0, outW, outH)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, format.value, format.value === 'image/png' ? undefined : quality.value)
    )
    if (!blob) throw new Error('导出失败')
    if (afterUrl.value) URL.revokeObjectURL(afterUrl.value)
    afterUrl.value = URL.createObjectURL(blob)
    afterSize.value = blob.size
  } finally {
    working.value = false
  }
}

const ext = computed(() => ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[format.value]))
const ratio = computed(() => (beforeSize.value ? Math.round((1 - afterSize.value / beforeSize.value) * 100) : 0))

function download() {
  if (!afterUrl.value) return
  const a = document.createElement('a')
  a.href = afterUrl.value
  const base = (file.value?.name ?? 'image').replace(/\.[^.]+$/, '')
  a.download = `${base}.${ext.value}`
  a.click()
}
</script>

<template>
  <div class="tool-pad">
    <div v-if="!owned" class="card buywall">
      <p class="title">图片格式转换压缩器 · 一次性买断</p>
      <p class="muted">本地批量转换 PNG / JPEG / WebP，按质量与尺寸压缩，照片不上传、无水印、不限次数。</p>
      <p class="price">{{ billing.priceText(billing.plan.priceCents) }} · 一次付费永久使用</p>
      <button class="btn btn-primary" :disabled="buying" @click="buy">
        {{ buying ? '支付中…' : '立即买断（本地演示支付）' }}
      </button>
      <p class="faint small">当前为本地模拟支付，点击即解锁；正式上线后跳转真实收银台。</p>
    </div>

    <template v-else>
      <label class="picker card">
        <input type="file" accept="image/*" hidden @change="pick(($event.target as HTMLInputElement).files)" />
        {{ file ? `已选择：${file.name}` : '点击选择图片（仅在本地处理，不上传）' }}
      </label>

      <div class="card box controls">
        <label>
          输出格式
          <select v-model="format" @change="convert">
            <option value="image/webp" :disabled="!supportsWebp">WebP（体积最小）</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG（无损）</option>
          </select>
        </label>
        <label v-if="format !== 'image/png'">
          质量 {{ Math.round(quality * 100) }}%
          <input v-model.number="quality" type="range" min="0.3" max="1" step="0.05" @change="convert" />
        </label>
        <label>
          最大宽度 {{ maxWidth }}px
          <input v-model.number="maxWidth" type="range" min="120" max="4096" step="16" @change="convert" />
        </label>
        <span v-if="!supportsWebp" class="faint small">当前浏览器不支持 WebP 导出</span>
      </div>

      <div v-if="afterUrl" class="card box result">
        <img :src="afterUrl" alt="转换结果预览" />
        <div class="meta">
          <p>原始：{{ humanSize(beforeSize) }}（{{ dims.w }}×{{ dims.h }}）</p>
          <p>转换后：<b>{{ humanSize(afterSize) }}</b>（{{ dims.outW }}×{{ dims.outH }}）</p>
          <p :class="ratio >= 0 ? 'down' : 'up'">
            {{ ratio >= 0 ? `减小约 ${ratio}%` : `增大 ${-ratio}%（建议换格式/降质量）` }}
          </p>
          <button class="btn btn-primary" @click="download" :disabled="working">下载 .{{ ext }}</button>
        </div>
      </div>
      <p v-if="working" class="muted">正在转换…</p>
    </template>
  </div>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.buywall {
  padding: 28px;
  text-align: center;
  border-color: var(--accent);
}
.title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 8px;
}
.price {
  font-size: 24px;
  color: var(--accent);
  font-weight: 700;
}
.small {
  font-size: 12px;
}
.picker {
  display: block;
  text-align: center;
  padding: 34px 20px;
  border: 2px dashed var(--line);
  cursor: pointer;
}
.picker:hover {
  border-color: var(--brand);
}
.controls {
  padding: 14px 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: center;
}
.controls label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  min-width: 180px;
  flex: 1;
}
select,
input[type='range'] {
  padding: 6px 8px;
}
.result {
  padding: 18px;
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
}
.result img {
  max-width: min(360px, 100%);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.meta {
  flex: 1;
  min-width: 200px;
}
.meta p {
  margin: 6px 0;
}
.down {
  color: var(--brand-dark);
  font-weight: 700;
}
.up {
  color: var(--accent);
  font-weight: 700;
}
</style>
