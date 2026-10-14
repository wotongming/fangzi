<script setup lang="ts">
/**
 * 家庭财务管家 —— 记账 / 看板 / 预算 / 报表 / 洞察 / 备份
 * 数据全部存浏览器 IndexedDB；图表为原生 SVG（零依赖、商用安全）。
 */
import { computed, onMounted, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import type { Category, LedgerEntry, Platform } from './ledger'
import {
  DEFAULT_CATEGORIES,
  PLATFORM_LABELS,
  aggregateByCategory,
  aggregateByPlatform,
  createId,
  currentMonth,
  fmtYuan,
  recentMonths,
  today
} from './ledger'
import type { Budget } from './budget'
import { monthlyBudgetStatus } from './budget'
import { changeRatio, monthlyReport, trendReport } from './report'
import { generateInsights, type Insight } from './insight'
import {
  clearStore,
  decryptBackup,
  encryptBackup,
  exportBackup,
  getAll,
  importBackup,
  put,
  remove
} from './store'

// —— 计费（Freemium：记账/预算免费；报表/洞察/加密备份订阅） ——
const billing = useToolBilling('household-finance')
const canReport = computed(() => billing.canUse('report').allowed)
const canInsight = computed(() => billing.canUse('insight').allowed)
const canSync = computed(() => billing.canUse('sync').allowed)
const priceText = computed(() => billing.priceText(billing.plan.priceCents))
async function upgrade() {
  await billing.buy('freemium-pro')
}

// —— 数据 ——
const entries = ref<LedgerEntry[]>([])
const categories = ref<Category[]>(DEFAULT_CATEGORIES)
const budgets = ref<Budget[]>([])
const loaded = ref(false)
const toast = ref('')

function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2600)
}

async function loadAll() {
  entries.value = await getAll('ledgers')
  const cats = await getAll('categories')
  categories.value = cats.length ? cats : DEFAULT_CATEGORIES
  budgets.value = await getAll('budgets')
  buildBudgetDrafts()
  loaded.value = true
}

onMounted(loadAll)

// —— 页签 ——
type Tab = 'ledger' | 'board' | 'budget' | 'report' | 'insight'
const tab = ref<Tab>('ledger')
const MONTHS = recentMonths(12).reverse() // 升序，用于报表月份选择
const thisMonth = currentMonth()

// —— 记账表单 ——
const entryType = ref<'expense' | 'income'>('expense')
const amountYuan = ref('')
const entryCategory = ref('food')
const entryPlatform = ref<Platform>('wechat')
const entryDate = ref(today())
const note = ref('')
const tagsText = ref('')

const typeCategories = computed(() =>
  categories.value.filter((c) => c.type === entryType.value)
)

// 切换收支类型时把默认分类切到该类型的第一个
function switchType(t: 'expense' | 'income') {
  entryType.value = t
  const first = typeCategories.value[0]
  if (first) entryCategory.value = first.id
}

async function saveEntry() {
  const yuan = Number(amountYuan.value)
  if (!isFinite(yuan) || yuan <= 0) {
    notify('请输入大于 0 的金额')
    return
  }
  const e: LedgerEntry = {
    id: createId(),
    type: entryType.value,
    amountCents: Math.round(yuan * 100),
    category: entryCategory.value,
    platform: entryPlatform.value,
    date: entryDate.value || today(),
    note: note.value.trim() || undefined,
    tags: tagsText.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
    createdAt: Date.now()
  }
  await put('ledgers', e)
  entries.value = await getAll('ledgers')
  amountYuan.value = ''
  note.value = ''
  tagsText.value = ''
  notify('已记一笔 ✓')
}

async function deleteEntry(id: string) {
  await remove('ledgers', id)
  entries.value = await getAll('ledgers')
}

// —— 自定义分类 ——
const newCategoryName = ref('')
async function addCategory() {
  const name = newCategoryName.value.trim()
  if (!name) return
  const exists = categories.value.some((c) => c.name === name && c.type === entryType.value)
  if (exists) {
    notify('该分类已存在')
    return
  }
  const c: Category = { id: createId(), name, type: entryType.value, builtin: false }
  await put('categories', c)
  categories.value = await getAll('categories')
  newCategoryName.value = ''
  entryCategory.value = c.id
}

