<script setup lang="ts">
/**
 * 账单订阅盘点与自动续费预警（subscription-audit）
 * 导入微信/支付宝账单 CSV → 本地识别周期订阅 → 闲置/重复/涨价标注 → 决定保留/取消
 * → 官方解约入口 → .ics/通知提醒与报告导出。账单明细不出设备、不长期落盘。
 */
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { parseBillFile, type FileParseOutcome } from './lib/parse'
import type { Platform, TxRecord } from './lib/platforms'
import {
  buildSubscriptions,
  yuan,
  fmtDate,
  type Subscription,
  type SubAction,
  type SubFlag,
  type SubOverrides,
  type Cadence
} from './lib/subscriptions'
import { summarize, toReportCsv } from './lib/report'
import { downloadIcs, ensureNotifyPermission, scheduleNearestReminder } from './lib/remind'
import { CANCEL_GUIDES } from './lib/cancelGuides'
import { loadOverrides, saveOverrides, clearAll, listBatches, type BatchMeta } from './lib/store'
import { postTo } from '../../../reusable-module/worker-post/worker-post'
import type { ParseWorkerRequest, ParseWorkerResponse } from './workers/parse.worker'

useSeo({
  title: '账单订阅盘点与自动续费预警 - 本地识别微信/支付宝会员扣费',
  description:
    '导入微信/支付宝官方账单CSV，本机自动识别月付年付订阅，算清一年花多少、标注闲置重复涨价，给官方解约入口并生成扣费日历提醒，账单全程不上传。',
  type: 'SoftwareApplication',
  keywords: ['自动续费', '订阅盘点', '微信账单', '支付宝账单', '会员扣费', '关闭免密', '省钱', '续费提醒'],
  jsonLd: { offers: { '@type': 'Offer', price: '9.9', priceCurrency: 'CNY' } }
})

const billing = useToolBilling('subscription-audit')
const multiPro = computed(() => billing.canUse('multi-account').allowed)
const insightsPro = computed(() => billing.canUse('insights').allowed)
const exportPro = computed(() => billing.canUse('remind-export').allowed)
const buying = ref(false)
async function unlock(): Promise<void> {
  if (buying.value) return
  buying.value = true
  try {
    await billing.buy()
    notify('已解锁专业功能')
  } finally {
    buying.value = false
  }
}

const toast = ref('')
function notify(msg: string): void {
  toast.value = msg
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 2800)
}

// ---------- 导入与解析（Worker 优先，主线程回退） ----------
const accountLabel = ref('')
const forcePlatform = ref<'auto' | Platform>('auto')
const importing = ref(false)
const importMsg = ref('')
const outcomes = ref<FileParseOutcome[]>([])
const records = ref<TxRecord[]>([])
const batches = ref<BatchMeta[]>([])
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: ParseWorkerResponse) => void>()

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./workers/parse.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<ParseWorkerResponse>) => {
      pending.get(e.data.id)?.(e.data)
      pending.delete(e.data.id)
    }
    worker.onerror = () => {
      worker = null
    }
    return worker
  } catch {
    return null
  }
}

function parseViaWorker(file: File, account: string): Promise<FileParseOutcome> {
  const w = getWorker()
  if (!w) return parseBillFile(file, account, forcePlatform.value === 'auto' ? undefined : forcePlatform.value)
  const id = ++seq
  return new Promise<FileParseOutcome>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      parseBillFile(file, account, forcePlatform.value === 'auto' ? undefined : forcePlatform.value).then(resolve, reject)
    }, 8000)
    pending.set(id, (r) => {
      window.clearTimeout(timer)
      if (r.ok) resolve(r.outcome)
      else reject(new Error(r.error))
    })
    const req: ParseWorkerRequest = {
      id,
      file,
      account,
      force: forcePlatform.value === 'auto' ? undefined : forcePlatform.value
    }
    postTo(w, req)
  })
}

function onFileInput(e: Event): void {
  const input = e.target as HTMLInputElement | null
  const files = input?.files ?? null
  void onFiles(files)
  if (input) input.value = ''
}

