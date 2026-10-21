<script setup lang="ts">
/**
 * 小票本（receipt-vault）——本地 OCR 小票/发票，抽字段、按项目挂账、导出 CSV。
 * 图片与文本全程浏览器本地处理，不上传、无后端。独立 IDB 库 fz-receipt-vault-v1。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { ocrImage } from './lib/ocr'
import { parseReceipt, toCsv, summarizeByCategory, type ReceiptRecord } from './lib/extract'
import { allReceipts, saveReceipt, deleteReceipt } from './lib/store'
import { readBillFile, toRecords, type BillPreviewRow } from './lib/bill-import'

useSeo({
  title: '小票本 - 本地OCR抽字段/项目挂账/CSV报税导出（不上传）',
  description:
    '拍照小票发票本地 OCR 识别商家/日期/金额/税额，人工校对后按项目挂账，导出 CSV 报销报税。图片不上传、纯本地处理。',
  type: 'SoftwareApplication',
  keywords: ['小票OCR', '发票识别', '报销记账', '报税', '本地OCR', '不上传', 'CSV导出', '收据管理']
})

const billing = useToolBilling('receipt-vault')
void billing

const records = ref<ReceiptRecord[]>([])
const file = ref<File | null>(null)
const ocrBusy = ref(false)
const ocrText = ref('')
const categories = ['差旅', '餐饮', '办公', '交通', '其它']

const draft = reactive({
  date: '',
  merchant: '',
  amount: '',
  tax: '',
  category: '餐饮',
  note: ''
})

const toast = ref('')
function notify(m: string) {
  toast.value = m
  setTimeout(() => { if (toast.value === m) toast.value = '' }, 2400)
}

async function refresh() {
  records.value = await allReceipts()
}

onMounted(refresh)

async function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  file.value = f
  ocrBusy.value = true
  try {
    const { text } = await ocrImage(f)
    ocrText.value = text
    const p = parseReceipt(text)
    draft.date = p.date
    draft.merchant = p.merchant
    draft.amount = p.amount
    draft.tax = p.tax
    notify(p.confidence < 0.5 ? '识别完成，置信度较低，请人工校对' : '识别完成')
  } catch (err) {
    notify('识别失败：' + (err as Error).message)
  } finally {
    ocrBusy.value = false
  }
}

// —— 账单文件批量导入（微信/支付宝 xlsx/csv）——
const billBusy = ref(false)
const billRows = ref<Array<BillPreviewRow & { checked: boolean }>>([])
const billCategory = ref('餐饮')
async function onBillFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  billBusy.value = true
  try {
    const rows = await readBillFile(f)
    billRows.value = rows.map((r) => ({ ...r, checked: true }))
    notify(`解析到 ${rows.length} 笔，请勾选后入账`)
  } catch (err) {
    notify('账单导入失败：' + (err as Error).message)
  } finally {
    billBusy.value = false
  }
}
async function importChecked() {
  const picked = billRows.value.filter((r) => r.checked)
  if (!picked.length) { notify('未勾选任何记录'); return }
  for (const rec of toRecords(picked, billCategory.value)) await saveReceipt(rec)
  await refresh()
  billRows.value = []
  notify(`已入账 ${picked.length} 笔`)
}

async function saveCurrent() {
  if (!draft.amount) { notify('请至少填金额'); return }
  const rec: ReceiptRecord = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: draft.date || new Date().toISOString().slice(0, 10),
    merchant: draft.merchant,
    amount: draft.amount,
    tax: draft.tax,
    category: draft.category,
    note: draft.note,
    createdAt: Date.now()
  }
  await saveReceipt(rec)
  await refresh()
  notify('已保存')
}

async function remove(id: string) {
  await deleteReceipt(id)
  await refresh()
}

function exportCsv() {
  const csv = toCsv(records.value)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'receipts.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const summary = computed(() => summarizeByCategory(records.value))
const total = computed(() => records.value.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0))

// 测试接缝
;(window as unknown as Record<string, unknown>).__receiptVault = {
  parse: (t: string) => parseReceipt(t),
  csv: (rows: ReceiptRecord[]) => toCsv(rows),
  save: (r: ReceiptRecord) => saveReceipt(r),
  all: () => allReceipts()
}
</script>

<template>
  <div class="rv">
    <header class="rv-head">
      <h2>小票本</h2>
      <p class="rv-sub">拍照小票/发票，<b>本地 OCR</b> 抽字段、人工校对、按项目挂账，导出 CSV 报销报税。图片不上传。</p>
    </header>

    <div class="rv-grid">
      <section class="rv-card">
        <label class="rv-btn">
          {{ ocrBusy ? '识别中…' : '选择小票图片' }}
          <input type="file" accept="image/*" hidden @change="onPick" :disabled="ocrBusy" />
        </label>
        <div v-if="ocrText" class="rv-raw">{{ ocrText.slice(0, 600) }}</div>
        <div class="rv-form">
          <label>商家<input v-model="draft.merchant" placeholder="商家名" /></label>
          <label>日期<input v-model="draft.date" placeholder="2026-10-21" /></label>
          <label>金额<input v-model="draft.amount" inputmode="decimal" placeholder="0.00" /></label>
          <label>税额<input v-model="draft.tax" inputmode="decimal" placeholder="0.00" /></label>
          <label>项目
            <select v-model="draft.category">
              <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
          <label>备注<input v-model="draft.note" /></label>
        </div>
        <button class="rv-btn primary" :disabled="ocrBusy" @click="saveCurrent">保存记录</button>

        <hr style="margin:14px 0;border:none;border-top:1px dashed #cdd6d0" />
        <label class="rv-btn">
          {{ billBusy ? '解析中…' : '导入微信/支付宝账单(xlsx)' }}
          <input type="file" accept=".xlsx,.xls,.csv" hidden @change="onBillFile" :disabled="billBusy" />
        </label>
        <div v-if="billRows.length" class="rv-bill">
          <div class="rv-row">
            <b>预览 {{ billRows.filter(r=>r.checked).length }}/{{ billRows.length }} 笔</b>
            <select v-model="billCategory"><option v-for="c in categories" :key="c" :value="c">{{ c }}</option></select>
          </div>
          <ul class="rv-list">
            <li v-for="(r,i) in billRows" :key="i" class="rv-item">
              <input type="checkbox" v-model="r.checked" />
              <div><b>{{ r.merchant }}</b> · {{ r.date }}<div class="rv-meta">{{ r.note }}</div></div>
              <span :style="{color: r.amount.startsWith('-') ? '#b55' : '#1f7a4d'}">¥{{ r.amount }}</span>
            </li>
          </ul>
          <button class="rv-btn primary" @click="importChecked">入账勾选记录</button>
        </div>
      </section>

      <section class="rv-card">
        <div class="rv-row">
          <b>已记 {{ records.length }} 张 · 合计 ¥{{ total.toFixed(2) }}</b>
          <button class="rv-btn" @click="exportCsv">导出 CSV</button>
        </div>
        <p v-for="(v, k) in summary" :key="k" class="rv-sum">{{ k }}：¥{{ v.toFixed(2) }}</p>
        <ul class="rv-list">
          <li v-for="r in records" :key="r.id" class="rv-item">
            <div><b>{{ r.merchant || '(未命名)' }}</b> · {{ r.category }}</div>
            <div class="rv-meta">{{ r.date }} · ¥{{ r.amount }}<span v-if="r.tax"> 税¥{{ r.tax }}</span></div>
            <button class="rv-x" @click="remove(r.id)">×</button>
          </li>
        </ul>
        <p v-if="!records.length" class="rv-empty">还没有记录，拍一张小票开始。</p>
      </section>
    </div>
    <p v-if="toast" class="rv-toast">{{ toast }}</p>
  </div>
</template>

<style scoped>
.rv { max-width: 980px; margin: 0 auto; padding: 16px; }
.rv-head h2 { font-size: 20px; margin: 0 0 6px; }
.rv-sub { color: #556; font-size: 13px; line-height: 1.6; }
.rv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 760px) { .rv-grid { grid-template-columns: 1fr; } .rv { padding: 10px; } .rv-card { padding: 10px; } }
.rv-card { background: #fff; border: 1px solid #e2e8e4; border-radius: 12px; padding: 14px; }
.rv-btn { display: inline-block; border: 1px solid #1f7a4d; background: #fff; color: #1f7a4d; border-radius: 10px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
.rv-btn.primary { background: #1f7a4d; color: #fff; }
.rv-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
.rv-form label { font-size: 12px; color: #667; display: flex; flex-direction: column; gap: 4px; }
.rv-form input, .rv-form select { border: 1px solid #cdd6d0; border-radius: 8px; padding: 8px; font-size: 14px; }
.rv-raw { background: #f4f6f4; border-radius: 8px; padding: 8px; font-size: 11px; color: #667; max-height: 120px; overflow: auto; margin: 10px 0; }
.rv-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.rv-sum { font-size: 13px; color: #1f7a4d; margin: 2px 0; }
.rv-list { list-style: none; padding: 0; margin: 8px 0; }
.rv-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid #eef2ef; font-size: 13px; }
.rv-item > div { flex: 1; }
.rv-meta { color: #889; font-size: 12px; }
.rv-x { border: none; background: none; font-size: 18px; color: #b55; cursor: pointer; }
.rv-empty { color: #99a; font-size: 13px; }
.rv-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #222; color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 13px; }
@media (max-width: 760px) { .rv-form { grid-template-columns: 1fr; } }
</style>
