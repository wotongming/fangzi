<script setup lang="ts">
/**
 * 网购三包·退换货维权管家 —— 全部数据只存本地 IndexedDB。
 * 边界：只做时效参考、证据整理与文书草稿；不代为投诉、不抓取平台数据、不替代律师/12315 认定。
 */
import { computed, onMounted, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { FREE_CASE_LIMIT, manifest } from './manifest'
import {
  CATEGORY_RULES,
  CATEGORY_ORDER,
  NOREASON_EXCEPTIONS,
  RULE_VERSION,
  DISCLAIMER,
  SOURCES
} from './lib/rules-cn'
import { computeWindows, type WindowStatus } from './lib/deadline-engine'
import {
  fmtDateTime,
  fmtYuan,
  today,
  yuanToCents,
  type CaseStatus,
  type Category,
  type ClaimCase,
  type Evidence,
  type EvidenceKind
} from './lib/models'
import { STATUS_LABELS, moveStatus, newCase, nextStatus, prevStatus } from './lib/case-state'
import * as db from './lib/store'
import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KIND_ORDER,
  buildEvidence,
  evidenceFileName,
  formatBytes,
  totalEvidenceBytes
} from './lib/evidence'
import { buildEvidenceZip, downloadBlob } from './lib/pack'
import {
  LETTER_TYPES,
  SCENARIOS,
  buildLetter,
  hasUnfilledPlaceholder,
  type LetterType,
  type Scenario
} from './lib/letters'
import { buildIcs, buildReminders, downloadIcs, ensureNotifyPermission } from './lib/notify'

useSeo({
  title: '网购退换货维权管家 - 七天无理由/三包/保修/价保时效计算·证据固化·12315文本',
  description:
    '按品类自动计算七天无理由退货、15日换货、三包修换退、保修期与价保时效，随拍固化订单/聊天/物流/商品证据，一键生成协商话术、平台介入说明与12315投诉文本草稿，全程只存本机。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canMulti = computed(() => billing.canUse('multi').allowed)
const canLetters = computed(() => billing.canUse('letters').allowed)
const canExport = computed(() => billing.canUse('export').allowed)
const priceText = computed(() => billing.priceText(billing.plan.priceCents))
async function upgrade() {
  await billing.buy('freemium-pro')
}

// —— 数据 ——
const loaded = ref(false)
const cases = ref<ClaimCase[]>([])
const evidences = ref<Evidence[]>([])
const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2600)
}

const urlMap = new Map<string, string>()
function evidenceUrl(id: string): string {
  const hit = urlMap.get(id)
  if (hit) return hit
  const e = evidences.value.find((x) => x.id === id)
  if (!e) return ''
  const url = URL.createObjectURL(e.blob)
  urlMap.set(id, url)
  return url
}

async function reload() {
  const [cs, evs] = await Promise.all([db.getAll<ClaimCase>('cases'), db.getAll<Evidence>('evidence')])
  cs.sort((a, b) => b.updatedAt - a.updatedAt)
  evs.sort((a, b) => a.seq - b.seq)
  cases.value = cs
  evidences.value = evs
  loaded.value = true
}

// —— 视图：board 列表 / detail 详情 ——
const view = ref<'board' | 'detail'>('board')
const detailTab = ref<'deadline' | 'evidence' | 'letters' | 'progress' | 'rules'>('deadline')
const currentId = ref<string>('')
const current = computed<ClaimCase | undefined>(() => cases.value.find((c) => c.id === currentId.value))
const currentEvidences = computed(() => evidences.value.filter((e) => e.caseId === currentId.value))

function openCase(id: string) {
  currentId.value = id
  detailTab.value = 'deadline'
  view.value = 'detail'
  const c = cases.value.find((x) => x.id === id)
  outcomeText.value = c && c.outcomeCents != null ? String(c.outcomeCents / 100) : ''
  outcomeNote.value = c?.outcomeNote ?? ''
}
function backBoard() {
  view.value = 'board'
  currentId.value = ''
}

