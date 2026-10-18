<script setup lang="ts">
/**
 * 多卡还款日·免息期管家 —— 数据只存本地 IndexedDB。
 * 边界：不录完整卡号/密码/CVV、不代查代还、不碰资金；日期与利息均为规则测算，以银行实际账单为准。
 */
import { computed, onMounted, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { FREE_CARD_LIMIT, manifest } from './manifest'
import { today, uid, yuanToCents, yuan, type CreditCard, type DueMode, type FeeGoal, type PaymentRecord } from './lib/models'
import { interestFreeDays } from './lib/cycle'
import { upcomingDues, type DueEvent } from './lib/timeline'
import { feeStatus } from './lib/annual-fee'
import { revolvingInterest, installmentFee, latePenalty } from './lib/interest'
import * as db from './lib/store'
import { buildRepaymentReminders, buildIcs, downloadIcs } from './lib/notify'

useSeo({
  title: '多卡还款日免息期管家 - 信用卡账单日还款日提醒·最长免息选卡·年费刷免·零授权本地',
  description:
    '集中管理多张信用卡账单日与还款日，倒计时防逾期罚息与征信风险，输入消费日推荐免息最长的卡，追踪年费刷免笔数，演示最低还款/分期利息；不录卡号密码、不代还、全程只存本机。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canMulti = computed(() => billing.canUse('multi').allowed)
const canPicker = computed(() => billing.canUse('picker').allowed)
const canFee = computed(() => billing.canUse('fee').allowed)
async function upgrade() {
  await billing.buy('freemium-pro')
}

const loaded = ref(false)
const cards = ref<CreditCard[]>([])
const payments = ref<PaymentRecord[]>([])
const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2800)
}

const todayStr = today()

async function reload() {
  const [cs, ps] = await Promise.all([db.getAll<CreditCard>('cards'), db.getAll<PaymentRecord>('payments')])
  cs.sort((a, b) => a.billingDay - b.billingDay)
  cards.value = cs
  payments.value = ps
  loaded.value = true
}
onMounted(reload)

// —— 视图 ——
const tab = ref<'dashboard' | 'cards' | 'picker' | 'fee' | 'about'>('dashboard')

// —— 还款时间线 ——
const dues = computed<DueEvent[]>(() => upcomingDues(cards.value, todayStr, payments.value))
function isPaid(ev: DueEvent): boolean {
  return payments.value.some((p) => p.cardId === ev.cardId && p.periodBilling === ev.billing)
}
async function markPaid(ev: DueEvent) {
  await db.put('payments', { id: uid('pay'), cardId: ev.cardId, periodBilling: ev.billing, paidAt: Date.now(), amountCents: 0 } as PaymentRecord)
  await reload()
  notify('已标记本期还款')
}
async function unmarkPaid(ev: DueEvent) {
  const p = payments.value.find((x) => x.cardId === ev.cardId && x.periodBilling === ev.billing)
  if (p) await db.remove('payments', p.id)
  await reload()
}
function stateText(ev: DueEvent): string {
  if (ev.daysLeft < 0) return `已逾期 ${-ev.daysLeft} 天`
  if (ev.daysLeft === 0) return '今天还款'
  return `还剩 ${ev.daysLeft} 天`
}
function exportReminders() {
  const ics = buildIcs(buildRepaymentReminders(dues.value, todayStr))
  downloadIcs(ics)
}

// —— 卡片编辑（独立 editing 态，避免与列表分支互吞） ——
const editing = ref(false)
const editId = ref('')
interface CardForm {
  name: string
  last4: string
  billingDay: number
  dueMode: DueMode
  dueDay: number
  dueOffsetDays: number
  limitText: string
  intoCurrent: boolean
  hasFee: boolean
  feeYearEnd: string
  feeTargetCount: string
  feeTargetAmountText: string
  feeProgressCount: string
  feeProgressAmountText: string
}
function blankForm(): CardForm {
  return {
    name: '',
    last4: '',
    billingDay: 1,
    dueMode: 'offset',
    dueDay: 10,
    dueOffsetDays: 20,
    limitText: '',
    intoCurrent: false,
    hasFee: false,
    feeYearEnd: '',
    feeTargetCount: '6',
    feeTargetAmountText: '',
    feeProgressCount: '0',
    feeProgressAmountText: ''
  }
}
const form = ref<CardForm>(blankForm())
const dayOptions = Array.from({ length: 31 }, (_, i) => i + 1)

function openCreate() {
  if (!canMulti.value && cards.value.length >= FREE_CARD_LIMIT) {
    notify(`免费版最多管理 ${FREE_CARD_LIMIT} 张卡，升级专业版后可不限卡数长期管理`)
    return
  }
  editId.value = ''
  form.value = blankForm()
  editing.value = true
}
function openEdit(c: CreditCard) {
  editId.value = c.id
  form.value = {
    name: c.name,
    last4: c.last4,
    billingDay: c.billingDay,
    dueMode: c.dueMode,
    dueDay: c.dueDay,
    dueOffsetDays: c.dueOffsetDays,
    limitText: c.limitCents ? yuan(c.limitCents) : '',
    intoCurrent: c.billingDayConsumptionIntoCurrent,
    hasFee: !!c.feeGoal,
    feeYearEnd: c.feeGoal?.yearEnd ?? '',
    feeTargetCount: String(c.feeGoal?.targetCount ?? 6),
    feeTargetAmountText: c.feeGoal?.targetAmountCents ? yuan(c.feeGoal.targetAmountCents) : '',
    feeProgressCount: String(c.feeGoal?.progressCount ?? 0),
    feeProgressAmountText: c.feeGoal?.progressAmountCents ? yuan(c.feeGoal.progressAmountCents) : ''
  }
  editing.value = true
}

async function saveCard() {
  const name = form.value.name.trim()
  if (!name) {
    notify('请填写卡片名称')
    return
  }
  const last4 = form.value.last4.replace(/\D/g, '').slice(-4)
  let feeGoal: FeeGoal | null = null
  if (form.value.hasFee) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.value.feeYearEnd)) {
      notify('请选择年费年度截止日')
      return
    }
    feeGoal = {
      yearEnd: form.value.feeYearEnd,
      targetCount: Number(form.value.feeTargetCount) || 0,
      targetAmountCents: yuanToCents(String(form.value.feeTargetAmountText ?? '')) ?? 0,
      progressCount: Number(form.value.feeProgressCount) || 0,
      progressAmountCents: yuanToCents(String(form.value.feeProgressAmountText ?? '')) ?? 0
    }
  }
  const now = Date.now()
  const existed = editId.value ? cards.value.find((c) => c.id === editId.value) : undefined
  const card: CreditCard = {
    id: editId.value || uid('card'),
    name,
    last4,
    billingDay: Number(form.value.billingDay),
    dueMode: form.value.dueMode,
    dueDay: Number(form.value.dueDay),
    dueOffsetDays: Number(form.value.dueOffsetDays) || 20,
    limitCents: yuanToCents(String(form.value.limitText ?? '')) ?? 0,
    billingDayConsumptionIntoCurrent: form.value.intoCurrent,
    feeGoal,
    createdAt: existed?.createdAt ?? now,
    updatedAt: now
  }
  await db.put('cards', card)
  editing.value = false
  await reload()
  notify('已保存')
}