async function removeCategory(id: string) {
  const c = categories.value.find((x) => x.id === id)
  if (!c || c.builtin) return
  await remove('categories', id)
  categories.value = await getAll('categories')
  if (entryCategory.value === id) {
    const first = typeCategories.value[0]
    if (first) entryCategory.value = first.id
  }
}

// —— 看板 ——
const boardExpense = computed(() => aggregateByCategory(entries.value, { type: 'expense', month: thisMonth }))
const boardIncome = computed(() =>
  entries.value.filter((e) => e.type === 'income' && e.date.startsWith(thisMonth)).reduce((s, e) => s + e.amountCents, 0)
)
const boardPlatform = computed(() => aggregateByPlatform(entries.value, { type: 'expense', month: thisMonth }))
const recentEntries = computed(() => [...entries.value].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 10))

// —— 预算 ——
interface BudgetDraft {
  key: string
  categoryId: string
  label: string
  amountYuan: string
}
const budgetDrafts = ref<BudgetDraft[]>([])

function buildBudgetDrafts() {
  const expenseCats = categories.value.filter((c) => c.type === 'expense')
  const rows: BudgetDraft[] = [
    {
      key: '__all__',
      categoryId: '__all__',
      label: '总预算（全部支出）',
      amountYuan: ''
    },
    ...expenseCats.map((c) => ({
      key: c.id,
      categoryId: c.id,
      label: c.name,
      amountYuan: ''
    }))
  ]
  for (const row of rows) {
    const b = budgets.value.find((x) => x.category === row.categoryId && x.month === '*')
    if (b) row.amountYuan = fmtYuan(b.amountCents)
  }
  budgetDrafts.value = rows
}

async function saveBudgets() {
  for (const row of budgetDrafts.value) {
    // type=number 输入经 v-model 会转成 number，统一按字符串处理
    const raw = String(row.amountYuan ?? '').trim()
    const yuan = Number(raw)
    const existing = budgets.value.find((x) => x.category === row.categoryId && x.month === '*')
    if (!raw) {
      if (existing) await remove('budgets', existing.id)
      continue
    }
    if (!isFinite(yuan) || yuan < 0) continue
    await put('budgets', {
      id: existing?.id ?? createId(),
      category: row.categoryId,
      month: '*',
      amountCents: Math.round(yuan * 100)
    } satisfies Budget)
  }
  budgets.value = await getAll('budgets')
  notify('预算已保存 ✓')
}

const budgetStatus = computed(() => monthlyBudgetStatus(entries.value, budgets.value, thisMonth))

function statusByCat(categoryId: string) {
  return budgetStatus.value.find((s) => s.budget.category === categoryId) ?? null
}
function pct(s: { usedRatio: number }): string {
  return `${Math.min(100, Math.round(s.usedRatio * 100))}%`
}
function pctText(s: { usedRatio: number; over: boolean }): string {
  return s.over ? `超支 ${(s.usedRatio * 100).toFixed(0)}%` : `${(s.usedRatio * 100).toFixed(0)}%`
}

// —— 报表 ——
const reportMonth = ref(thisMonth)
const monthReport = computed(() => monthlyReport(entries.value, reportMonth.value))
const prevMonthExpense = computed(() => {
  const i = MONTHS.indexOf(reportMonth.value)
  if (i <= 0) return null
  const prev = monthlyReport(entries.value, MONTHS[i - 1]!)
  return prev.expenseCents
})
const monthChange = computed(() => {
  if (prevMonthExpense.value === null) return null
  return changeRatio(monthReport.value.expenseCents, prevMonthExpense.value)
})
const yearTrend = computed(() => trendReport(entries.value, MONTHS))

// —— 洞察 ——
const insights = computed<Insight[]>(() => generateInsights(entries.value, budgets.value, thisMonth, categories.value))

// —— 备份 / 恢复 ——
const backupPass = ref('')
const importText = ref('')
const importPass = ref('')
const importing = ref(false)