const windowsMap = computed(() => {
  const m = new Map<string, WindowStatus[]>()
  for (const c of cases.value) m.set(c.id, computeWindows(c))
  return m
})
function wins(c: ClaimCase): WindowStatus[] {
  return windowsMap.value.get(c.id) ?? computeWindows(c)
}
const currentWindows = computed<WindowStatus[]>(() => (current.value ? wins(current.value) : []))

function urgentOf(c: ClaimCase): number {
  return wins(c).filter((w) => w.state === 'due-soon' || w.state === 'expired').length
}

function stateClass(w: WindowStatus): string {
  return `st st-${w.state}`
}
function stateText(w: WindowStatus): string {
  if (w.state === 'na') return '不适用'
  if (!Number.isFinite(w.daysLeft)) return '—'
  if (w.daysLeft < 0) return `已过 ${-w.daysLeft} 天`
  if (w.daysLeft === 0) return '今天到期'
  return `剩 ${w.daysLeft} 天`
}

// —— 新建 / 编辑案件 ——
const editing = ref(false)
const editId = ref<string>('')
const form = ref({
  product: '',
  channel: '',
  orderNo: '',
  amountText: '',
  receivedDate: today(),
  foundDate: '',
  category: 'general' as Category,
  customMade: false,
  priceProtectDays: 30
})

function resetForm() {
  form.value = {
    product: '',
    channel: '',
    orderNo: '',
    amountText: '',
    receivedDate: today(),
    foundDate: '',
    category: 'general',
    customMade: false,
    priceProtectDays: 30
  }
}
function openCreate() {
  if (!canMulti.value && cases.value.length >= FREE_CASE_LIMIT) {
    notify(`免费版最多跟踪 ${FREE_CASE_LIMIT} 个商品，升级专业版后可不限数量、长期跟踪多个商品`)
    return
  }
  editId.value = ''
  resetForm()
  editing.value = true
}
function openEdit(c: ClaimCase) {
  editId.value = c.id
  form.value = {
    product: c.product,
    channel: c.channel,
    orderNo: c.orderNo,
    amountText: c.amountCents != null ? String(c.amountCents / 100) : '',
    receivedDate: c.receivedDate,
    foundDate: c.foundDate ?? '',
    category: c.category,
    customMade: c.customMade,
    priceProtectDays: c.priceProtectDays
  }
  editing.value = true
}

async function saveCase() {
  if (!form.value.product.trim()) return notify('请填写商品名称')
  if (!form.value.receivedDate) return notify('请选择签收日期')
  // type=number 的 v-model 可能给出数字或 null，统一归一化为字符串再解析
  const amountRaw = String(form.value.amountText ?? '').trim()
  if (amountRaw && yuanToCents(amountRaw) == null) {
    return notify('金额格式不正确，如 199.00')
  }
  const amountCents = amountRaw ? yuanToCents(amountRaw) : undefined
  if (editId.value) {
    const old = cases.value.find((c) => c.id === editId.value)
    if (old) {
      const updated: ClaimCase = {
        ...old,
        product: form.value.product.trim(),
        channel: form.value.channel.trim(),
        orderNo: form.value.orderNo.trim(),
        amountCents,
        receivedDate: form.value.receivedDate,
        foundDate: form.value.foundDate || undefined,
        category: form.value.category,
        customMade: form.value.customMade,
        priceProtectDays: Number(form.value.priceProtectDays) || 0,
        updatedAt: Date.now()
      }
      await db.put('cases', updated)
    }
  } else {
    const c = newCase({
      product: form.value.product.trim(),
      channel: form.value.channel.trim(),
      orderNo: form.value.orderNo.trim(),
      amountCents,
      receivedDate: form.value.receivedDate,
      foundDate: form.value.foundDate || undefined,
      category: form.value.category,
      customMade: form.value.customMade,
      priceProtectDays: Number(form.value.priceProtectDays) || 0
    })
    await db.put('cases', c)
  }
  editing.value = false
  await reload()
  notify('已保存')
}

async function removeCase(c: ClaimCase) {
  if (!window.confirm(`删除「${c.product}」及其全部证据？此操作只影响本机数据。`)) return
  await db.deleteCaseCascade(c.id)
  await reload()
  backBoard()
  notify('已删除')
}

