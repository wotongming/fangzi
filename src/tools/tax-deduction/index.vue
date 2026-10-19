<script setup lang="ts">
/**
 * 个税专项附加扣除·年度汇算助手 —— 数据只存本地 IndexedDB。
 * 边界：只做规则参考、扣除额与区间估算、资料清单，不代申报、不接入税务系统、不构成税务/法律意见，
 * 一切以个税 App 与税务机关口径为准。规则版本见 lib/rules-cn.ts。
 */
import { computed, onMounted, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { FREE_ITEM_LIMIT, manifest } from './manifest'
import { RULE_VERSION, RULES, ruleOf } from './lib/rules-cn'
import { uid, yuan, yuanToCents, type DeductionItem, type DeductionKind, type CeType, type RentTier, type ElderRelation } from './lib/models'
import { itemAnnualDeduction, totalsByKind, totalAnnualDeduction } from './lib/deduction'
import { validate, countByLevel, type Finding } from './lib/validator'
import { buildSplitPlans } from './lib/split-plan'
import { estimateSaving } from './lib/estimate'
import { deriveChecklist } from './lib/docs'
import { buildTimelineEvents, buildIcs, downloadIcs } from './lib/notify'
import { exportEncrypted, downloadText } from './lib/crypto'
import * as db from './lib/store'

useSeo({
  title: '个税专项附加扣除汇算助手 - 七项扣除易错预检·夫妻分摊·退税估算·资料留存·本地不上传',
  description:
    '子女教育/婴幼儿照护/继续教育/大病医疗/房贷利息/住房租金/赡养老人七项专项附加扣除引导录入与易错预检，夫妻分摊方案对比，退税区间估算与资料5年留存清单；只做规则参考、不代申报，数据全程只存本机。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canMulti = computed(() => billing.canUse('multi').allowed)
const canSplit = computed(() => billing.canUse('split').allowed)
const canPro = computed(() => billing.canUse('pro').allowed)
async function upgrade() {
  await billing.buy('freemium-pro')
}

const yearOptions = [2023, 2024, 2025, 2026, 2027]
const year = ref(2026)

const loaded = ref(false)
const items = ref<DeductionItem[]>([])
const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 3000)
}

async function reload() {
  items.value = await db.getAllItems()
  loaded.value = true
}
onMounted(reload)

const tab = ref<'overview' | 'items' | 'check' | 'split' | 'tools' | 'about'>('overview')

const yearItems = computed<DeductionItem[]>(() =>
  items.value.filter((x) => x.year === year.value).sort((a, b) => a.kind.localeCompare(b.kind))
)
const kindTotals = computed(() => totalsByKind(yearItems.value))
const totalCents = computed(() => totalAnnualDeduction(yearItems.value))
const findings = computed<Finding[]>(() => validate(yearItems.value, year.value))
const findingCounts = computed(() => countByLevel(findings.value))
const splitResult = computed(() => buildSplitPlans(yearItems.value, year.value))
const checklist = computed(() => deriveChecklist(yearItems.value, year.value))

function kindName(k: DeductionKind): string {
  return ruleOf(k).name
}
function itemSummary(it: DeductionItem): string {
  const parts: string[] = []
  if (it.personName) parts.push(it.personName)
  if ((it.kind === 'childEducation' || it.kind === 'infantCare' || it.kind === 'mortgageLoan') && it.share === 0.5) parts.push('本人 50%')
  if (it.kind === 'continuingEducation') parts.push(it.ceType === 'cert' ? '职业资格 3600/年' : `学历 ${it.months} 个月`)
  if (it.kind === 'housingRent') parts.push(`${it.months} 个月`)
  if (it.kind === 'seriousIllness') parts.push(`自付 ${yuan(it.selfPaidCents ?? 0)} 元`)
  if (it.kind === 'elderlySupport') parts.push(it.onlyChild ? '独生' : `分摊 ${yuan(it.myShareMonthlyCents ?? 0)}/月`)
  if (!['continuingEducation', 'seriousIllness'].includes(it.kind) && it.kind !== 'housingRent' && it.kind !== 'elderlySupport') {
    if (it.kind === 'childEducation' || it.kind === 'infantCare' || it.kind === 'mortgageLoan') parts.push(`${it.months} 个月`)
  }
  return parts.join(' · ')
}

// ————— 编辑 —————
const editing = ref(false)
const editId = ref('')
interface ItemForm {
  kind: DeductionKind
  personName: string
  months: number
  share: 1 | 0.5
  endMonth: string
  ceType: CeType
  degreeCum: string
  selfPaidText: string
  rentTier: RentTier
  onlyChild: boolean
  myShareText: string
  siblingsTotalText: string
  elderlyAge: string
  elderlyRelation: ElderRelation
}
function blankForm(): ItemForm {
  return {
    kind: 'childEducation',
    personName: '',
    months: 12,
    share: 1,
    endMonth: '',
    ceType: 'degree',
    degreeCum: '',
    selfPaidText: '',
    rentTier: 'tier1',
    onlyChild: true,
    myShareText: '1500',
    siblingsTotalText: '3000',
    elderlyAge: '60',
    elderlyRelation: 'ownParent'
  }
}
const form = ref<ItemForm>(blankForm())
const kindOptions = RULES.map((r) => ({ value: r.kind, label: r.name, standard: r.standard, splittable: r.splittable }))
const isChildLike = (k: DeductionKind) => k === 'childEducation' || k === 'infantCare'

function openCreate() {
  if (!canMulti.value && yearItems.value.length >= FREE_ITEM_LIMIT) {
    notify(`免费版可登记 ${FREE_ITEM_LIMIT} 项扣除，升级专业版后可同时管理七项并做完整预检`)
    return
  }
  editId.value = ''
  form.value = blankForm()
  editing.value = true
}
function openEdit(it: DeductionItem) {
  editId.value = it.id
  form.value = {
    kind: it.kind,
    personName: it.personName ?? '',
    months: it.months,
    share: it.share,
    endMonth: it.endMonth ?? '',
    ceType: it.ceType ?? 'degree',
    degreeCum: it.degreeCumulativeMonths != null ? String(it.degreeCumulativeMonths) : '',
    selfPaidText: it.selfPaidCents ? yuan(it.selfPaidCents) : '',
    rentTier: it.rentTier ?? 'tier1',
    onlyChild: it.onlyChild ?? true,
    myShareText: it.myShareMonthlyCents ? yuan(it.myShareMonthlyCents) : '1500',
    siblingsTotalText: it.siblingsTotalMonthlyCents ? yuan(it.siblingsTotalMonthlyCents) : '3000',
    elderlyAge: it.elderlyAge != null ? String(it.elderlyAge) : '60',
    elderlyRelation: it.elderlyRelation ?? 'ownParent'
  }
  editing.value = true
}

async function saveItem() {
  const f = form.value
  if (isChildLike(f.kind) && !f.personName.trim()) {
    notify('请填写子女/婴幼儿姓名或标识（用于同一子女比例校验）')
    return
  }
  if (f.kind === 'elderlySupport' && f.elderlyRelation === 'spouseParent') {
    notify('配偶的父母应由配偶本人扣除，不能登记在本人名下')
    return
  }
  const now = Date.now()
  const existed = editId.value ? items.value.find((x) => x.id === editId.value) : undefined
  const months = f.kind === 'seriousIllness' || (f.kind === 'continuingEducation' && f.ceType === 'cert') ? 12 : Number(f.months) || 0
  const item: DeductionItem = {
    id: editId.value || uid('ded'),
    kind: f.kind,
    year: year.value,
    share: isChildLike(f.kind) || f.kind === 'mortgageLoan' ? f.share : 1,
    months,
    personName: isChildLike(f.kind) ? f.personName.trim() : undefined,
    endMonth: isChildLike(f.kind) && f.endMonth ? f.endMonth : undefined,
    createdAt: existed?.createdAt ?? now,
    updatedAt: now
  }
  if (f.kind === 'continuingEducation') {
    item.ceType = f.ceType
    item.degreeCumulativeMonths = f.ceType === 'degree' && f.degreeCum ? Number(f.degreeCum) || months : undefined
  }
  if (f.kind === 'seriousIllness') item.selfPaidCents = yuanToCents(f.selfPaidText) ?? 0
  if (f.kind === 'housingRent') item.rentTier = f.rentTier
  if (f.kind === 'elderlySupport') {
    item.onlyChild = f.onlyChild
    item.elderlyAge = Number(f.elderlyAge) || 0
    item.elderlyRelation = f.elderlyRelation
    if (!f.onlyChild) {
      item.myShareMonthlyCents = yuanToCents(f.myShareText) ?? 0
      item.siblingsTotalMonthlyCents = yuanToCents(f.siblingsTotalText) ?? 0
    }
  }
  await db.putItem(item)
  editing.value = false
  await reload()
  notify('已保存')
}
async function removeItem(it: DeductionItem) {
  if (!confirm(`删除「${kindName(it.kind)}」这条扣除记录？`)) return
  await db.removeItem(it.id)
  editing.value = false
  await reload()
}

// ————— 估算 —————
const taxableBeforeText = ref('180000')
const saving = computed(() => {
  const base = yuanToCents(taxableBeforeText.value)
  if (base == null) return null
  return estimateSaving(base, totalCents.value)
})

function exportReminders() {
  downloadIcs(buildIcs(buildTimelineEvents(year.value)))
}

async function exportBackup() {
  const pwd = (window.prompt('为备份设置一个口令（至少 4 位，忘记无法恢复）：') || '').trim()
  if (pwd.length < 4) {
    notify('口令至少 4 位，已取消导出')
    return
  }
  const payload = await exportEncrypted({ version: 1, exportedAt: new Date().toISOString(), items: items.value }, pwd)
  downloadText(payload, `fangzi-专项附加扣除备份-${year.value}.json`)
  notify('已导出加密备份')
}

function levelTag(f: Finding): string {
  return f.level === 'error' ? '风险' : f.level === 'warn' ? '提醒' : '提示'
}
</script>

<template>
  <div class="td-app">
    <!-- ===== 编辑 ===== -->
    <section v-if="editing" class="page">
      <header class="sub-head">
        <button class="link" @click="editing = false">← 返回</button>
        <h1>{{ editId ? '编辑扣除项' : '添加扣除项' }}</h1>
      </header>
      <div class="card form">
        <label>扣除项目 *</label>
        <select v-model="form.kind">
          <option v-for="o in kindOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <p class="muted tiny rule-standard">{{ ruleOf(form.kind).standard }}</p>

        <!-- 子女教育 / 婴幼儿照护 -->
        <template v-if="form.kind === 'childEducation' || form.kind === 'infantCare'">
          <label>子女/婴幼儿姓名或标识 *</label>
          <input type="text" v-model="form.personName" placeholder="如 张小明（仅你自己辨识用）" />
          <div class="grid2">
            <div>
              <label>本年享受月数（1-12）</label>
              <input type="number" min="1" max="12" v-model.number="form.months" />
            </div>
            <div>
              <label>本人扣除比例</label>
              <select v-model.number="form.share">
                <option :value="1">本人 100%</option>
                <option :value="0.5">夫妻各 50%</option>
              </select>
            </div>
          </div>
          <label>{{ form.kind === 'childEducation' ? '毕业/教育终止年月（如已毕业，必填）' : '满 3 岁年月（无则留空）' }}</label>
          <input type="month" v-model="form.endMonth" />
        </template>

        <!-- 继续教育 -->
        <template v-else-if="form.kind === 'continuingEducation'">
          <label>继续教育类型</label>
          <select v-model="form.ceType">
            <option value="degree">学历（学位）继续教育（400 元/月，最长 48 个月）</option>
            <option value="cert">职业资格继续教育（取证当年定额 3600 元）</option>
          </select>
          <template v-if="form.ceType === 'degree'">
            <label>本年享受月数（1-12）</label>
            <input type="number" min="1" max="12" v-model.number="form.months" />
            <label>该学历累计已享受月数（可选，用于 48 个月上限提醒）</label>
            <input type="number" min="0" max="48" v-model="form.degreeCum" placeholder="如 36" />
          </template>
          <p v-else class="muted tiny">取证当年按 3600 元定额扣除，本年登记一条即可（多本证书也只扣一次）。</p>
        </template>

        <!-- 大病医疗 -->
        <template v-else-if="form.kind === 'seriousIllness'">
          <label>本年医保目录范围内个人自付总额（元）</label>
          <input type="text" inputmode="decimal" v-model="form.selfPaidText" placeholder="如 32000（以医保费用清单为准）" />
          <p class="muted tiny">超过 15000 元的部分据实扣除，年度上限 80000 元；可由本人或配偶一方扣除，未成年子女由父母一方扣除。</p>
        </template>

        <!-- 房贷利息 -->
        <template v-else-if="form.kind === 'mortgageLoan'">
          <div class="grid2">
            <div>
              <label>本年享受月数（1-12）</label>
              <input type="number" min="1" max="12" v-model.number="form.months" />
            </div>
            <div>
              <label>本人扣除比例</label>
              <select v-model.number="form.share">
                <option :value="1">本人 100%</option>
                <option :value="0.5">夫妻各 50%</option>
              </select>
            </div>
          </div>
          <p class="muted tiny">仅限首套住房贷款，1000 元/月，实际扣除期限最长不超过 240 个月；与住房租金只能二选一。</p>
        </template>

        <!-- 住房租金 -->
        <template v-else-if="form.kind === 'housingRent'">
          <label>主要工作城市档次</label>
          <select v-model="form.rentTier">
            <option value="tier1">直辖市/省会/计划单列市（1500 元/月）</option>
            <option value="tier2">市辖区户籍人口超 100 万城市（1100 元/月）</option>
            <option value="tier3">其他城市（800 元/月）</option>
          </select>
          <label>本年享受月数（1-12）</label>
          <input type="number" min="1" max="12" v-model.number="form.months" />
          <p class="muted tiny">主要工作城市无自有住房方可扣除；同城夫妻只能由一方扣除，异地各自扣；与房贷利息二选一。</p>
        </template>

        <!-- 赡养老人 -->
        <template v-else-if="form.kind === 'elderlySupport'">
          <label class="inline"><input type="checkbox" v-model="form.onlyChild" /> 我是独生子女（全额 3000 元/月）</label>
          <template v-if="!form.onlyChild">
            <div class="grid2">
              <div>
                <label>本人每月分摊额（元，≤1500）</label>
                <input type="text" inputmode="decimal" v-model="form.myShareText" />
              </div>
              <div>
                <label>兄弟姐妹合计/月（元）</label>
                <input type="text" inputmode="decimal" v-model="form.siblingsTotalText" />
              </div>
            </div>
          </template>
          <div class="grid2">
            <div>
              <label>被赡养人年末年龄（周岁）</label>
              <input type="number" min="0" max="120" v-model="form.elderlyAge" />
            </div>
            <div>
              <label>与本人关系</label>
              <select v-model="form.elderlyRelation">
                <option value="ownParent">本人父母</option>
                <option value="grandparent">祖父母/外祖父母（子女均已去世）</option>
                <option value="spouseParent">配偶父母（应由配偶扣除）</option>
              </select>
            </div>
          </div>
          <label>本年享受月数（1-12，年满 60 岁当月起）</label>
          <input type="number" min="1" max="12" v-model.number="form.months" />
        </template>

        <button class="btn primary big block" @click="saveItem">保存扣除项</button>
        <button v-if="editId" class="btn block danger-text" @click="removeItem(items.find((x) => x.id === editId)!)">删除该扣除项</button>
      </div>
    </section>

    <!-- ===== 主界面 ===== -->
    <section v-else class="page">
      <nav class="seg" aria-label="功能">
        <button :class="{ on: tab === 'overview' }" @click="tab = 'overview'">📊 总览</button>
        <button :class="{ on: tab === 'items' }" @click="tab = 'items'">📝 扣除项</button>
        <button :class="{ on: tab === 'check' }" @click="tab = 'check'">✅ 校验</button>
        <button :class="{ on: tab === 'split' }" @click="tab = 'split'">👫 夫妻方案</button>
        <button :class="{ on: tab === 'tools' }" @click="tab = 'tools'">🧮 估算·资料</button>
        <button :class="{ on: tab === 'about' }" @click="tab = 'about'">ℹ️ 说明</button>
      </nav>

      <!-- 总览 -->
      <div v-if="tab === 'overview'">
        <header class="board-head">
          <div class="year-row">
            <h1>{{ year }} 年度专项附加扣除</h1>
            <select v-model.number="year" class="year-select" aria-label="纳税年度">
              <option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
            </select>
          </div>
          <p class="muted tiny">规则版本 {{ RULE_VERSION }}；金额为本人年度可扣额，仅作参考。</p>
        </header>

        <div class="card total-card">
          <div class="muted tiny">本年专项附加扣除合计（估算）</div>
          <div class="total-amount">{{ yuan(totalCents) }} <span class="unit">元</span></div>
          <div class="muted tiny">已登记 {{ yearItems.length }} 项 · 校验：{{ findingCounts.error }} 风险 / {{ findingCounts.warn }} 提醒</div>
        </div>

        <div v-if="loaded && yearItems.length === 0" class="empty">
          <div class="empty-emoji">🧾</div>
          <h2>还没有扣除项</h2>
          <p>到「📝 扣除项」页，按引导添加本年实际符合条件的子女教育、房贷租金、赡养老人等项目。</p>
        </div>

        <article v-for="r in kindTotals" :key="r.kind" class="card krow">
          <div class="due-top">
            <strong>{{ kindName(r.kind) }}</strong>
            <span class="amount">{{ yuan(r.cents) }} 元</span>
          </div>
          <div class="muted tiny">{{ ruleOf(r.kind).standard }}</div>
        </article>

        <div class="card disc-card">
          <strong>重要免责</strong>
          <p class="tiny">本工具仅按公开规则做条件提示、扣除额与区间估算、资料清单整理，<b>不代为申报、不构成税务/法律意见</b>；具体条件、金额与能否扣除以个人所得税 App 及税务机关核定为准。</p>
        </div>
      </div>

      <!-- 扣除项 -->
      <div v-else-if="tab === 'items'">
        <header class="board-head"><h1>扣除项（{{ yearItems.length }}）</h1><p class="muted tiny">{{ year }} 纳税年度</p></header>
        <button class="btn primary big block" @click="openCreate">＋ 添加扣除项</button>
        <p v-if="!canMulti" class="muted tiny center">免费版可登记 {{ FREE_ITEM_LIMIT }} 项，升级后可同时管理七项并完整预检</p>
        <article v-for="it in yearItems" :key="it.id" class="card card-row" @click="openEdit(it)">
          <div class="due-top">
            <strong>{{ kindName(it.kind) }}</strong>
            <span class="amount">{{ yuan(itemAnnualDeduction(it)) }} 元</span>
          </div>
          <div class="muted tiny">{{ itemSummary(it) }}</div>
        </article>
      </div>

      <!-- 校验 -->
      <div v-else-if="tab === 'check'">
        <header class="board-head"><h1>填报易错预检</h1><p class="muted tiny">自动检查超额超比例、互斥、终止时间、分摊上限等高频风险。</p></header>
        <div class="check-summary">
          <span class="chip err">风险 {{ findingCounts.error }}</span>
          <span class="chip warn">提醒 {{ findingCounts.warn }}</span>
          <span class="chip info">提示 {{ findingCounts.info }}</span>
        </div>
        <article v-for="(f, i) in findings" :key="i" :class="['card finding', `f-${f.level}`]">
          <div class="due-top"><span class="tag" :class="`t-${f.level}`">{{ levelTag(f) }}</span><code class="code">{{ f.code }}</code></div>
          <p class="tiny msg">{{ f.msg }}</p>
        </article>
      </div>

      <!-- 夫妻方案 -->
      <div v-else-if="tab === 'split'">
        <header class="board-head"><h1>夫妻分摊方案</h1><p class="muted tiny">仅比较可分摊项（子女教育/婴幼儿/房贷利息）的扣除额分配。</p></header>
        <template v-if="canSplit">
          <div v-if="splitResult" class="card">
            <div class="muted tiny">可分摊项家庭年度合计：<b>{{ yuan(splitResult.splittableTotalCents) }} 元</b>（{{ splitResult.splittableKinds.join('、') }}）</div>
            <div v-for="p in splitResult.plans" :key="p.key" class="split-row">
              <div class="due-top">
                <strong>{{ p.label }}</strong>
                <span class="muted tiny">本人 {{ yuan(p.selfSplittableCents) }} / 配偶 {{ yuan(p.spouseSplittableCents) }}</span>
              </div>
            </div>
            <p class="tiny tip">{{ splitResult.tip }}</p>
          </div>
          <div v-else class="empty"><p class="muted">添加子女教育、婴幼儿照护或首套房贷利息后，这里会给出 100% / 各 50% 的分摊对比。</p></div>
        </template>
        <div v-else class="card upgrade-card">
          <div class="card-h">专业版功能</div>
          <p class="tiny">夫妻分摊方案对比是专业版能力。</p>
          <button class="btn primary block" @click="upgrade">升级专业版 {{ billing.priceText(billing.plan.priceCents) }}</button>
        </div>
      </div>

      <!-- 估算·资料·提醒 -->
      <div v-else-if="tab === 'tools'">
        <header class="board-head"><h1>退税估算 · 资料留存 · 提醒</h1></header>
        <template v-if="canPro">
          <div class="card">
            <div class="card-h">全年少缴税额估算（区间示意）</div>
            <label>计入专项附加扣除前的年应纳税所得额（元）</label>
            <input type="text" inputmode="decimal" v-model="taxableBeforeText" placeholder="如 180000，可用工资收入−6万−五险一金等粗略估算" />
            <p v-if="saving" class="result">
              专项附加扣除约可少缴 <strong>{{ yuan(saving.savedCents) }} 元</strong>
              <span class="muted tiny">（按 {{ Math.round(saving.marginalRate * 100) }}% 边际档；{{ saving.saturated ? '应纳税所得额已为 0，再多扣除也不退税' : '未跨档时≈扣除额×边际税率' }}）</span>
            </p>
            <p class="muted tiny">仅为公式化区间示意，未含劳务报酬、年终奖单独计税、其他减免等，实际以个税 App 年度汇算为准。</p>
          </div>

          <div class="card">
            <div class="card-h">资料留存清单（留存 5 年备查）</div>
            <p v-if="checklist.length === 0" class="muted tiny">添加扣除项后自动生成。</p>
            <div v-for="row in checklist" :key="row.key" class="doc-row">
              <strong>{{ row.kindName }}</strong><span class="muted tiny">留存至 {{ row.keepUntilYear }} 年</span>
              <ul><li v-for="(d, i) in row.docs" :key="i" class="tiny">{{ d }}</li></ul>
            </div>
          </div>

          <button class="btn block" @click="exportReminders">📅 导出年度节点日历提醒（.ics）</button>
          <button class="btn block" @click="exportBackup">🔐 加密导出全部年度备份</button>
          <p class="muted tiny center">建议导出 .ics 导入系统日历（12 月确认 / 次年 3 月开始 / 6 月 30 日截止）；加密备份用口令 AES-GCM 加密，只存你本机、忘记口令无法恢复。</p>
        </template>
        <div v-else class="card upgrade-card">
          <div class="card-h">专业版功能</div>
          <p class="tiny">退税区间估算、资料留存导出、加密备份与 .ics 年度节点提醒是专业版能力。资料清单可在下方「说明」查看通用版。</p>
          <button class="btn primary block" @click="upgrade">升级专业版 {{ billing.priceText(billing.plan.priceCents) }}</button>
        </div>
      </div>

      <!-- 说明 -->
      <div v-else class="card about">
        <div class="card-h">使用与合规说明</div>
        <p class="tiny">① 覆盖七项：子女教育、3 岁以下婴幼儿照护、继续教育、大病医疗、住房贷款利息、住房租金、赡养老人。标准与条件集中在规则表（{{ RULE_VERSION }}），每年税季后会依据税务总局/官媒口径复核更新。</p>
        <p class="tiny">② <b>房贷利息与租金只能二选一</b>；同一子女父母合计比例不超过 100%；子女毕业后要填终止时间；配偶父母由配偶本人扣除；非独生子女分摊每人每月不超过 1500 元。</p>
        <p class="tiny">③ 大病医疗为自付超 15000 部分、上限 80000；继续教育学历类每月 400、最长 48 个月，职业资格取证当年 3600。</p>
        <p class="tiny">④ 所有数据只存在本机浏览器 IndexedDB，清理浏览器数据会丢失，建议用加密备份导出。</p>
        <p class="tiny">⑤ <b>本工具不代申报、不接入税务系统、不构成税务/法律意见</b>，金额与条件以个人所得税 App 与税务机关核定为准。</p>
      </div>
    </section>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.td-app {
  --brand: #8a5a28;
  --brand-d: #6f471e;
  --ink: #2a2520;
  --muted: #8b8378;
  --line: #e9e3da;
  --bg: #faf7f2;
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
  font-size: 1.22rem;
}
.year-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.year-select {
  width: auto;
  flex: 0 0 auto;
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
.rule-standard {
  margin: 0.35rem 0 0;
  padding: 0.4rem 0.55rem;
  background: #f6f1e9;
  border-radius: 0.5rem;
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
  margin-bottom: 0.4rem;
}
.total-card {
  text-align: center;
  padding: 1rem;
}
.total-amount {
  font-size: 2rem;
  font-weight: 800;
  color: var(--brand-d);
  margin: 0.2rem 0;
}
.total-amount .unit {
  font-size: 0.9rem;
  font-weight: 500;
}
.disc-card {
  border-color: #e6d3b8;
  background: #fdf8ef;
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
.danger-text {
  color: #b04a3a;
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
  color: #4a433b;
}
label.inline {
  display: block;
  margin: 0.6rem 0;
}
input[type='text'],
input[type='number'],
input[type='month'],
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
.card-row {
  cursor: pointer;
}
.due-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
}
.amount {
  font-weight: 700;
  color: var(--brand-d);
  white-space: nowrap;
}
.check-summary {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.7rem;
}
.chip {
  border-radius: 999px;
  padding: 0.25rem 0.7rem;
  font-size: 0.8rem;
}
.chip.err {
  background: #fdecea;
  color: #c0392b;
}
.chip.warn {
  background: #fff4dd;
  color: #b07409;
}
.chip.info {
  background: #eef3ec;
  color: #3d7a55;
}
.finding {
  border-left-width: 3px;
}
.f-error {
  border-left-color: #d0564a;
}
.f-warn {
  border-left-color: #e0a52f;
}
.f-info {
  border-left-color: #7ba78c;
}
.tag {
  border-radius: 999px;
  padding: 0.12rem 0.55rem;
  font-size: 0.75rem;
}
.t-error {
  background: #fdecea;
  color: #c0392b;
}
.t-warn {
  background: #fff4dd;
  color: #b07409;
}
.t-info {
  background: #eef3ec;
  color: #3d7a55;
}
.code {
  font-size: 0.7rem;
  color: var(--muted);
}
.finding .msg {
  margin: 0.4rem 0 0;
}
.split-row {
  padding: 0.55rem 0;
  border-top: 1px dashed var(--line);
}
.split-row:first-of-type {
  border-top: none;
}
.tip {
  margin-top: 0.5rem;
  padding: 0.5rem 0.6rem;
  background: #f6f1e9;
  border-radius: 0.5rem;
}
.doc-row {
  padding: 0.55rem 0;
  border-top: 1px dashed var(--line);
}
.doc-row ul {
  margin: 0.3rem 0 0;
  padding-left: 1.1rem;
}
.result {
  margin-top: 0.6rem;
}
.upgrade-card {
  border-color: #e0c79b;
  background: #fdf8ef;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 5.2rem;
  transform: translateX(-50%);
  background: rgba(40, 32, 24, 0.92);
  color: #fff;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  font-size: 0.85rem;
  z-index: 60;
  max-width: 88vw;
  text-align: center;
}
</style>