async function doExport() {
  const json = await exportBackup()
  // 填写了口令即加密导出（AES-GCM + PBKDF2）；未填则明文导出
  if (backupPass.value) {
    const b64 = await encryptBackup(json, backupPass.value)
    downloadText(b64, `household-finance-backup-${today()}.enc.txt`)
    notify('已导出加密备份（请牢记口令）')
    return
  }
  downloadText(json, `household-finance-backup-${today()}.json`)
  notify('已导出明文备份')
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importText.value = await file.text()
  input.value = ''
}

async function doImport() {
  if (!importText.value.trim()) {
    notify('请先选择备份文件')
    return
  }
  importing.value = true
  try {
    let json = importText.value
    if (importText.value.trim().startsWith('{') === false && importPass.value) {
      json = await decryptBackup(importText.value.trim(), importPass.value)
    } else if (importText.value.trim().startsWith('{') === false) {
      notify('加密备份需要输入口令')
      return
    }
    const counts = await importBackup(json)
    await loadAll()
    notify(`恢复完成：账目 ${counts.ledgers} 条、分类 ${counts.categories} 个、预算 ${counts.budgets} 条`)
  } catch (err) {
    notify(err instanceof Error ? err.message : '导入失败')
  } finally {
    importing.value = false
  }
}

async function resetAll() {
  if (!confirm('确认清空全部本地财务数据？此操作不可撤销。')) return
  await Promise.all([clearStore('ledgers'), clearStore('categories'), clearStore('budgets')])
  await loadAll()
  notify('已清空本地数据')
}

// —— 原生 SVG 图表辅助 ——
const DONUT_C = 2 * Math.PI * 40
const PALETTE = ['#3f7d5e', '#c8743a', '#4a7fb5', '#b5507e', '#7a6ab5', '#a08a3e', '#4d9b8a', '#c05a50']

interface DonutSeg {
  len: number
  offset: number
  color: string
  label: string
  amountCents: number
  ratio: number
}

function donutSegs(items: { label: string; value: number; ratio: number }[]): DonutSeg[] {
  let acc = 0
  return items.map((it, i) => {
    const len = Math.max(0, it.ratio * DONUT_C)
    const seg: DonutSeg = {
      len,
      offset: acc,
      color: PALETTE[i % PALETTE.length]!,
      label: it.label,
      amountCents: it.value,
      ratio: it.ratio
    }
    acc += len
    return seg
  })
}

const boardDonut = computed(() =>
  donutSegs(boardExpense.value.map((c) => ({ label: catLabel(c.category), value: c.amountCents, ratio: c.ratio })))
)
const reportDonut = computed(() =>
  donutSegs(monthReport.value.byCategory.map((c) => ({ label: catLabel(c.category), value: c.amountCents, ratio: c.ratio })))
)

/** 年度趋势 SVG 坐标：柱 + 折线，width=560 height=170 */
function trendGeometry() {
  const w = 560
  const h = 150
  const pad = 8
  const n = yearTrend.value.length
  const maxV = Math.max(1, ...yearTrend.value.map((t) => Math.max(t.expenseCents, t.incomeCents)))
  const step = n > 1 ? (w - pad * 2) / (n - 1) : 0
  const points = yearTrend.value.map((t, i) => {
    const x = pad + i * step
    const yExp = h - (t.expenseCents / maxV) * (h - 24)
    const yInc = h - (t.incomeCents / maxV) * (h - 24)
    return { x, yExp, yInc, expense: t.expenseCents, income: t.incomeCents, month: t.month }
  })
  const barW = Math.max(2, step * 0.3)
  return { w, h, points, barW }
}

/** 日趋势折线坐标 */
function dayLineGeometry() {
  const w = 560
  const h = 120
  const pad = 8
  const days = monthReport.value.byDay
  const n = days.length
  const maxV = Math.max(1, ...days.map((d) => Math.max(d.expenseCents, d.incomeCents)))
  const step = n > 1 ? (w - pad * 2) / (n - 1) : 0
  const pts = days.map((d, i) => ({
    x: pad + i * step,
    y: h - (Math.max(d.expenseCents, d.incomeCents) / maxV) * (h - 20)
  }))
  return { w, h, pts }
}

function catLabel(id: string): string {
  return categories.value.find((c) => c.id === id)?.name ?? id
}
</script>