// —— 证据 ——
const evKind = ref<EvidenceKind>('order')
const evNote = ref('')
const busy = ref(false)

async function onPickFiles(files: FileList | null) {
  if (!current.value || !files || !files.length) return
  busy.value = true
  try {
    let seq = currentEvidences.value.reduce((m, e) => Math.max(m, e.seq), 0)
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue
      seq += 1
      const ev = await buildEvidence({ name: f.name, blob: f }, current.value.id, seq, evKind.value, evNote.value)
      await db.put('evidence', ev)
    }
    evNote.value = ''
    await reload()
    notify('证据已固化（本地压缩存储）')
  } catch (err) {
    notify('图片处理失败，请换一张试试')
  } finally {
    busy.value = false
  }
}

async function removeEvidence(e: Evidence) {
  if (!window.confirm(`删除证据 ${e.seq}？`)) return
  await db.remove('evidence', e.id)
  await reload()
}

const evidenceBytes = computed(() => totalEvidenceBytes(currentEvidences.value))

async function exportZip(withLetter: boolean) {
  if (!current.value) return
  if (!canExport.value) return notify('证据包导出为专业版功能')
  if (!currentEvidences.value.length) return notify('还没有证据，先添加再导出')
  busy.value = true
  try {
    const letter = withLetter && letterText.value
      ? { name: LETTER_TYPES.find((t) => t.key === letterType.value)?.label ?? '', text: letterText.value }
      : undefined
    const blob = await buildEvidenceZip(current.value, currentEvidences.value, letter)
    const safe = current.value.product.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24)
    downloadBlob(blob, `维权证据包_${safe}_${today()}.zip`)
    notify('证据包已导出')
  } finally {
    busy.value = false
  }
}

async function exportIcs() {
  if (!current.value) return
  if (!canExport.value) return notify('日历提醒导出为专业版功能')
  const evs = buildReminders(currentWindows.value, current.value.product)
  if (!evs.length) return notify('当前没有未到期的可提醒窗口')
  await ensureNotifyPermission()
  downloadIcs(buildIcs(evs))
  notify('已导出 .ics，可导入手机日历')
}

// —— 文书 ——
const scenario = ref<Scenario>('quality')
const letterType = ref<LetterType>('negotiate')
const letterText = ref('')

function generateLetter() {
  if (!current.value) return
  if (!canLetters.value) return notify('协商/平台/12315 全套文书为专业版功能')
  const text = buildLetter(current.value, scenario.value, letterType.value)
  letterText.value = text
  if (hasUnfilledPlaceholder(text)) notify('生成异常：存在未填信息，请补全案件资料')
}

async function copyLetter() {
  if (!letterText.value) return
  try {
    await navigator.clipboard.writeText(letterText.value)
    notify('已复制，可粘贴到聊天/投诉框')
  } catch {
    notify('复制失败，请长按文本手动选择')
  }
}

// —— 进度 ——
const moveNote = ref('')
async function goNext() {
  if (!current.value) return
  const t = nextStatus(current.value.status)
  if (!t) return
  await db.put('cases', moveStatus(current.value, t, moveNote.value))
  moveNote.value = ''
  await reload()
}
async function goPrev() {
  if (!current.value) return
  const t = prevStatus(current.value.status)
  if (!t) return
  await db.put('cases', moveStatus(current.value, t, '回退'))
  await reload()
}
async function saveOutcome() {
  if (!current.value) return
  const cents = yuanToCents(outcomeText.value)
  await db.put('cases', { ...current.value, outcomeCents: cents, outcomeNote: outcomeNote.value.trim() || undefined, updatedAt: Date.now() })
  await reload()
  notify('结果已记录')
}
const outcomeText = ref('')
const outcomeNote = ref('')

onMounted(() => {
  void reload()
})
</script>

