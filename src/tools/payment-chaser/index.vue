<script setup lang="ts">
/**
 * payment-chaser —— 自由职业者应收/追款。
 * 台账 → 账龄看板 → 梯度话术 → 留痕时间线 → 证据包 PDF / CSV / JSON。全程本地。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { manifest, FREE_INVOICE_LIMIT } from './manifest'
import { buildDashboard, centsToYuan, daysOverdue, stageOf, statusLabel } from './lib/aging'
import { renderLetter } from './lib/templates'
import { buildEvidencePdf, download, toCsv, toJson } from './lib/evidence'
import { deleteInvoice, listInvoices, newId, putInvoice } from './lib/store'
import type { Invoice } from './lib/models'

useSeo({
  title: '自由职业追款助手 - 本地应收台账与催收证据包 | 方子',
  description:
    '自由职业者/一人公司本地应收台账：账龄看板、三档梯度催收话术、沟通留痕时间线，一键导出投诉/起诉证据包 PDF，数据不上传。',
  type: 'SoftwareApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)

const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

const invoices = ref<Invoice[]>([])
const loading = ref(true)
const busy = ref(false)
const toast = ref('')

const form = reactive({
  clientName: '',
  projectName: '',
  amountYuan: '',
  dueDate: todayStr,
  note: ''
})

const selectedId = ref<string>('')
const letterText = ref('')
const timelineForm = reactive({ note: '', method: '微信' as Invoice['timeline'][number]['method'], response: '' })

const dashboard = computed(() => buildDashboard(invoices.value, todayStr))
const selected = computed(() => invoices.value.find((i) => i.id === selectedId.value) ?? null)

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2600)
}

async function reload() {
  invoices.value = await listInvoices()
  loading.value = false
}

onMounted(reload)

async function submit() {
  if (!form.clientName.trim() || !form.projectName.trim()) return showToast('请填写客户与项目')
  const yuan = parseFloat(form.amountYuan)
  if (!yuan || yuan <= 0) return showToast('请填写有效金额')
  if (invoices.value.length >= FREE_INVOICE_LIMIT && !billing.canUse('unlimited').allowed) {
    showToast(`免费版最多 ${FREE_INVOICE_LIMIT} 笔，买断后不限客户`)
    await billing.buy()
    return
  }
  const inv: Invoice = {
    id: newId(),
    clientName: form.clientName.trim(),
    projectName: form.projectName.trim(),
    amountCents: Math.round(yuan * 100),
    dueDate: form.dueDate,
    paid: false,
    note: form.note.trim(),
    timeline: [],
    createdAt: new Date().toISOString()
  }
  await putInvoice(inv)
  form.clientName = form.projectName = form.amountYuan = form.note = ''
  await reload()
  showToast('已入账')
}

async function markPaid(inv: Invoice) {
  await putInvoice({ ...inv, paid: true, paidDate: todayStr })
  await reload()
}

async function remove(inv: Invoice) {
  await deleteInvoice(inv.id)
  await reload()
}

function pickLetter(inv: Invoice) {
  selectedId.value = inv.id
  const days = daysOverdue(inv, todayStr)
  const stage = stageOf(Math.max(days, 0))
  letterText.value = renderLetter(stage, {
    client: inv.clientName,
    project: inv.projectName,
    amount: centsToYuan(inv.amountCents),
    dueDate: inv.dueDate,
    days: Math.max(days, 0)
  })
}

function copyLetter() {
  navigator.clipboard.writeText(letterText.value).then(() => showToast('话术已复制'))
}

async function addTimeline() {
  if (!selected.value) return
  if (!timelineForm.note.trim()) return showToast('请填写本次催收内容')
  const inv = { ...selected.value }
  inv.timeline = [
    ...inv.timeline,
    {
      id: newId(),
      date: todayStr,
      method: timelineForm.method,
      note: timelineForm.note.trim(),
      response: timelineForm.response.trim() || undefined
    }
  ]
  await putInvoice(inv)
  timelineForm.note = ''
  timelineForm.response = ''
  await reload()
  if (selectedId.value) pickLetter(invoices.value.find((i) => i.id === selectedId.value)!)
  showToast('已留痕')
}

async function exportPdf() {
  if (!billing.canUse('evidence-pdf').allowed) {
    showToast('证据包 PDF 为买断功能')
    await billing.buy()
    return
  }
  busy.value = true
  try {
    const blob = await buildEvidencePdf(invoices.value)
    download(blob, `追款证据包-${todayStr}.pdf`)
    showToast('PDF 已导出')
  } catch (e) {
    showToast('导出失败：' + (e as Error).message)
  } finally {
    busy.value = false
  }
}

async function exportCsv() {
  if (!billing.canUse('unlimited').allowed) {
    showToast('批量 CSV/JSON 导出为买断功能')
    await billing.buy()
    return
  }
  download(new Blob(['﻿' + toCsv(invoices.value)], { type: 'text/csv' }), `应收台账-${todayStr}.csv`)
  showToast('CSV 已导出')
}

function exportJson() {
  if (!billing.canUse('unlimited').allowed) return billing.buy()
  download(new Blob([toJson(invoices.value)], { type: 'application/json' }), `应收台账-${todayStr}.json`)
  showToast('JSON 已导出')
}

const METHOD_LABELS = ['微信', '电话', '邮件', '面访', '其他'] as const
</script>

<template>
  <article class="pc">
    <header class="hero">
      <h1>{{ manifest.name }}</h1>
      <p class="tagline">{{ manifest.tagline }}</p>
      <p class="privacy">🔒 全部数据只存在本机浏览器，不上传、无账号；离线可用。</p>
    </header>

    <section class="card">
      <h2>新增一笔应收</h2>
      <form class="grid" @submit.prevent="submit">
        <input v-model="form.clientName" placeholder="客户名称（如：王总 / XX公司）" />
        <input v-model="form.projectName" placeholder="项目（如：官网设计 V2）" />
        <input v-model="form.amountYuan" type="number" inputmode="decimal" placeholder="金额（元，如 8000）" />
        <label class="row">约定付款日 <input v-model="form.dueDate" type="date" /></label>
        <input v-model="form.note" placeholder="备注（合同号/发票号/交付情况，可选）" />
        <button type="submit" class="primary">入账</button>
      </form>
    </section>

    <section class="card">
      <div class="bar">
        <h2>账龄 / 现金流看板</h2>
        <span class="total">待收合计 {{ centsToYuan(dashboard.totalOutstandingCents) }}（{{ dashboard.totalOutstandingCount }} 笔）</span>
      </div>
      <div class="buckets">
        <div v-for="b in dashboard.buckets" :key="b.key" class="bucket">
          <div class="b-label">{{ b.label }}</div>
          <div class="b-amount">{{ centsToYuan(b.cents) }}</div>
          <div class="b-count">{{ b.count }} 笔</div>
        </div>
      </div>
      <p v-if="dashboard.badDebtCents > 0" class="warn">⚠ 逾期 90 天以上疑似坏账 {{ centsToYuan(dashboard.badDebtCents) }}，建议尽快升级投诉/起诉。</p>
    </section>

    <section class="card">
      <div class="bar">
        <h2>应收台账</h2>
        <div class="actions">
          <button @click="exportPdf" :disabled="busy">{{ busy ? '生成中…' : '导出证据包 PDF' }}</button>
          <button @click="exportCsv">导出 CSV</button>
          <button @click="exportJson">导出 JSON</button>
        </div>
      </div>
      <p v-if="loading">载入中…</p>
      <p v-else-if="invoices.length === 0" class="empty">还没有应收，先在上面加一笔。</p>
      <ul v-else class="list">
        <li v-for="inv in invoices" :key="inv.id" :class="{ paid: inv.paid }">
          <div class="li-main">
            <div class="li-title">{{ inv.clientName}} · {{ inv.projectName }}</div>
            <div class="li-meta">
              {{ centsToYuan(inv.amountCents) }}｜应付 {{ inv.dueDate }}｜
              <b v-if="inv.paid">已结清</b>
              <b v-else :class="statusLabel(daysOverdue(inv, todayStr)).tone === 'overdue' ? 'danger' : 'muted'">{{ statusLabel(daysOverdue(inv, todayStr)).text }}</b>
              ｜催收 {{ inv.timeline.length }} 次
            </div>
            <div v-if="inv.note" class="li-note">备注：{{ inv.note }}</div>
          </div>
          <div class="li-btns">
            <button v-if="!inv.paid" @click="pickLetter(inv)">生成话术</button>
            <button v-if="!inv.paid" @click="markPaid(inv)">标记已收</button>
            <button class="ghost" @click="remove(inv)">删除</button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="selected" class="card">
      <h2>梯度催收话术 · {{ selected.clientName }}</h2>
      <p class="hint">按逾期天数自动选档：1–7 天礼貌提醒 / 8–29 天正式催告 / 30 天以上最后通牒。可直接复制为微信或邮件。</p>
      <pre class="letter">{{ letterText }}</pre>
      <div class="bar">
        <button class="primary" @click="copyLetter">复制话术</button>
      </div>
      <h3>沟通留痕时间线</h3>
      <ul class="timeline">
        <li v-for="t in selected.timeline" :key="t.id">
          <b>{{ t.date }} {{ t.method }}</b>：{{ t.note }}<span v-if="t.response">　对方：{{ t.response }}</span>
        </li>
      </ul>
      <form class="tl" @submit.prevent="addTimeline">
        <select v-model="timelineForm.method">
          <option v-for="m in METHOD_LABELS" :key="m" :value="m">{{ m }}</option>
        </select>
        <input v-model="timelineForm.note" placeholder="这次催收说了什么（如：发了催告函/电话沟通）" />
        <input v-model="timelineForm.response" placeholder="对方回应（可选）" />
        <button type="submit">留痕</button>
      </form>
    </section>

    <section class="card">
      <h2>维权入口（本地指引，不代提交）</h2>
      <ul class="links">
        <li>全国违约拖欠中小企业款项投诉平台：<b>sme-dj.miit.gov.cn</b>（2025-06 起施行《保障中小企业款项支付条例》）</li>
        <li>消费者投诉：12315 平台 / 全国12315小程序</li>
        <li>证据包请用上方「导出证据包 PDF」，连同合同/发票/交付记录一并留存。</li>
      </ul>
    </section>

    <p v-if="toast" class="toast">{{ toast }}</p>
  </article>
</template>

<style scoped>
.pc { width: 100%; max-width: 880px; margin: 0 auto; padding: 16px; box-sizing: border-box; min-width: 0; overflow-wrap: anywhere; }
.hero h1 { font-size: 22px; margin: 0 0 6px; }
.tagline { color: #374151; margin: 0 0 4px; line-height: 1.6; }
.privacy { color: #047857; font-size: 13px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 14px 0; }
h2 { font-size: 16px; margin: 0 0 10px; }
h3 { font-size: 14px; margin: 14px 0 6px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.grid input, .tl input, .tl select { padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; min-height: 44px; }
.grid .row { display: flex; align-items: center; gap: 8px; grid-column: span 2; }
.grid button, .bar button, .li-btns button, .tl button { min-height: 44px; padding: 0 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #f9fafb; cursor: pointer; }
.grid button.primary, .bar button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.total { color: #b91c1c; font-weight: 600; }
.buckets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.bucket { background: #f9fafb; border-radius: 8px; padding: 10px; text-align: center; }
.b-label { font-size: 12px; color: #6b7280; }
.b-amount { font-weight: 600; margin: 4px 0; }
.b-count { font-size: 12px; color: #6b7280; }
.warn { color: #b91c1c; font-size: 13px; }
.list { list-style: none; padding: 0; margin: 10px 0 0; }
.list li { display: flex; justify-content: space-between; gap: 10px; border-top: 1px solid #f1f5f9; padding: 10px 0; }
.list li.paid { opacity: .5; }
.li-title { font-weight: 600; }
.li-meta { font-size: 13px; color: #6b7280; margin-top: 2px; }
.danger { color: #b91c1c; }
.muted { color: #1d4ed8; font-weight: 500; }
.li-note { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.li-btns { display: flex; flex-direction: column; gap: 6px; }
.li-btns .ghost { color: #6b7280; }
.letter { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.7; }
.hint { color: #6b7280; font-size: 13px; margin: 0 0 8px; }
.timeline { padding-left: 18px; font-size: 14px; }
.tl { display: grid; grid-template-columns: auto 1fr 1fr auto; gap: 8px; margin-top: 8px; }
.links { font-size: 14px; line-height: 1.9; padding-left: 18px; }
.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #111827; color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 14px; }
.empty { color: #9ca3af; }
@media (max-width: 640px) {
  .grid { grid-template-columns: 1fr; }
  .grid .row { grid-column: span 1; }
  .buckets { grid-template-columns: repeat(2, 1fr); }
  .tl { grid-template-columns: 1fr; }
  .list li { flex-direction: column; }
}
</style>