async function onFiles(files: FileList | File[] | null): Promise<void> {
  if (!files || files.length === 0) return
  const list = Array.from(files).filter((f) => /\.csv$/i.test(f.name))
  if (list.length === 0) {
    notify('请选择从微信/支付宝导出的账单 CSV 文件')
    return
  }
  if (list.length > 1 && !multiPro.value) {
    notify('多份/多账户合并是专业版功能，可先只选一份，或升级解锁')
    await unlock()
    if (!multiPro.value) return
  }
  importing.value = true
  importMsg.value = `正在本地解析 ${list.length} 份账单…`
  try {
    const result: FileParseOutcome[] = []
    for (const f of list) {
      const oc = await parseViaWorker(f, accountLabel.value)
      result.push(oc)
    }
    const bad = result.filter((o) => o.unrecognized || o.records.length === 0)
    const good = result.filter((o) => !o.unrecognized && o.records.length > 0)
    if (good.length === 0) {
      importMsg.value = '未识别出账单明细，请确认导出的是“交易明细 CSV”，并按页内步骤操作'
      notify('未识别账单格式')
    } else {
      outcomes.value = good
      const merged: TxRecord[] = []
      const seen = new Set<string>()
      for (const o of good) for (const r of o.records) {
        const key = r.orderNo ? `${r.platform}:${r.orderNo}` : `${r.platform}:${r.time}:${r.counterparty}:${r.amountCents}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(r)
      }
      merged.sort((a, b) => b.time - a.time)
      records.value = merged
      await rebuild()
      importMsg.value = ''
      if (bad.length) notify(`已解析 ${good.length} 份；${bad.length} 份未识别已跳过`)
      else notify(`解析完成：${merged.length} 笔交易，识别 ${subs.value.length} 个订阅`)
    }
  } catch (err) {
    importMsg.value = '解析失败，请确认文件未损坏'
    notify(err instanceof Error ? err.message : '解析失败')
  } finally {
    importing.value = false
  }
}

// ---------- 订阅与人工纠正（持久化） ----------
const overrides = ref<SubOverrides>({})
const subs = ref<Subscription[]>([])
const expanded = reactive<Record<string, boolean>>({})

async function rebuild(): Promise<void> {
  subs.value = buildSubscriptions(records.value, { overrides: overrides.value })
}
async function persist(): Promise<void> {
  overrides.value = { ...overrides.value }
  // 先在内存生效并立即重算，保证界面即时响应；持久化失败不阻塞本次操作。
  await rebuild()
  try {
    await saveOverrides(overrides.value)
  } catch (err) {
    console.warn('订阅纠正保存失败（本次操作仍生效，刷新后可能丢失）', err)
  }
}
function setAction(s: Subscription, action: SubAction): void {
  const actionMap = { ...(overrides.value.action ?? {}) }
  actionMap[s.id] = action
  overrides.value = { ...overrides.value, action: actionMap }
  void persist()
}
function toggleIgnore(s: Subscription): void {
  if (!insightsPro.value) return void unlock()
  const ignored = { ...(overrides.value.ignored ?? {}) }
  if (ignored[s.id]) delete ignored[s.id]
  else ignored[s.id] = true
  overrides.value = { ...overrides.value, ignored }
  void persist()
}
function changeCadence(s: Subscription, c: Cadence): void {
  if (!insightsPro.value) return void unlock()
  overrides.value = { ...overrides.value, cadence: { ...(overrides.value.cadence ?? {}), [s.id]: c } }
  void persist()
}
function toggleGuide(s: Subscription): void {
  expanded[s.id] = !expanded[s.id]
}

const report = computed(() => summarize(subs.value))
const visibleSubs = computed(() => subs.value.filter((s) => !s.ignored))

const flagText: Record<string, { label: string; cls: string; tip: string }> = {
  'price-up': { label: '涨价', cls: 'danger', tip: '同周期最高一次较最低上涨 ≥10%' },
  duplicate: { label: '同类重复', cls: 'warn', tip: '检测到多个同类会员，可能只需保留一个' },
  idle: { label: '疑似闲置', cls: 'warn', tip: '距上次扣费已久仍在续费，建议自查是否还在用' },
  trial: { label: '试用留意转正', cls: 'danger', tip: '命中试用/首月优惠，留意到期后按原价扣费' }
}
const platformText: Record<string, string> = { wechat: '微信', alipay: '支付宝', unknown: '其它' }
function platformLabel(p: string): string {
  return platformText[p] ?? p
}
function flagOf(f: SubFlag): { label: string; cls: string; tip: string } {
  return flagText[f] ?? { label: f, cls: '', tip: '' }
}

// ---------- 导出 / 提醒 ----------
function exportCsv(): void {
  if (!exportPro.value) return void unlock()
  const csv = toReportCsv(subs.value)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `订阅盘点报告_${fmtDate(Date.now())}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function exportIcs(): void {
  if (!exportPro.value) return void unlock()
  downloadIcs(subs.value)
  notify('已生成续费提醒日历，导入系统日历后会在扣费前一天提醒')
}
const notifyState = ref<string>('')
async function enableNotify(): Promise<void> {
  if (!exportPro.value) return void unlock()
  const ok = await ensureNotifyPermission()
  notifyState.value = ok ? '已授权：本页打开期间会在最近一次扣费前一天提醒' : '未授权或被浏览器拒绝，长期提醒请用导出的日历(.ics)'
  if (ok) {
    const h = scheduleNearestReminder(subs.value)
    if (!h) notifyState.value = '近期没有待扣费项目；长期提醒建议导出 .ics'
  }
}

async function resetAll(): Promise<void> {
  if (!window.confirm('将清空本机保存的导入记录与全部“保留/取消/忽略”标记，确定吗？')) return
  await clearAll()
  overrides.value = {}
  outcomes.value = []
  records.value = []
  subs.value = []
  batches.value = []
  notify('已清空本机数据')
}

onMounted(async () => {
  overrides.value = await loadOverrides()
  batches.value = await listBatches()
})
onBeforeUnmount(() => {
  worker?.terminate()
})
</script>

<template>
  <div class="sa">
    <header class="sa-head">
      <h1>账单订阅盘点与自动续费预警</h1>
      <p class="sa-sub">
        导入微信/支付宝官方账单 CSV，本机自动找出按月/按年重复扣的会员，算清一年花多少、哪些
        <b>闲置 / 重复 / 涨价 / 试用转正</b>，给官方关闭入口并生成扣费提醒。<b>账单全程不上传</b>。
      </p>
    </header>

    <!-- 导入 -->
    <section class="card">
      <div class="card-title">① 导入账单（可多份、多月）</div>
      <div class="import-row">
        <input v-model="accountLabel" type="text" placeholder="账户标签（可选，如 我的微信）" class="acc" />
        <select v-model="forcePlatform">
          <option value="auto">自动识别平台</option>
          <option value="wechat">微信支付</option>
          <option value="alipay">支付宝</option>
        </select>
        <label class="btn btn-primary pick">
          {{ importing ? '解析中…' : '＋ 导入账单 CSV' }}
          <input type="file" accept=".csv,text/csv" multiple hidden :disabled="importing" @change="onFileInput" />
        </label>
        <button class="btn btn-ghost" @click="resetAll">清空本机数据</button>
      </div>
      <p class="hint" v-if="importing || importMsg">{{ importMsg || '正在本地解析，账单不会上传…' }}</p>
      <details class="howto">
        <summary>怎么导出微信 / 支付宝账单？（点开展开）</summary>
        <ul>
          <li><b>微信：</b>我 → 服务 → 钱包 → 账单 → 常见问题/申请交易账单 → 选时间段 → 申请账单明细，邮箱下载其中的交易明细 CSV。</li>
          <li><b>支付宝：</b>我的 → 账单 → 右上角「…」→ 开具交易流水证明 / 交易明细 → 选时间段，邮箱下载明细 CSV。</li>
          <li>建议导出最近 6–12 个月，才能识别年付会员；多份文件可一次选择（多份合并为专业版）。</li>
        </ul>
      </details>
    </section>

    <!-- 概览 -->
    <section class="cards-grid" v-if="visibleSubs.length">
      <div class="stat"><span class="num">{{ visibleSubs.length }}</span><span class="lbl">个订阅</span></div>
      <div class="stat"><span class="num">¥{{ yuan(report.totalAnnual) }}</span><span class="lbl">一年合计</span></div>
      <div class="stat"><span class="num">¥{{ yuan(report.totalThreeYear) }}</span><span class="lbl">三年合计</span></div>
      <div class="stat save"><span class="num">−¥{{ yuan(report.savingsAnnual) }}</span><span class="lbl">标记取消可省/年（{{ report.canceledCount }}）</span></div>
    </section>

    <section class="card" v-if="report.nearestNext">
      <div class="risk">
        最近一次扣费：<b>{{ report.nearestNext.displayName }}</b> 约在
        <b>{{ fmtDate(report.nearestNext.nextAt) }}</b> 扣 ¥{{ yuan(report.nearestNext.priceCents) }}
      </div>
    </section>

    <!-- 空状态 -->
    <section class="card empty" v-if="!visibleSubs.length && !importing">
      <p>还没有识别出订阅。先按上面步骤从微信/支付宝导出最近 6–12 个月的账单明细 CSV，再导入。</p>
      <p class="hint">所有解析都在本机完成，账单明细不会上传，也不会长期保存在本站。</p>
    </section>

    <!-- 订阅清单 -->
    <section class="card" v-if="visibleSubs.length">
      <div class="card-title">
        ② 订阅清单
        <span class="pro-tag" v-if="!insightsPro">智能标注/手动纠错为专业版</span>
      </div>
      <ul class="subs">
        <li v-for="s in visibleSubs" :key="s.id" class="sub">
          <div class="sub-main">
            <div class="sub-top">
              <b class="name">{{ s.displayName }}</b>
              <span class="plat">{{ s.platforms.map(platformLabel).join('/') }}</span>
              <span class="cad">{{ s.cadenceLabel }} · ¥{{ yuan(s.priceCents) }}</span>
            </div>
            <div class="flags" v-if="insightsPro">
              <span v-for="f in s.flags" :key="f" :class="['flag', flagOf(f).cls]" :title="flagOf(f).tip">{{ flagOf(f).label }}</span>
            </div>
            <div class="meta">
              最近扣费 {{ fmtDate(s.lastAt) }} · 预计下次 {{ fmtDate(s.nextAt) }} · 已扣 {{ s.count }} 次 ·
              <b>年 ¥{{ yuan(s.annualCents) }}</b>
            </div>
            <div class="acts">
              <button :class="{ on: s.action === 'keep' }" @click="setAction(s, 'keep')">保留</button>
              <button :class="{ on: s.action === 'cancel' }" @click="setAction(s, 'cancel')">取消</button>
              <button :class="{ on: s.action === 'watch' }" @click="setAction(s, 'watch')">观望</button>
              <button class="link" @click="toggleGuide(s)">如何关闭</button>
              <button class="link" v-if="insightsPro" @click="toggleIgnore(s)">忽略</button>
              <select v-if="insightsPro" :value="s.cadence" @change="changeCadence(s, ($event.target as HTMLSelectElement).value as Cadence)">
                <option value="monthly">按月</option>
                <option value="quarterly">按季</option>
                <option value="semiannual">按半年</option>
                <option value="yearly">按年</option>
              </select>
            </div>
            <div class="guide" v-if="expanded[s.id]">
              <div v-for="p in s.platforms" :key="p">
                <template v-for="g in CANCEL_GUIDES.filter((x) => x.platform === p)" :key="g.platform">
                  <b>{{ g.label }}：</b>
                  <ol>
                    <li v-for="(st, i) in g.steps" :key="i">{{ st }}</li>
                  </ol>
                  <a :href="g.helpUrl" target="_blank" rel="noopener noreferrer">{{ g.helpLabel }} ↗</a>
                </template>
              </div>
              <p class="hint">解约需你本人在官方 App 操作，本工具只提供入口，不会触碰支付账户。</p>
            </div>
          </div>
          <div class="sub-side">
            <div class="annual">¥{{ yuan(s.annualCents) }}<small>/年</small></div>
          </div>
        </li>
      </ul>
    </section>

    <!-- 类别分布 -->
    <section class="card" v-if="report.byCategory.length">
      <div class="card-title">③ 支出结构（按类，年）</div>
      <div class="cats">
        <div v-for="c in report.byCategory" :key="c.category" class="cat">
          <span>{{ c.category }} · {{ c.count }} 个</span>
          <b>¥{{ yuan(c.annualCents) }}</b>
        </div>
      </div>
      <RouterLink class="hint link" to="/t/household-finance">想长期逐笔记账、做预算？可看看「家庭财务管家」↗</RouterLink>
    </section>

    <!-- 提醒与导出 -->
    <section class="card" v-if="visibleSubs.length">
      <div class="card-title">
        ④ 提醒与导出
        <span class="pro-tag" v-if="!exportPro">专业版</span>
      </div>
      <div class="toolbar">
        <button class="btn" @click="exportIcs">生成续费提醒日历(.ics)</button>
        <button class="btn" @click="enableNotify">开启浏览器扣费提醒</button>
        <button class="btn" @click="exportCsv">导出报告 CSV</button>
        <button class="btn btn-primary" @click="unlock" v-if="!multiPro || !insightsPro || !exportPro">
          {{ buying ? '处理中…' : `升级专业版 ${billing.priceText(billing.plan.priceCents)}（买断）` }}
        </button>
      </div>
      <p class="hint" v-if="notifyState">{{ notifyState }}</p>
      <p class="hint">.ics 导入手机/电脑系统日历后长期有效；浏览器通知仅在本页打开期间生效（本站无服务器，不做后台推送）。</p>
    </section>
  </div>

  <div class="toast" v-if="toast">{{ toast }}</div>
</template>

<style scoped>
.sa { max-width: var(--maxw); margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.sa-head h1 { font-size: 22px; margin: 0 0 6px; color: var(--ink); }
.sa-sub { color: var(--ink-soft); margin: 0; line-height: 1.7; display: block; text-align: start; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; box-shadow: var(--shadow-sm); }
.card-title { font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.import-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.import-row select, .acc { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.acc { min-width: 200px; }
.howto { margin-top: 10px; font-size: 13px; color: var(--ink-soft); }
.howto ul { margin: 8px 0; padding-left: 18px; line-height: 1.7; }
.btn { padding: 8px 14px; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
.btn-primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.btn-ghost { background: transparent; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.pick { display: inline-block; }
.hint { font-size: 12px; color: var(--ink-faint); margin: 8px 0 0; line-height: 1.6; }
.link { color: var(--brand); text-decoration: none; background: none; border: none; cursor: pointer; font-size: inherit; }
.cards-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 4px; }
.stat .num { font-size: 22px; font-weight: 800; color: var(--ink); }
.stat.save .num { color: #1a7f37; }
.stat .lbl { font-size: 12px; color: var(--ink-faint); }
.risk { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--ink-soft); line-height: 1.6; }
.empty { color: var(--ink-soft); line-height: 1.7; }
.subs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sub { display: flex; justify-content: space-between; gap: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; }
.sub-main { flex: 1; min-width: 0; }
.sub-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.name { font-size: 15px; }
.plat { font-size: 11px; color: var(--ink-faint); border: 1px solid var(--line); border-radius: 6px; padding: 0 6px; }
.cad { font-size: 12px; color: var(--ink-soft); }
.flags { display: flex; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
.flag { font-size: 11px; border-radius: 6px; padding: 1px 7px; }
.flag.danger { background: #fdecec; color: #b3261e; }
.flag.warn { background: #fff5e0; color: #9a6200; }
.meta { font-size: 12px; color: var(--ink-faint); line-height: 1.6; }
.acts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
.acts button { padding: 4px 12px; font-size: 13px; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; cursor: pointer; }
.acts button.on { background: var(--brand); color: #fff; border-color: var(--brand); }
.acts select { font-size: 12px; padding: 3px 6px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.guide { margin-top: 10px; padding: 10px 12px; background: var(--bg); border-radius: var(--radius-sm); font-size: 13px; line-height: 1.7; }
.guide ol { margin: 4px 0; padding-left: 18px; }
.sub-side { flex: 0 0 auto; text-align: right; }
.annual { font-size: 18px; font-weight: 800; color: var(--ink); }
.annual small { font-size: 12px; font-weight: 400; color: var(--ink-faint); }
.cats { display: flex; flex-direction: column; gap: 6px; }
.cat { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink-soft); padding: 4px 0; border-bottom: 1px dashed var(--line); }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
.pro-tag { font-size: 11px; background: var(--accent); color: #fff; border-radius: 6px; padding: 0 6px; font-weight: 400; }
.toast { position: fixed; left: 50%; bottom: calc(var(--tab-h, 0px) + 24px); transform: translateX(-50%); background: rgba(0, 0, 0, .82); color: #fff; padding: 10px 16px; border-radius: 20px; font-size: 13px; z-index: 50; max-width: 86vw; }
@media (max-width: 820px) {
  .sa { padding: 12px; }
  .cards-grid { grid-template-columns: 1fr 1fr; }
  .acc { flex: 1 1 100%; }
  .sub { flex-direction: column; }
  .sub-side { text-align: left; }
}
</style>