<template>
  <div class="card hf">
    <div class="hf-head">
      <div>
        <h2 style="margin: 0 0 2px">家庭财务管家</h2>
        <p class="muted" style="margin: 0; font-size: 13px">记账 · 预算 · 报表 · 洞察，数据只存本地</p>
      </div>
      <button v-if="!canReport" class="btn btn-primary" @click="upgrade">升级 Pro {{ priceText }}/月</button>
      <span v-else class="tag accent">Pro 已解锁</span>
    </div>

    <div class="hf-tabs">
      <button v-for="t in ([['ledger','记账'],['board','看板'],['budget','预算'],['report','报表'],['insight','洞察']] as [Tab,string][])"
        :key="t[0]" class="hf-tab" :class="{ on: tab === t[0] }" @click="tab = t[0]">{{ t[1] }}</button>
    </div>

    <!-- 记账 -->
    <section v-if="tab === 'ledger'" class="hf-sec">
      <div class="hf-row">
        <div class="type-switch">
          <button :class="{ on: entryType === 'expense' }" @click="switchType('expense')">支出</button>
          <button :class="{ on: entryType === 'income' }" @click="switchType('income')">收入</button>
        </div>
        <input v-model="amountYuan" class="amount" type="number" min="0" step="0.01" placeholder="金额（元）"
          @keyup.enter="saveEntry" />
      </div>
      <div class="hf-grid">
        <label class="field">
          <span>分类</span>
          <select v-model="entryCategory">
            <option v-for="c in typeCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>平台</span>
          <select v-model="entryPlatform">
            <option v-for="(label, key) in PLATFORM_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="field">
          <span>日期</span>
          <input v-model="entryDate" type="date" />
        </label>
        <label class="field">
          <span>备注</span>
          <input v-model="note" placeholder="如：午饭、房租" />
        </label>
        <label class="field span2">
          <span>标签（逗号分隔）</span>
          <input v-model="tagsText" placeholder="如：聚餐, 本月大项" />
        </label>
      </div>
      <div class="hf-row" style="margin-top: 12px">
        <button class="btn btn-primary" @click="saveEntry">记一笔</button>
        <span v-if="toast" class="tag accent">{{ toast }}</span>
      </div>

      <div class="cat-manage">
        <h4 style="margin: 0 0 8px">自定义分类</h4>
        <div class="hf-row">
          <input v-model="newCategoryName" class="amount" placeholder="新分类名（如：宠物）" @keyup.enter="addCategory" />
          <button class="btn" @click="addCategory">添加</button>
        </div>
        <div class="cat-list">
          <span v-for="c in categories.filter((x) => !x.builtin)" :key="c.id" class="tag muted">
            {{ c.name }}（{{ c.type === 'expense' ? '支出' : '收入' }}）
            <button class="cat-del" title="删除" @click="removeCategory(c.id)">×</button>
          </span>
        </div>
      </div>

      <h4 style="margin: 18px 0 8px">最近流水</h4>
      <ul class="flow">
        <li v-for="e in recentEntries" :key="e.id">
          <div class="flow-main">
            <strong>{{ catLabel(e.category) }}</strong>
            <span class="muted">{{ e.date }} · {{ PLATFORM_LABELS[e.platform] }}{{ e.note ? ' · ' + e.note : '' }}</span>
            <span v-for="t in e.tags" :key="t" class="tag muted" style="margin-left: 6px">{{ t }}</span>
          </div>
          <div class="flow-amt">
            <b :class="e.type === 'expense' ? 'exp' : 'inc'">{{ e.type === 'expense' ? '−' : '+' }}¥{{ fmtYuan(e.amountCents) }}</b>
            <button class="btn-ghost del" title="删除" @click="deleteEntry(e.id)">删</button>
          </div>
        </li>
        <li v-if="!recentEntries.length" class="muted" style="list-style: none; padding: 12px 0">
          还没有账目，从上面记第一笔吧。
        </li>
      </ul>
    </section>

    <!-- 看板 -->
    <section v-if="tab === 'board'" class="hf-sec">
      <div class="kpi">
        <div class="kpi-card"><span class="faint">本月支出</span><b class="exp">¥{{ fmtYuan(boardExpense.reduce((s, c) => s + c.amountCents, 0)) }}</b></div>
        <div class="kpi-card"><span class="faint">本月收入</span><b class="inc">¥{{ fmtYuan(boardIncome) }}</b></div>
        <div class="kpi-card"><span class="faint">本月结余</span><b>¥{{ fmtYuan(boardIncome - boardExpense.reduce((s, c) => s + c.amountCents, 0)) }}</b></div>
      </div>

      <div v-if="boardExpense.length" class="hf-grid2">
        <div class="panel">
          <h4 style="margin: 0 0 8px">支出分类占比</h4>
          <div class="donut-wrap">
            <svg viewBox="0 0 100 100" class="donut">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#f0eee7" stroke-width="16" />
              <circle v-for="s in boardDonut" :key="s.label" cx="50" cy="50" r="40" fill="none" :stroke="s.color"
                stroke-width="16" :stroke-dasharray="`${s.len} ${DONUT_C - s.len}`" :stroke-dashoffset="s.offset"
                transform="rotate(-90 50 50)" />
            </svg>
            <ul class="legend">
              <li v-for="s in boardDonut" :key="s.label">
                <i :style="{ background: s.color }"></i>{{ s.label }}
                <span class="faint">{{ (s.ratio * 100).toFixed(0) }}% · ¥{{ fmtYuan(s.amountCents) }}</span>
              </li>
            </ul>
          </div>
        </div>
        <div class="panel">
          <h4 style="margin: 0 0 8px">支出平台分布</h4>
          <ul class="plat">
            <li v-for="p in boardPlatform" :key="p.platform">
              <span>{{ PLATFORM_LABELS[p.platform] }}</span>
              <b>¥{{ fmtYuan(p.amountCents) }}</b>
              <span class="faint">{{ p.count }} 笔</span>
            </li>
            <li v-if="!boardPlatform.length" class="muted">本月暂无支出</li>
          </ul>
        </div>
      </div>
      <p v-else class="muted">本月还没有支出记录，先去「记账」记几笔吧。</p>
    </section>

    <!-- 预算 -->
    <section v-if="tab === 'budget'" class="hf-sec">
      <div class="hf-row" style="margin-bottom: 10px">
        <h4 style="margin: 0">每月预算（元，留空表示不设）</h4>
        <button class="btn btn-primary" @click="saveBudgets">保存预算</button>
      </div>
      <button class="btn btn-ghost" style="margin-bottom: 10px" @click="buildBudgetDrafts">载入预算编辑</button>
      <div v-for="row in budgetDrafts" :key="row.key" class="budget-row">
        <input v-model="row.amountYuan" class="amount" type="number" min="0" step="0.01" :placeholder="row.label" />
        <span class="budget-label">{{ row.label }}</span>
        <div v-if="statusByCat(row.categoryId)" class="budget-progress">
          <div class="progress"><div class="fill" :style="{ width: pct(statusByCat(row.categoryId)!) }" :class="{ over: statusByCat(row.categoryId)!.over }"></div></div>
          <span class="faint">{{ pctText(statusByCat(row.categoryId)!) }}</span>
        </div>
      </div>
      <p class="muted" style="margin-top: 12px">预算按本月实时对比，超支会变红并在「洞察」中提醒。</p>
    </section>

    <!-- 报表 -->
    <section v-if="tab === 'report'" class="hf-sec">
      <template v-if="canReport">
        <div class="hf-row">
          <h4 style="margin: 0">月度报表</h4>
          <select v-model="reportMonth">
            <option v-for="m in MONTHS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div class="kpi">
          <div class="kpi-card"><span class="faint">收入</span><b class="inc">¥{{ fmtYuan(monthReport.incomeCents) }}</b></div>
          <div class="kpi-card"><span class="faint">支出</span><b class="exp">¥{{ fmtYuan(monthReport.expenseCents) }}</b></div>
          <div class="kpi-card"><span class="faint">结余</span><b>¥{{ fmtYuan(monthReport.balanceCents) }}</b></div>
        </div>
        <p v-if="monthChange !== null" class="muted">
          支出环比上月：<b :class="monthChange > 0 ? 'exp' : 'inc'">{{ monthChange > 0 ? '+' : '' }}{{ (monthChange * 100).toFixed(1) }}%</b>
        </p>

        <div v-if="monthReport.byCategory.length" class="hf-grid2">
          <div class="panel">
            <h4 style="margin: 0 0 8px">支出结构（分类占比）</h4>
            <div class="donut-wrap">
              <svg viewBox="0 0 100 100" class="donut">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#f0eee7" stroke-width="16" />
                <circle v-for="s in reportDonut" :key="s.label" cx="50" cy="50" r="40" fill="none" :stroke="s.color"
                  stroke-width="16" :stroke-dasharray="`${s.len} ${DONUT_C - s.len}`" :stroke-dashoffset="s.offset"
                  transform="rotate(-90 50 50)" />
              </svg>
              <ul class="legend">
                <li v-for="s in reportDonut" :key="s.label">
                  <i :style="{ background: s.color }"></i>{{ s.label }}
                  <span class="faint">{{ (s.ratio * 100).toFixed(0) }}% · ¥{{ fmtYuan(s.amountCents) }}</span>
                </li>
              </ul>
            </div>
          </div>
          <div class="panel">
            <h4 style="margin: 0 0 8px">月内每日支出趋势</h4>
            <svg :viewBox="`0 0 ${dayLineGeometry().w} ${dayLineGeometry().h}`" class="chart" preserveAspectRatio="none">
              <polyline :points="dayLineGeometry().pts.map((p) => `${p.x},${p.y}`).join(' ')" fill="none" stroke="#3f7d5e" stroke-width="2" />
            </svg>
            <p class="faint" style="margin: 4px 0 0">横轴为记账日期（无记录的日子不显示）</p>
          </div>
        </div>

        <div class="panel" style="margin-top: 14px">
          <h4 style="margin: 0 0 8px">近 12 个月收支趋势（绿=支出柱，蓝=收入柱）</h4>
          <svg :viewBox="`0 0 ${trendGeometry().w} ${trendGeometry().h}`" class="chart">
            <rect v-for="p in trendGeometry().points" :key="'e' + p.month" :x="p.x - trendGeometry().barW / 2" y="10"
              :width="trendGeometry().barW" :height="p.yExp - 10" fill="#3f7d5e" opacity="0.75" />
            <rect v-for="p in trendGeometry().points" :key="'i' + p.month" :x="p.x + 2" y="10"
              :width="trendGeometry().barW * 0.4" :height="p.yInc - 10" fill="#4a7fb5" opacity="0.7" />
            <polyline :points="trendGeometry().points.map((p) => `${p.x},${p.yExp}`).join(' ')" fill="none" stroke="#2b2a26" stroke-width="1.5" />
            <text v-for="p in trendGeometry().points" :key="'t' + p.month" :x="p.x" y="148" text-anchor="middle" font-size="9" fill="#9a968b">{{ p.month.slice(5) }}</text>
          </svg>
        </div>
      </template>
      <template v-else>
        <div class="locked">
          <p>高级报表（分类结构、环比、趋势图）是 Pro 功能。</p>
          <button class="btn btn-primary" @click="upgrade">升级 Pro {{ priceText }}/月</button>
        </div>
      </template>
    </section>

    <!-- 洞察 -->
    <section v-if="tab === 'insight'" class="hf-sec">
      <template v-if="canInsight">
        <h4 style="margin: 0 0 10px">省钱洞察（本月）</h4>
        <ul v-if="insights.length" class="insights">
          <li v-for="(it, i) in insights" :key="i" :class="it.level">
            <b>{{ it.title }}</b>
            <p class="muted" style="margin: 2px 0 0">{{ it.detail }}</p>
          </li>
        </ul>
        <p v-else class="muted">本月暂无洞察建议。记几笔账、设个预算后会给出提示。</p>
      </template>
      <template v-else>
        <div class="locked">
          <p>省钱洞察（高占比类目、超支预警、趋势分析）是 Pro 功能。</p>
          <button class="btn btn-primary" @click="upgrade">升级 Pro {{ priceText }}/月</button>
        </div>
      </template>
    </section>

    <!-- 数据备份 -->
    <div class="backup">
      <h4 style="margin: 0 0 8px">数据备份与恢复</h4>
      <p class="muted" style="margin: 0 0 10px; font-size: 13px">
        数据保存在浏览器本地。建议定期导出备份；加密备份与云同步为 Pro 功能。
      </p>
      <div class="hf-row" style="margin-bottom: 8px">
        <label class="field" style="margin-right: 8px">
          <span>加密口令（可选，填写即加密导出）</span>
          <input v-model="backupPass" type="password" placeholder="留空则明文导出" :disabled="!canSync" />
        </label>
        <button class="btn" @click="doExport">导出备份</button>
      </div>
      <div class="hf-row" style="margin-top: 8px">
        <label class="field" style="margin-right: 8px">
          <span>导入口令（加密备份用）</span>
          <input v-model="importPass" type="password" placeholder="明文备份无需口令" />
        </label>
        <label class="btn" style="cursor: pointer">
          选择文件导入
          <input type="file" accept=".json,.txt" style="display: none" @change="onImportFile" />
        </label>
        <button class="btn" :disabled="importing" @click="doImport">恢复导入</button>
      </div>
      <div v-if="!canSync" class="hf-row" style="margin-top: 8px">
        <span class="tag muted">加密口令需要 Pro</span>
        <button class="btn btn-ghost" @click="upgrade">升级解锁</button>
      </div>
      <div class="hf-row" style="margin-top: 10px">
        <button class="btn btn-ghost danger" @click="resetAll">清空全部本地数据</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hf {
  padding: 22px;
}
.hf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.hf-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.hf-tab {
  border: none;
  background: transparent;
  padding: 8px 16px;
  font-size: 14px;
  color: var(--ink-soft);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.hf-tab.on {
  color: var(--brand-dark);
  border-bottom-color: var(--brand);
  font-weight: 600;
}
.hf-sec {
  min-height: 220px;
}
.hf-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.hf-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--ink-soft);
}
.field.span2 {
  grid-column: span 2;
}
input,
select {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--surface);
  color: var(--ink);
  outline: none;
}
input:focus,
select:focus {
  border-color: var(--brand);
}
.amount {
  width: 160px;
}
.type-switch {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.type-switch button {
  border: none;
  background: transparent;
  padding: 9px 18px;
  color: var(--ink-soft);
}
.type-switch button.on {
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-weight: 600;
}
.cat-manage {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--line);
}
.cat-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.cat-del {
  border: none;
  background: transparent;
  color: var(--ink-faint);
  font-size: 14px;
  padding: 0 2px;
  cursor: pointer;
}
.flow {
  list-style: none;
  margin: 0;
  padding: 0;
}
.flow li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
}
.flow-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
}
.flow-amt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.inc {
  color: var(--brand);
}
.exp {
  color: var(--danger);
}
.del {
  border: none;
  background: transparent;
  color: var(--ink-faint);
  font-size: 12px;
  padding: 2px 6px;
  cursor: pointer;
}
.kpi {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.kpi-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.kpi-card b {
  font-size: 20px;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 14px;
}
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.donut {
  width: 130px;
  height: 130px;
  flex: none;
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.plat {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plat li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.budget-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
}
.budget-label {
  font-size: 14px;
}
.budget-progress {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.progress {
  flex: 1;
  height: 8px;
  background: #f0eee7;
  border-radius: 999px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--brand);
  border-radius: 999px;
}
.fill.over {
  background: var(--danger);
}
.chart {
  width: 100%;
  height: auto;
}
.locked {
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
  padding: 26px;
  text-align: center;
  color: var(--ink-soft);
}
.insights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.insights li {
  border-left: 4px solid var(--brand);
  background: var(--surface);
  border: 1px solid var(--line);
  border-left-color: var(--brand);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
}
.insights li.warn {
  border-left-color: var(--danger);
}
.insights li.good {
  border-left-color: var(--brand);
}
.backup {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px dashed var(--line);
}
.danger {
  color: var(--danger);
}
@media (max-width: 640px) {
  .hf-grid2 {
    grid-template-columns: 1fr;
  }
}
</style>