async function removeCard(c: CreditCard) {
  if (!confirm(`删除「${c.name}」及其还款记录？`)) return
  await db.deleteCardCascade(c.id)
  editing.value = false
  await reload()
}

// —— 免息期选卡器 ——
const spendDate = ref(todayStr)
const pickerRows = computed(() =>
  cards.value
    .map((c) => ({ card: c, days: interestFreeDays(c, spendDate.value) }))
    .sort((a, b) => b.days - a.days)
)
const pickerBest = computed(() => pickerRows.value[0]?.card.id ?? '')

// —— 年费列表 ——
const feeRows = computed(() =>
  cards.value
    .map((c) => ({ card: c, st: feeStatus(c, todayStr) }))
    .filter((x) => x.st)
    .sort((a, b) => (a.st!.daysLeft - b.st!.daysLeft))
)

// —— 利息演示 ——
const intBillText = ref('10000')
const intPaidText = ref('1000')
const intDays = ref(30)
const intRate = ref(0.0005)
const instPrincipalText = ref('12000')
const instRate = ref(0.006)
const instPeriods = ref(12)
const minUnpaidText = ref('2000')
const intRevolving = computed(() => {
  const bill = yuanToCents(String(intBillText.value ?? ''))
  const paid = yuanToCents(String(intPaidText.value ?? ''))
  if (bill == null || paid == null) return null
  return revolvingInterest({ billCents: bill, paidCents: paid, days: Number(intDays.value) || 0, dailyRate: Number(intRate.value) || 0 })
})
const intInstall = computed(() => {
  const p = yuanToCents(String(instPrincipalText.value ?? ''))
  if (p == null) return null
  return installmentFee(p, Number(instRate.value) || 0, Number(instPeriods.value) || 1)
})
const intPenalty = computed(() => {
  const u = yuanToCents(String(minUnpaidText.value ?? ''))
  return u == null ? null : latePenalty(u)
})
</script>