<template>
  <div class="sc-app">
    <!-- ===== 案件列表 ===== -->
    <section v-if="view === 'board' && !editing" class="page">
      <header class="board-head">
        <h1>我的维权案件</h1>
        <p class="muted tiny">时效自动算、证据本地固化、文书一键起草；数据全程只存这台设备。</p>
      </header>

      <button class="btn primary big block" @click="openCreate">＋ 新建维权案件</button>
      <p v-if="!canMulti" class="muted tiny center">免费版可跟踪 {{ FREE_CASE_LIMIT }} 个商品，升级后不限数量并可长期保修提醒</p>

      <div v-if="loaded && cases.length === 0" class="empty">
        <div class="empty-emoji">🧾</div>
        <h2>还没有维权案件</h2>
        <p>网购后先把订单信息和签收日期记下来，出问题时能立刻看到「还能不能退、换、修」，并随拍固化证据。</p>
      </div>

      <article v-for="c in cases" :key="c.id" class="case-card" @click="openCase(c.id)">
        <div class="case-top">
          <strong class="case-name">{{ c.product }}</strong>
          <span :class="['status-pill', `sp-${c.status}`]">{{ STATUS_LABELS[c.status] }}</span>
        </div>
        <div class="muted tiny">{{ c.channel || '未填渠道' }} · 签收 {{ c.receivedDate }}<span v-if="c.amountCents != null"> · {{ fmtYuan(c.amountCents) }}</span></div>
        <div class="mini-wins">
          <span v-for="w in wins(c).slice(0, 3)" :key="w.key" :class="stateClass(w)">{{ w.label }}：{{ stateText(w) }}</span>
          <i v-if="urgentOf(c)" class="urg-dot">{{ urgentOf(c) }}</i>
        </div>
      </article>

      <div class="card rules-short">
        <div class="card-h">⚖️ 先记住两条</div>
        <p class="tiny">① <strong>质量问题不受 7 天无理由期限限制</strong>；② <strong>「拆封」≠「不完好」</strong>，商家不能仅以已拆封为由拒绝退货。</p>
        <p class="tiny disclaimer">{{ DISCLAIMER }}</p>
      </div>
    </section>

    <!-- ===== 新建/编辑表单 ===== -->
    <section v-else-if="editing" class="page">
      <header class="sub-head">
        <button class="link" @click="editing = false">← 返回</button>
        <h1>{{ editId ? '编辑案件' : '新建维权案件' }}</h1>
      </header>
      <div class="card form">
        <label>商品名称 *</label>
        <input type="text" v-model="form.product" placeholder="如 XX 品牌 1.5 匹变频空调" />

        <label>购买渠道 / 店铺</label>
        <input type="text" v-model="form.channel" placeholder="如 某平台 某旗舰店" />

        <div class="grid2">
          <div>
            <label>订单编号</label>
            <input type="text" v-model="form.orderNo" placeholder="订单号（可后补）" />
          </div>
          <div>
            <label>成交金额（元）</label>
            <input type="number" inputmode="decimal" step="0.01" min="0" v-model="form.amountText" placeholder="0.00" />
          </div>
        </div>

        <label>商品类别（决定适用时效）*</label>
        <select v-model="form.category">
          <option v-for="k in CATEGORY_ORDER" :key="k" :value="k">{{ CATEGORY_RULES[k].label }}</option>
        </select>

        <div class="grid2">
          <div>
            <label>签收日期 *</label>
            <input type="date" v-model="form.receivedDate" />
          </div>
          <div>
            <label>发现问题日期</label>
            <input type="date" v-model="form.foundDate" />
          </div>
        </div>

        <div class="grid2">
          <div>
            <label>价保天数（平台规则，0=不跟踪）</label>
            <input type="number" min="0" max="365" v-model.number="form.priceProtectDays" />
          </div>
          <div class="check">
            <label><input type="checkbox" v-model="form.customMade" /> 定作等不适用 7 天无理由</label>
          </div>
        </div>

        <button class="btn primary big block" @click="saveCase">保存案件</button>
        <p class="muted tiny">时效按签收日与品类自动计算；保修月数为常见值，具体以三包凭证/保修卡为准。</p>
      </div>
    </section>

    <!-- ===== 案件详情 ===== -->
    <section v-else-if="current" class="page detail">
      <header class="sub-head detail-head">
        <button class="link" @click="backBoard">← 案件列表</button>
        <h1>{{ current.product }}</h1>
        <div class="muted tiny">{{ current.channel || '未填渠道' }} · 订单 {{ current.orderNo || '未填' }} · 签收 {{ current.receivedDate }}</div>
        <div class="head-actions">
          <button class="btn small ghost" @click="openEdit(current)">编辑</button>
          <button class="btn small ghost danger-text" @click="removeCase(current)">删除</button>
        </div>
      </header>

      <nav class="seg" aria-label="案件功能">
        <button :class="{ on: detailTab === 'deadline' }" @click="detailTab = 'deadline'">⏱ 时效</button>
        <button :class="{ on: detailTab === 'evidence' }" @click="detailTab = 'evidence'">📷 证据</button>
        <button :class="{ on: detailTab === 'letters' }" @click="detailTab = 'letters'">✉️ 文书</button>
        <button :class="{ on: detailTab === 'progress' }" @click="detailTab = 'progress'">📍 进度</button>
        <button :class="{ on: detailTab === 'rules' }" @click="detailTab = 'rules'">⚖️ 规则</button>
      </nav>

      <!-- 时效看板 -->
      <div v-if="detailTab === 'deadline'">
        <div v-for="w in currentWindows" :key="w.key" class="card win">
          <div class="win-top">
            <strong>{{ w.label }}</strong>
            <span :class="stateClass(w)">{{ stateText(w) }}</span>
          </div>
          <div class="muted tiny">窗口：{{ w.start }} ~ {{ w.end }}</div>
          <p class="win-action">{{ w.action }}</p>
          <p v-if="w.note" class="tiny note">{{ w.note }}</p>
          <p class="tiny src">依据：{{ w.source }}</p>
        </div>
        <button class="btn block" @click="exportIcs">📅 导出日历提醒（.ics）</button>
        <p class="muted tiny center">手机后台通知不稳定，建议导出 .ics 导入系统日历，到期自动提醒。</p>
      </div>

      <!-- 证据柜 -->
      <div v-else-if="detailTab === 'evidence'">
        <div class="card">
          <div class="card-h">📷 添加证据（自动压缩、连续编号、仅存本机）</div>
          <label>证据类型</label>
          <div class="kind-row">
            <button v-for="k in EVIDENCE_KIND_ORDER" :key="k" :class="['kind-btn', { on: evKind === k }]" @click="evKind = k">
              {{ EVIDENCE_KIND_LABELS[k] }}
            </button>
          </div>
          <label>备注（可选）</label>
          <input type="text" v-model="evNote" placeholder="如：开箱视频第 5 秒可见划痕" />
          <label class="file-pick btn primary block" :class="{ disabled: busy }">
            ＋ 拍照 / 选择图片
            <input type="file" accept="image/*" multiple capture="environment" :disabled="busy" @change="onPickFiles(($event.target as HTMLInputElement).files)" />
          </label>
          <p class="muted tiny">建议依次上传：订单截图 → 支付凭证 → 聊天记录 → 物流签收 → 商品/瑕疵照片。共 {{ currentEvidences.length }} 项，约 {{ formatBytes(evidenceBytes) }}。</p>
        </div>

        <p v-if="!currentEvidences.length" class="muted empty-line">还没有证据。下单后就先存订单截图，出问题时随拍随存。</p>
        <div v-for="e in currentEvidences" :key="e.id" class="ev-item card">
          <img :src="evidenceUrl(e.id)" :alt="EVIDENCE_KIND_LABELS[e.kind]" />
          <div class="ev-meta">
            <strong>#{{ String(e.seq).padStart(2, '0') }} {{ EVIDENCE_KIND_LABELS[e.kind] }}</strong>
            <div class="muted tiny">{{ evidenceFileName(e) }}</div>
            <div class="muted tiny">固化于 {{ fmtDateTime(e.capturedAt) }} · {{ e.width }}×{{ e.height }} · {{ formatBytes(e.bytes) }}</div>
            <div v-if="e.note" class="tiny note">{{ e.note }}</div>
            <button class="btn tiny ghost danger-text" @click="removeEvidence(e)">删除</button>
          </div>
        </div>

        <div class="export-row">
          <button class="btn primary" @click="exportZip(false)">导出证据包 ZIP</button>
          <button class="btn" @click="exportZip(true)">证据包 + 当前文书</button>
        </div>
      </div>

      <!-- 文书 -->
      <div v-else-if="detailTab === 'letters'">
        <div class="card">
          <div class="card-h">✉️ 生成维权文本（草稿，可自行修改）</div>
          <label>你的情形</label>
          <select v-model="scenario">
            <option v-for="s in SCENARIOS" :key="s.key" :value="s.key">{{ s.label }}（{{ s.hint }}）</option>
          </select>
          <label>文本用途</label>
          <div class="kind-row">
            <button v-for="t in LETTER_TYPES" :key="t.key" :class="['kind-btn', { on: letterType === t.key }]" @click="letterType = t.key">
              {{ t.label }}
            </button>
          </div>
          <button class="btn primary block" @click="generateLetter">生成文本</button>
          <p class="muted tiny">系统不会替你提交投诉，也不会联系商家；请核对事实与诉求后自行发送。</p>
        </div>

        <div v-if="letterText" class="card">
          <textarea class="letter-box" rows="18" v-model="letterText"></textarea>
          <div class="export-row">
            <button class="btn" @click="copyLetter">复制文本</button>
            <button class="btn primary" @click="exportZip(true)">并入证据包导出</button>
          </div>
        </div>

        <div v-if="!canLetters" class="card upgrade-card">
          <div class="card-h">专业版功能</div>
          <p class="muted tiny">协商话术、平台介入说明、12315 投诉文本全套模板，一次买断 {{ priceText }}，也可订阅。数据仍只存本机。</p>
          <button class="btn primary block" @click="upgrade">升级专业版</button>
        </div>
      </div>

      <!-- 进度 -->
      <div v-else-if="detailTab === 'progress'">
        <div class="card">
          <div class="card-h">📍 维权进度</div>
          <ol class="steps">
            <li v-for="(label, key) in STATUS_LABELS" :key="key" :class="{ done: (Object.keys(STATUS_LABELS) as CaseStatus[]).indexOf(key as CaseStatus) <= (Object.keys(STATUS_LABELS) as CaseStatus[]).indexOf(current.status), now: current.status === key }">
              {{ label }}
            </li>
          </ol>
          <div class="export-row">
            <button class="btn ghost" :disabled="!prevStatus(current.status)" @click="goPrev">← 回退一步</button>
            <button class="btn primary" :disabled="!nextStatus(current.status)" @click="goNext">推进到下一步 →</button>
          </div>
          <label>本步备注（可选）</label>
          <input type="text" v-model="moveNote" placeholder="如：客服工号 8001，承诺 48 小时处理" />
        </div>

        <div class="card">
          <div class="card-h">💰 处理结果</div>
          <div class="grid2">
            <div>
              <label>实际挽回金额（元）</label>
              <input type="number" inputmode="decimal" step="0.01" min="0" :value="current.outcomeCents != null ? current.outcomeCents / 100 : ''" @input="outcomeText = ($event.target as HTMLInputElement).value" placeholder="0.00" />
            </div>
            <div>
              <label>结果说明</label>
              <input type="text" :value="current.outcomeNote ?? ''" @input="outcomeNote = ($event.target as HTMLInputElement).value" placeholder="如：全额退款" />
            </div>
          </div>
          <button class="btn block" @click="saveOutcome">记录结果</button>
          <p v-if="current.outcomeCents != null" class="tiny win-action">已挽回 <strong>{{ fmtYuan(current.outcomeCents) }}</strong><span v-if="current.amountCents != null">（订单 {{ fmtYuan(current.amountCents) }}）</span></p>
        </div>

        <div class="card">
          <div class="card-h">时间线</div>
          <ul class="logs">
            <li v-for="(l, i) in [...current.logs].reverse()" :key="i">
              <span class="muted tiny">{{ fmtDateTime(l.at) }}</span> {{ STATUS_LABELS[l.status] }}<span v-if="l.note"> · {{ l.note }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- 规则速查 -->
      <div v-else-if="detailTab === 'rules'" class="rules-page">
        <div class="card">
          <div class="card-h">📌 本商品适用规则</div>
          <ul class="rule-list">
            <li><strong>7 天无理由退货</strong>：{{ current.customMade ? '该商品勾选了定作等例外，通常不适用；质量问题仍可主张。' : '签收次日起 7 日内、商品完好可退（拆封≠不完好）。' }}</li>
            <li v-if="CATEGORY_RULES[current.category].triplePack15"><strong>三包</strong>：常见 7 日内性能故障可退、15 日内可换，保修期内免费修理。</li>
            <li v-if="CATEGORY_RULES[current.category].warrantyMonths > 0"><strong>保修</strong>：常见整机 {{ CATEGORY_RULES[current.category].warrantyMonths }} 个月，以三包凭证/保修卡为准。</li>
            <li v-if="current.priceProtectDays > 0"><strong>价保</strong>：按平台规则 {{ current.priceProtectDays }} 天，以订单页为准。</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-h">❌ 常见例外与借口</div>
          <p class="tiny">{{ NOREASON_EXCEPTIONS }}</p>
        </div>
        <div class="card">
          <div class="card-h">📚 规则来源</div>
          <ul class="rule-list tiny">
            <li>{{ SOURCES.noReason }}</li>
            <li>{{ SOURCES.quality }}</li>
            <li>{{ SOURCES.triplePack }}</li>
            <li>{{ SOURCES.warranty }}</li>
            <li>{{ SOURCES.price }}</li>
          </ul>
          <p class="tiny muted">规则版本：{{ RULE_VERSION }}</p>
          <p class="tiny disclaimer">{{ DISCLAIMER }}</p>
        </div>
      </div>
    </section>

    <p v-if="toast" class="toast">{{ toast }}</p>
  </div>
</template>

<style scoped>
.sc-app {
  --brand: #2e7d52;
  --brand-d: #23613f;
  --ink: #20241f;
  --muted: #8a908a;
  --line: #e7eae6;
  --bg: #f5f6f3;
  --card: #ffffff;
  min-height: 100%;
  background: var(--bg);
  color: var(--ink);
  padding-bottom: 1rem;
}
.page {
  padding: 0.85rem 0.9rem 2rem;
  max-width: 760px;
  margin: 0 auto;
}
.board-head h1,
.sub-head h1 {
  margin: 0 0 0.25rem;
  font-size: 1.3rem;
}
.sub-head {
  position: sticky;
  top: 0;
  z-index: 15;
  background: var(--bg);
  padding: 0.6rem 0 0.5rem;
  border-bottom: 1px solid var(--line);
  margin-bottom: 0.6rem;
}
.link {
  background: none;
  border: none;
  color: var(--brand-d);
  font-size: 0.85rem;
  padding: 0;
  cursor: pointer;
}
.head-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.4rem;
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 0.78rem;
  line-height: 1.5;
}
.center {
  text-align: center;
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  padding: 0.8rem 0.9rem;
  margin-top: 0.7rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.btn {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 0.6rem;
  padding: 0.55rem 0.8rem;
  font-size: 0.9rem;
  cursor: pointer;
  color: var(--ink);
}
.btn.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.btn.ghost {
  background: transparent;
}
.btn.small {
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
}
.btn.tiny {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}
.btn.big {
  padding: 0.7rem 1rem;
  font-size: 1rem;
}
.btn.block {
  width: 100%;
  margin-top: 0.5rem;
}
.btn:disabled {
  opacity: 0.5;
}
.danger-text {
  color: #d0564a;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
label {
  display: block;
  font-size: 0.82rem;
  margin: 0.6rem 0 0.25rem;
  color: #4a504a;
}
input[type='text'],
input[type='number'],
input[type='date'],
select,
textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 0.55rem;
  padding: 0.55rem 0.6rem;
  font-size: 0.95rem;
  background: #fff;
  color: var(--ink);
}
.check label {
  margin: 1.4rem 0 0;
}
.case-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  padding: 0.8rem 0.9rem;
  margin-top: 0.7rem;
  cursor: pointer;
}
.case-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.case-name {
  font-size: 1.02rem;
}
.status-pill {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
  background: #eef2ee;
  color: #5c635c;
}
.mini-wins {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
  align-items: center;
}
.mini-wins span {
  font-size: 0.72rem;
  padding: 0.12rem 0.45rem;
  border-radius: 0.4rem;
  background: #f0f2ef;
}
.urg-dot {
  font-style: normal;
  background: #e0675a;
  color: #fff;
  font-size: 0.7rem;
  border-radius: 999px;
  padding: 0 0.4rem;
}
.empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--muted);
}
.empty-emoji {
  font-size: 2.4rem;
}
.seg {
  position: sticky;
  top: 0;
  z-index: 14;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.3rem;
  background: var(--bg);
  padding: 0.5rem 0;
}
.seg button {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 0.6rem;
  padding: 0.5rem 0.1rem;
  font-size: 0.78rem;
  color: #5c635c;
  white-space: nowrap;
}
.seg button.on {
  border-color: var(--brand);
  background: #eaf5ee;
  color: var(--brand-d);
  font-weight: 700;
}
.win-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.st {
  font-size: 0.78rem;
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 0.45rem;
  white-space: nowrap;
}
.st-open {
  background: #e7f3ec;
  color: #23613f;
}
.st-due-soon {
  background: #fdeede;
  color: #b25d16;
}
.st-expired {
  background: #fbe7e4;
  color: #c0492f;
}
.st-na {
  background: #eef0ee;
  color: #8a908a;
}
.win-action {
  margin: 0.5rem 0 0;
  font-size: 0.88rem;
}
.src {
  color: var(--muted);
  margin-bottom: 0;
}
.note {
  color: #b25d16;
}
.kind-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.kind-btn {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 999px;
  padding: 0.32rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
  color: #5c635c;
}
.kind-btn.on {
  border-color: var(--brand);
  background: #eaf5ee;
  color: var(--brand-d);
  font-weight: 700;
}
input[type='file'] {
  margin: 0.5rem 0;
  font-size: 0.85rem;
  width: 100%;
}
.file-pick {
  position: relative;
  display: block;
  text-align: center;
  overflow: hidden;
}
.file-pick input[type='file'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  margin: 0;
  cursor: pointer;
}
.file-pick.disabled {
  opacity: 0.5;
}
.ev-item {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
}
.ev-item img {
  width: 84px;
  height: 84px;
  object-fit: cover;
  border-radius: 0.5rem;
  border: 1px solid var(--line);
  flex: none;
}
.ev-meta {
  min-width: 0;
}
.empty-line {
  text-align: center;
  margin-top: 1.2rem;
}
.export-row {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.7rem;
}
.export-row .btn {
  flex: 1;
}
.letter-box {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  resize: vertical;
}
.upgrade-card {
  border-style: dashed;
}
.steps {
  padding-left: 1.2rem;
  margin: 0;
}
.steps li {
  padding: 0.25rem 0;
  color: #9aa09a;
}
.steps li.done {
  color: var(--brand-d);
}
.steps li.now {
  font-weight: 700;
}
.logs {
  list-style: none;
  padding: 0;
  margin: 0;
}
.logs li {
  padding: 0.3rem 0;
  border-bottom: 1px dashed var(--line);
  font-size: 0.85rem;
}
.rule-list {
  padding-left: 1.1rem;
  margin: 0;
}
.rule-list li {
  margin: 0.35rem 0;
}
.disclaimer {
  color: #a0764a;
}
.rules-short {
  margin-top: 1rem;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 5.2rem;
  transform: translateX(-50%);
  background: rgba(32, 36, 31, 0.92);
  color: #fff;
  padding: 0.55rem 0.9rem;
  border-radius: 0.6rem;
  font-size: 0.85rem;
  z-index: 50;
  max-width: 86vw;
  text-align: center;
}
@media (min-width: 820px) {
  .grid2 {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
