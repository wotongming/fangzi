<script setup lang="ts">
/**
 * 创作归因台 —— 全部数据只存本地 IndexedDB，离线可用。
 * 合规：不接任何平台 API、不抓包、不内嵌平台网页；数据仅手动录入与 CSV 导入。
 */
import { computed, onMounted, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { manifest } from './manifest'
import type { Account, Content, ContentFormat, Deal, DealResult, MetricSnapshot } from './lib/types'
import { createId, FREE_ACCOUNT_LIMIT, FREE_CONTENT_LIMIT } from './lib/types'
import {
  getAllAccounts,
  getAllContents,
  getAllDeals,
  getAllMetrics,
  putAccount,
  putContent,
  putDeal,
  putMetric,
  removeAccountCascade,
  removeContentCascade,
  removeDeal
} from './lib/store'
import { parseCsvImport, type CsvContentDraft } from './lib/csv'
import LedgerView from './components/LedgerView.vue'
import AttributionBoard from './components/AttributionBoard.vue'
import DealBook from './components/DealBook.vue'
import MonthlyReport from './components/MonthlyReport.vue'

useSeo({
  title: '创作归因台 - 多平台内容台账/四维收益归因/商单报价/月报',
  description:
    '同时运营抖音、小红书、B站、公众号的独立创作者，把每周逐平台手抄的阅读、收益、工时录成本地台账，按主题/形式/平台/发布时段四维归因单位收益与时薪ROI，附商单报价区间与月度经营报告。全程本地存储，不接平台API、不上云。',
  type: 'SoftwareApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canUnlimited = computed(() => billing.canUse('unlimited-account').allowed)
const canCsv = computed(() => billing.canUse('csv-import').allowed)
const canBoard = computed(() => billing.canUse('attribution-board').allowed)
const canDeals = computed(() => billing.canUse('deal-book').allowed)
const canReport = computed(() => billing.canUse('monthly-report').allowed)
const priceText = computed(() => billing.priceText(billing.plan.priceCents))
async function upgrade() {
  await billing.buy('freemium-pro')
  await reload()
}

// —— 数据 ——
const accounts = ref<Account[]>([])
const contents = ref<Content[]>([])
const metrics = ref<MetricSnapshot[]>([])
const deals = ref<Deal[]>([])
const loaded = ref(false)
const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2600)
}
function freeze<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

async function reload() {
  const [a, c, m, d] = await Promise.all([getAllAccounts(), getAllContents(), getAllMetrics(), getAllDeals()])
  accounts.value = a.sort((x, y) => x.createdAt - y.createdAt)
  contents.value = c
  metrics.value = m
  deals.value = d
  loaded.value = true
}
onMounted(reload)

// —— 页签 ——
const tab = ref<'ledger' | 'board' | 'deals' | 'report'>('ledger')
const showUpgrade = ref(false)

// —— 账号 / 内容 / 数据 处理 ——
async function onAddAccount(p: { platform: string; nickname: string }) {
  await putAccount(freeze({ id: createId('ac'), platform: p.platform, nickname: p.nickname, createdAt: Date.now() }))
  await reload()
  notify('账号已建立 ✓')
}
async function onRemoveAccount(id: string) {
  await removeAccountCascade(id)
  await reload()
  notify('账号及其数据已删除')
}
async function onAddContent(p: {
  accountId: string
  title: string
  tags: string[]
  format: ContentFormat
  publishedAt: number
  hours: number
}) {
  await putContent(
    freeze({
      id: createId('ct'),
      accountId: p.accountId,
      title: p.title,
      tags: p.tags,
      format: p.format,
      publishedAt: p.publishedAt,
      hours: p.hours,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  )
  await reload()
  notify('内容已入台账 ✓')
}
async function onRemoveContent(id: string) {
  await removeContentCascade(id)
  await reload()
}
async function onAddMetric(p: {
  contentId: string
  capturedAt: number
  views: number
  followersDelta: number
  revenueYuan: number
  note: string
}) {
  await putMetric(
    freeze({
      id: createId('mt'),
      contentId: p.contentId,
      capturedAt: p.capturedAt,
      views: p.views,
      followersDelta: p.followersDelta,
      revenueCents: Math.round(p.revenueYuan * 100),
      note: p.note
    })
  )
  await reload()
  notify('数据快照已保存 ✓')
}

// —— 商单 ——
async function onAddDeal(p: { accountId: string; brand: string; date: number; amountCents: number; result: DealResult; note: string }) {
  await putDeal(freeze({ id: createId('dl'), ...p }))
  await reload()
  notify('商单已记录 ✓')
}
async function onRemoveDeal(id: string) {
  await removeDeal(id)
  await reload()
}

// —— CSV 导入（先预览，确认后落库） ——
interface CsvPreview {
  encoding: 'utf-8' | 'gbk'
  drafts: CsvContentDraft[]
  skipped: number
}
const preview = ref<CsvPreview | null>(null)
const previewAccountId = ref('')
async function onImportFile(file: File) {
  try {
    const buf = await file.arrayBuffer()
    const res = parseCsvImport(buf)
    if (!accounts.value.length) {
      notify('请先在「台账」建一个账号，CSV 内容会挂到第一个账号下')
      return
    }
    previewAccountId.value = accounts.value[0]!.id
    preview.value = res
  } catch (e) {
    notify((e as Error).message || 'CSV 解析失败')
  }
}
async function confirmImport() {
  if (!preview.value) return
  const accId = previewAccountId.value
  for (const d of preview.value.drafts) {
    const c: Content = freeze({
      id: createId('ct'),
      accountId: accId,
      title: d.title,
      tags: d.tags,
      format: d.format,
      publishedAt: d.publishedAt,
      hours: d.hours,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    await putContent(c)
    if (d.views > 0 || d.revenueCents > 0) {
      await putMetric(
        freeze({
          id: createId('mt'),
          contentId: c.id,
          capturedAt: d.publishedAt,
          views: d.views,
          followersDelta: 0,
          revenueCents: d.revenueCents,
          note: 'CSV 导入快照'
        })
      )
    }
  }
  const n = preview.value.drafts.length
  const enc = preview.value.encoding
  preview.value = null
  await reload()
  notify(`已导入 ${n} 条内容（${enc.toUpperCase()}）`)
}
</script>

<template>
  <div class="ca-app">
    <div class="apphead">
      <h1 class="app-title">创作归因台</h1>
      <nav class="seg" aria-label="功能导航">
        <button :class="{ on: tab === 'ledger' }" @click="tab = 'ledger'">📝 台账</button>
        <button :class="{ on: tab === 'board' }" @click="canBoard ? (tab = 'board') : (showUpgrade = true)">📊 归因</button>
        <button :class="{ on: tab === 'deals' }" @click="canDeals ? (tab = 'deals') : (showUpgrade = true)">💰 商单</button>
        <button :class="{ on: tab === 'report' }" @click="canReport ? (tab = 'report') : (showUpgrade = true)">📅 报告</button>
      </nav>
    </div>

    <main class="page">
      <section v-if="tab === 'ledger'" v-show="loaded">
        <LedgerView
          :accounts="accounts"
          :contents="contents"
          :metrics="metrics"
          :can-unlimited="canUnlimited"
          :can-csv="canCsv"
          @add-account="onAddAccount"
          @remove-account="onRemoveAccount"
          @add-content="onAddContent"
          @remove-content="onRemoveContent"
          @add-metric="onAddMetric"
          @import-file="onImportFile"
          @show-upgrade="showUpgrade = true"
        />
      </section>

      <section v-else-if="tab === 'board'" class="page-section">
        <div class="card">
          <div class="card-h">📊 四维归因</div>
          <p class="muted tiny">按主题 / 形式 / 平台 / 发布时段，汇总条数、阅读、收益、单位收益与时薪 ROI。</p>
          <AttributionBoard :contents="contents" :metrics="metrics" :accounts="accounts" />
        </div>
      </section>

      <section v-else-if="tab === 'deals'" class="page-section">
        <DealBook :accounts="accounts" :deals="deals" @add="onAddDeal" @remove="onRemoveDeal" />
      </section>

      <section v-else-if="tab === 'report'" class="page-section">
        <MonthlyReport :contents="contents" :metrics="metrics" :accounts="accounts" :deals="deals" />
      </section>
    </main>

    <!-- CSV 导入预览 -->
    <div v-if="preview" class="modal-mask" @click.self="preview = null">
      <div class="modal">
        <h3>CSV 导入预览</h3>
        <p class="muted tiny">编码：{{ preview.encoding.toUpperCase() }} · 将挂到账号 {{ accounts.find((a) => a.id === previewAccountId)?.nickname }}</p>
        <p class="preview-stat">解析到 <strong>{{ preview.drafts.length }}</strong> 条有效内容，跳过 <strong>{{ preview.skipped }}</strong> 条（缺标题/日期）。</p>
        <p class="muted tiny">导入为追加、不覆盖已有台账。确认后开始写入。</p>
        <div class="row-ops">
          <button class="btn" @click="preview = null">取消</button>
          <button class="btn primary" @click="confirmImport">确认导入</button>
        </div>
      </div>
    </div>

    <!-- 升级弹层 -->
    <div v-if="showUpgrade" class="modal-mask" @click.self="showUpgrade = false">
      <div class="modal">
        <h3>专业版</h3>
        <ul class="feat">
          <li>账号与内容条数不限（免费 {{ FREE_ACCOUNT_LIMIT }} 账号 / {{ FREE_CONTENT_LIMIT }} 条）</li>
          <li>CSV 批量导入历史台账</li>
          <li>四维归因看板（主题/形式/平台/时段）</li>
          <li>商单记录与近 30 天报价参考</li>
          <li>月度经营报告 Markdown 导出</li>
        </ul>
        <p class="muted">一次买断 {{ priceText }}，数据仍只保存在本机，不上云。</p>
        <div class="row-ops">
          <button class="btn" @click="showUpgrade = false">再想想</button>
          <button class="btn primary" @click="upgrade">升级专业版</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.ca-app {
  min-height: 100%;
  background: #f4f6fa;
  color: #1f2430;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
}
.apphead {
  position: sticky;
  top: 0;
  z-index: 20;
  background: #f4f6fa;
  border-bottom: 1px solid #e6e9ef;
  padding: 0.5rem 0.75rem 0.45rem;
}
.app-title {
  font-size: 1.15rem;
  margin: 0 0 0.5rem;
}
.seg {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.3rem;
}
.seg button {
  border: 1px solid #e6e9ef;
  background: #fff;
  border-radius: 0.6rem;
  padding: 0.5rem 0.1rem;
  font-size: 0.84rem;
  color: #5c6370;
  min-height: 44px;
  cursor: pointer;
}
.seg button.on {
  border-color: #3b7dd8;
  background: #e8f0fd;
  color: #2a5fb0;
  font-weight: 700;
}
.page {
  padding: 0.85rem 0.85rem calc(1rem + env(safe-area-inset-bottom, 0px));
  max-width: 760px;
  margin: 0 auto;
}
.card {
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 0.9rem;
  padding: 0.9rem;
  margin-bottom: 0.8rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.55rem;
}
.muted {
  color: #828a99;
}
.tiny {
  font-size: 0.78rem;
}
.row-ops {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
.btn {
  appearance: none;
  border: 1px solid #e6e9ef;
  background: #fff;
  border-radius: 0.6rem;
  padding: 0.55rem 0.9rem;
  font-size: 0.88rem;
  cursor: pointer;
  min-height: 44px;
}
.btn.primary {
  background: #3b7dd8;
  border-color: #3b7dd8;
  color: #fff;
}
.preview-stat {
  font-size: 0.95rem;
  margin: 0.5rem 0;
}
.feat {
  margin: 0.5rem 0;
  padding-left: 1.1rem;
}
.feat li {
  margin: 0.3rem 0;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 32, 0.45);
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.modal {
  background: #fff;
  width: 100%;
  max-width: 560px;
  border-radius: 1rem 1rem 0 0;
  padding: 1rem 1.1rem calc(1.2rem + env(safe-area-inset-bottom, 0px));
  max-height: 88vh;
  overflow-y: auto;
}
@media (min-width: 640px) {
  .modal-mask {
    align-items: center;
  }
  .modal {
    border-radius: 1rem;
    margin: 1rem;
  }
}
.modal label {
  display: block;
  font-size: 0.82rem;
  color: #556;
  margin: 0.6rem 0 0.25rem;
}
.modal input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e6e9ef;
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  font-size: 16px;
}
.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(4.8rem + env(safe-area-inset-bottom, 0px));
  background: rgba(30, 34, 40, 0.92);
  color: #fff;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  font-size: 0.85rem;
  z-index: 60;
  max-width: 86vw;
  text-align: center;
}
</style>