<template>
  <div class="cb-app">
    <!-- ===== 编辑/新建卡片（独立态优先） ===== -->
    <section v-if="editing" class="page">
      <header class="sub-head">
        <button class="link" @click="editing = false">← 返回</button>
        <h1>{{ editId ? '编辑卡片' : '添加信用卡' }}</h1>
      </header>
      <div class="card form">
        <label>卡片名称 *</label>
        <input type="text" v-model="form.name" placeholder="如 招行经典白 / 交行沃尔玛" />

        <label>卡尾号后 4 位（可选，仅辨识用）</label>
        <input type="text" inputmode="numeric" maxlength="4" v-model="form.last4" placeholder="不录完整卡号" />

        <label>账单日（每月几号）*</label>
        <select v-model.number="form.billingDay">
          <option v-for="d in dayOptions" :key="d" :value="d">{{ d }} 号</option>
        </select>

        <label>还款日规则</label>
        <select v-model="form.dueMode">
          <option value="offset">账单日后第 N 天</option>
          <option value="fixed">固定每月某日</option>
        </select>

        <div v-if="form.dueMode === 'offset'" class="grid2">
          <div>
            <label>账单日后天数</label>
            <input type="number" min="1" max="60" v-model.number="form.dueOffsetDays" />
          </div>
          <div class="check"><label>&nbsp;</label><label class="inline"><input type="checkbox" v-model="form.intoCurrent" /> 账单日当天消费计入当期</label></div>
        </div>
        <div v-else>
          <label>固定还款日（每月几号）</label>
          <select v-model.number="form.dueDay">
            <option v-for="d in dayOptions" :key="d" :value="d">{{ d }} 号</option>
          </select>
        </div>

        <label>信用额度（元，可选）</label>
        <input type="text" inputmode="decimal" v-model="form.limitText" placeholder="如 50000" />

        <div class="card nested">
          <label class="inline"><input type="checkbox" v-model="form.hasFee" /> 这张卡需要刷免年费</label>
          <template v-if="form.hasFee">
            <label>年费年度截止日</label>
            <input type="date" v-model="form.feeYearEnd" />
            <div class="grid2">
              <div>
                <label>需刷笔数</label>
                <input type="number" min="0" v-model="form.feeTargetCount" />
              </div>
              <div>
                <label>需刷金额（元）</label>
                <input type="text" inputmode="decimal" v-model="form.feeTargetAmountText" placeholder="0 表示不考核" />
              </div>
              <div>
                <label>已刷笔数</label>
                <input type="number" min="0" v-model="form.feeProgressCount" />
              </div>
              <div>
                <label>已刷金额（元）</label>
                <input type="text" inputmode="decimal" v-model="form.feeProgressAmountText" />
              </div>
            </div>
            <p class="muted tiny">刷免条件各行不同（刷 N 笔 / 满额 / 积分抵扣），请按持卡行规则手动记录。</p>
          </template>
        </div>

        <button class="btn primary big block" @click="saveCard">保存卡片</button>
        <button v-if="editId" class="btn block danger-text" @click="removeCard(cards.find((c) => c.id === editId)!)">删除该卡</button>
        <p class="muted tiny">本工具不保存完整卡号、密码、CVV，也不会自动扣款；还款日规则如有特殊约定请按银行账单核对。</p>
      </div>
    </section>

    <!-- ===== 主界面 ===== -->
    <section v-else class="page">
      <nav class="seg" aria-label="功能">
        <button :class="{ on: tab === 'dashboard' }" @click="tab = 'dashboard'">⏱ 还款</button>
        <button :class="{ on: tab === 'cards' }" @click="tab = 'cards'">💳 卡片</button>
        <button :class="{ on: tab === 'picker' }" @click="tab = 'picker'">🃏 选卡</button>
        <button :class="{ on: tab === 'fee' }" @click="tab = 'fee'">🏦 年费·利息</button>
        <button :class="{ on: tab === 'about' }" @click="tab = 'about'">ℹ️ 说明</button>
      </nav>

      <!-- 还款看板 -->
      <div v-if="tab === 'dashboard'">
        <header class="board-head">
          <h1>本月还款</h1>
          <p class="muted tiny">按还款日从近到远排序；今天 {{ todayStr }}，金额与日期以银行账单为准。</p>
        </header>
        <div v-if="loaded && cards.length === 0" class="empty">
          <div class="empty-emoji">💳</div>
          <h2>还没有卡片</h2>
          <p>到「卡片」页添加账单日与还款日规则，即可集中查看最近该还哪张、还剩几天。</p>
        </div>
        <article v-for="ev in dues" :key="ev.cardId" class="due-card">
          <div class="due-top">
            <strong>{{ ev.name }}<span v-if="ev.last4" class="muted">（{{ ev.last4 }}）</span></strong>
            <span :class="['pill', `p-${ev.urgent}`]">{{ stateText(ev) }}</span>
          </div>
          <div class="muted tiny">账单日 {{ ev.billing }} · 还款日 {{ ev.due }}</div>
          <div class="due-actions">
            <button v-if="!isPaid(ev)" class="btn small primary" @click="markPaid(ev)">我已还款</button>
            <button v-else class="btn small ghost" @click="unmarkPaid(ev)">✓ 已还（撤销）</button>
          </div>
        </article>
        <button v-if="cards.length" class="btn block" @click="exportReminders">📅 导出还款日历提醒（.ics）</button>
        <p class="muted tiny center">手机后台通知不稳定，建议导出 .ics 导入系统日历，到期自动提醒。</p>
      </div>

      <!-- 卡片 -->
      <div v-else-if="tab === 'cards'">
        <header class="board-head"><h1>我的卡片（{{ cards.length }}）</h1></header>
        <button class="btn primary big block" @click="openCreate">＋ 添加卡片</button>
        <p v-if="!canMulti" class="muted tiny center">免费版可管理 {{ FREE_CARD_LIMIT }} 张卡，升级后不限数量</p>
        <article v-for="c in cards" :key="c.id" class="card card-row" @click="openEdit(c)">
          <div class="due-top">
            <strong>{{ c.name }}<span v-if="c.last4" class="muted">（{{ c.last4 }}）</span></strong>
            <span class="muted tiny">账单 {{ c.billingDay }} 号</span>
          </div>
          <div class="muted tiny">
            还款日：<template v-if="c.dueMode === 'fixed'">每月 {{ c.dueDay }} 号</template>
            <template v-else>账单日后 {{ c.dueOffsetDays }} 天</template>
            <span v-if="c.limitCents"> · 额度 {{ yuan(c.limitCents) }}</span>
          </div>
        </article>
      </div>

      <!-- 免息期选卡器 -->
      <div v-else-if="tab === 'picker'">
        <header class="board-head"><h1>免息期选卡器</h1><p class="muted tiny">输入计划消费日期，按可享免息天数从长到短排序。</p></header>
        <template v-if="canPicker">
          <div class="card">
            <label>计划消费日期</label>
            <input type="date" v-model="spendDate" />
          </div>
          <article v-for="r in pickerRows" :key="r.card.id" :class="['card pick-row', { best: r.card.id === pickerBest }]">
            <div class="due-top">
              <strong>{{ r.card.name }}<span v-if="r.card.last4" class="muted">（{{ r.card.last4 }}）</span></strong>
              <span class="days">{{ r.days }} 天</span>
            </div>
            <div class="muted tiny">{{ r.card.id === pickerBest ? '✅ 今天刷这张免息期最长' : '免息期较短' }}</div>
          </article>
          <p class="muted tiny center">免息天数 = 该笔消费所在账期还款日 − 消费日；账单日当天归属各行不同，已在卡片设置中可切换。</p>
        </template>
        <div v-else class="card upgrade-card">
          <div class="card-h">专业版功能</div>
          <p class="tiny">免息期选卡器、年费刷免追踪与利息测算是专业版能力。</p>
          <button class="btn primary block" @click="upgrade">升级专业版 {{ billing.priceText(billing.plan.priceCents) }}</button>
        </div>
      </div>

      <!-- 年费·利息 -->
      <div v-else-if="tab === 'fee'">
        <header class="board-head"><h1>年费刷免 & 利息测算</h1></header>
        <template v-if="canFee">
          <div v-if="feeRows.length" class="card">
            <div class="card-h">年费刷免进度</div>
            <div v-for="r in feeRows" :key="r.card.id" class="fee-row">
              <div class="due-top">
                <strong>{{ r.card.name }}</strong>
                <span :class="['pill', r.st!.met ? 'p-normal' : r.st!.daysLeft <= 30 ? 'p-soon' : 'p-normal']">
                  {{ r.st!.met ? '已达标' : `还差 ${r.st!.needCount} 笔${r.st!.needAmountCents ? ' / ' + yuan(r.st!.needAmountCents) + ' 元' : ''}` }}
                </span>
              </div>
              <div class="muted tiny">年度截止 {{ r.st!.yearEnd }}（{{ r.st!.daysLeft >= 0 ? '剩 ' + r.st!.daysLeft + ' 天' : '已过 ' + -r.st!.daysLeft + ' 天' }}）；已刷 {{ r.st!.haveCount }} 笔<span v-if="r.st!.haveAmountCents"> / {{ yuan(r.st!.haveAmountCents) }} 元</span></div>
            </div>
          </div>
          <div v-else class="empty"><p class="muted">在「卡片」里为需要刷免的卡开启年费目标。</p></div>

          <div class="card">
            <div class="card-h">未全额/最低还款利息演示</div>
            <div class="grid2">
              <div><label>账单金额（元）</label><input type="text" inputmode="decimal" v-model="intBillText" /></div>
              <div><label>到期已还（元）</label><input type="text" inputmode="decimal" v-model="intPaidText" /></div>
              <div><label>计息天数</label><input type="number" min="0" v-model.number="intDays" /></div>
              <div><label>日利率（默认万5）</label><input type="number" step="0.00001" v-model.number="intRate" /></div>
            </div>
            <p class="result">估算循环利息约 <strong>{{ intRevolving == null ? '—' : yuan(intRevolving) + ' 元' }}</strong></p>
          </div>

          <div class="card">
            <div class="card-h">分期手续费演示</div>
            <div class="grid2">
              <div><label>分期本金（元）</label><input type="text" inputmode="decimal" v-model="instPrincipalText" /></div>
              <div><label>每期手续费率</label><input type="number" step="0.001" v-model.number="instRate" /></div>
              <div><label>期数</label><input type="number" min="1" v-model.number="instPeriods" /></div>
            </div>
            <p class="result">总手续费约 <strong>{{ intInstall == null ? '—' : yuan(intInstall) + ' 元' }}</strong></p>
          </div>

          <div class="card">
            <div class="card-h">违约金演示（最低还款未还部分 ×5%）</div>
            <label>最低还款未还金额（元）</label>
            <input type="text" inputmode="decimal" v-model="minUnpaidText" />
            <p class="result">违约金约 <strong>{{ intPenalty == null ? '—' : yuan(intPenalty) + ' 元' }}</strong></p>
          </div>
          <p class="muted tiny center">以上仅为公式化估算，计息基数、费率与违约金各行不同，实际以银行账单为准；逾期还会影响征信，请按时全额还款。</p>
        </template>
        <div v-else class="card upgrade-card">
          <div class="card-h">专业版功能</div>
          <p class="tiny">年费刷免追踪与利息/违约金测算是专业版能力。</p>
          <button class="btn primary block" @click="upgrade">升级专业版 {{ billing.priceText(billing.plan.priceCents) }}</button>
        </div>
      </div>

      <!-- 说明 -->
      <div v-else class="card about">
        <div class="card-h">使用与隐私说明</div>
        <p class="tiny">① 只填写卡名、尾号、账单日/还款日规则，<strong>不录完整卡号、密码、CVV，不代查账单、不自动还款</strong>。</p>
        <p class="tiny">② 还款日两种规则：固定每月某日，或账单日后第 N 天；账单日在小月自动落到月末；账单日当天消费归属可在卡片里切换。</p>
        <p class="tiny">③ 免息天数=所在账期还款日−消费日，仅作选卡参考；利息/违约金为公式估算。<strong>一切日期与金额以银行实际账单为准。</strong></p>
        <p class="tiny">④ 所有数据只存在本机浏览器 IndexedDB，清理浏览器数据会丢失，重要提醒请导出 .ics。</p>
      </div>
    </section>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.cb-app {
  --brand: #2b6cb0;
  --brand-d: #1f5287;
  --ink: #20262b;
  --muted: #8a9099;
  --line: #e6e9ec;
  --bg: #f5f7f9;
  --card: #fff;
  min-height: 100%;
  background: var(--bg);
  color: var(--ink);
  padding-bottom: 1rem;
}
.page {
  padding: 0.7rem 0.9rem 2rem;
  max-width: 760px;
  margin: 0 auto;
}
.seg {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  gap: 0.3rem;
  background: var(--bg);
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
}
.seg button {
  flex: 1 0 auto;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 0.42rem 0.7rem;
  font-size: 0.82rem;
  white-space: nowrap;
  color: var(--ink);
  cursor: pointer;
}
.seg button.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.board-head h1,
.sub-head h1 {
  margin: 0.5rem 0 0.2rem;
  font-size: 1.25rem;
}
.sub-head {
  margin-bottom: 0.4rem;
}
.link {
  background: none;
  border: none;
  color: var(--brand-d);
  font-size: 0.85rem;
  padding: 0;
  cursor: pointer;
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 0.78rem;
  line-height: 1.55;
}
.center {
  text-align: center;
}
.card,
.due-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  padding: 0.8rem 0.9rem;
  margin-top: 0.7rem;
}
.card.nested {
  background: #fafbfc;
  padding: 0.6rem 0.7rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.4rem;
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
.btn.big {
  padding: 0.7rem 1rem;
  font-size: 1rem;
}
.btn.block {
  width: 100%;
  margin-top: 0.6rem;
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
  margin: 0.5rem 0 0.22rem;
  color: #47505a;
}
label.inline {
  display: inline;
  margin: 0;
}
.check {
  display: flex;
  align-items: flex-end;
}
input[type='text'],
input[type='number'],
input[type='date'],
select {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 0.55rem;
  font-size: 0.95rem;
  background: #fff;
}
.empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--muted);
}
.empty-emoji {
  font-size: 2.4rem;
}
.due-card {
  cursor: default;
}
.due-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
}
.due-actions {
  margin-top: 0.55rem;
}
.pill {
  border-radius: 999px;
  padding: 0.18rem 0.6rem;
  font-size: 0.78rem;
  white-space: nowrap;
}
.p-overdue {
  background: #fdecea;
  color: #c0392b;
}
.p-today {
  background: #fff1e0;
  color: #c2620a;
}
.p-soon {
  background: #fff7d6;
  color: #9a7b06;
}
.p-normal {
  background: #e8f2ec;
  color: #2e7d52;
}
.card-row {
  cursor: pointer;
}
.pick-row.best {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand) inset;
}
.days {
  font-weight: 700;
  color: var(--brand-d);
  font-size: 1.05rem;
}
.fee-row + .fee-row {
  border-top: 1px dashed var(--line);
  margin-top: 0.6rem;
  padding-top: 0.6rem;
}
.result {
  margin-top: 0.6rem;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 5.2rem;
  transform: translateX(-50%);
  background: rgba(30, 38, 44, 0.92);
  color: #fff;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  font-size: 0.85rem;
  z-index: 60;
  max-width: 88vw;
  text-align: center;
}
</style>
