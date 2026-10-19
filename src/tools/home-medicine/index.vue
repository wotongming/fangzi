<script setup lang="ts">
/**
 * 家庭药箱与多重用药管家 —— 数据只存本地 IndexedDB。
 * 严格边界：只做记录、计划、说明书层面的已知成分/组合提示与就诊材料整理，
 * 不诊断、不开药、不评价或调整处方，不替代医生/药师的个体化判断；
 * 命中风险一律引导线下咨询医生或药师。规则版本见 lib/rules-cn.ts。
 */
import { computed, onMounted, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { FREE_MEMBER_LIMIT, manifest } from './manifest'
import {
  DOSE_FORM_LABEL,
  MED_TYPE_LABEL,
  SLOT_LABEL,
  SLOT_ORDER,
  todayStr,
  uid,
  type DoseForm,
  type Med,
  type MedType,
  type Member,
  type SlotKey
} from './lib/models'
import { INGREDIENT_KEYS, INGREDIENTS, RULE_VERSION } from './lib/rules-cn'
import { expiryInfo } from './lib/expiry'
import { reviewMeds, countByLevel, type Finding } from './lib/safety'
import { todayPlan, MISSED_DOSE_ADVICE } from './lib/schedule'
import { buildClinicText, buildReviewText } from './lib/clinic-list'
import { buildMedIcs, downloadIcs, ensureNotifyPermission } from './lib/notify'
import { exportEncrypted, downloadText } from './lib/crypto'
import * as db from './lib/store'

useSeo({
  title: '家庭药箱与多重用药管家 - 药品有效期开封倒计时·服药提醒·成分重复提示·就诊带药清单·本地不上传',
  description:
    '家庭药箱台账与有效期/开封倒计时，早中晚睡前服药计划与系统日历提醒，对乙酰氨基酚叠加、抗凝药+布洛芬等成分重复与高风险组合保守提示，季度理药与就诊带药清单导出；只记录提醒、不诊断不开药，数据全程只存本机。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canMulti = computed(() => billing.canUse('multi').allowed)
const canSafety = computed(() => billing.canUse('safety').allowed)
const canPro = computed(() => billing.canUse('pro').allowed)
async function upgrade() {
  await billing.buy('freemium-pro')
}

const today = todayStr()
const loaded = ref(false)
const members = ref<Member[]>([])
const meds = ref<Med[]>([])
const currentId = ref('')
const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 3200)
}

async function reload() {
  members.value = await db.getAllMembers()
  meds.value = await db.getAllMeds()
  if (!currentId.value && members.value.length) currentId.value = members.value[0]?.id ?? ''
  loaded.value = true
}
onMounted(reload)

const tab = ref<'plan' | 'cabinet' | 'safety' | 'clinic' | 'about'>('plan')

const currentMember = computed<Member | undefined>(() => members.value.find((m) => m.id === currentId.value))
const currentMeds = computed<Med[]>(() => meds.value.filter((m) => m.memberId === currentId.value))
const activeMeds = computed(() => currentMeds.value.filter((m) => m.active))
const plan = computed(() => todayPlan(currentMeds.value, today))
const findings = computed<Finding[]>(() => reviewMeds(currentMeds.value, today))
const counts = computed(() => countByLevel(findings.value))

function expOf(m: Med) {
  return expiryInfo(m, today)
}
function expiryText(m: Med): string {
  const i = expOf(m)
  if (i.level === 'none') return '未设有效期'
  if (i.level === 'expired') return `已过期 ${Math.abs(i.days ?? 0)} 天（${i.date}）`
  if (i.level === 'near') return `临期 · 剩 ${i.days} 天（${i.date}）`
  return `有效期至 ${i.date}`
}

// ————— 成员 —————
const addingMember = ref(false)
const memberName = ref('')
function openAddMember() {
  if (!canMulti.value && members.value.length >= FREE_MEMBER_LIMIT) {
    notify(`免费版可建 ${FREE_MEMBER_LIMIT} 位成员，升级专业版后可为父母/配偶/孩子分别建档`)
    return
  }
  memberName.value = ''
  addingMember.value = true
}
async function saveMember() {
  const name = memberName.value.trim()
  if (!name) {
    notify('请填写成员称呼，如「爸爸」「妈妈」')
    return
  }
  const now = Date.now()
  const m: Member = { id: uid('mem'), name, createdAt: now, updatedAt: now }
  await db.putMember(m)
  currentId.value = m.id
  addingMember.value = false
  await reload()
}
async function deleteMember(m: Member) {
  if (!confirm(`删除成员「${m.name}」会同时删除其全部药品记录，确定吗？`)) return
  await db.removeMemberCascade(m.id)
  if (currentId.value === m.id) currentId.value = ''
  await reload()
}

// ————— 药品编辑 —————
const TYPE_OPTIONS = (Object.keys(MED_TYPE_LABEL) as MedType[]).map((v) => ({ value: v, label: MED_TYPE_LABEL[v] }))
const FORM_OPTIONS = (Object.keys(DOSE_FORM_LABEL) as DoseForm[]).map((v) => ({ value: v, label: DOSE_FORM_LABEL[v] }))
const ING_OPTIONS = INGREDIENT_KEYS.map((k) => ({ value: k, label: INGREDIENTS[k]?.name ?? k }))
function slotNames(slots: SlotKey[]): string {
  return slots.map((s) => SLOT_LABEL[s]).join('/')
}

interface MedForm {
  name: string
  spec: string
  type: MedType
  form: DoseForm
  ingredientKeys: string[]
  doseText: string
  slots: SlotKey[]
  startDate: string
  stopDate: string
  expiryDate: string
  openedDate: string
  openDaysText: string
  stockText: string
  location: string
  active: boolean
  note: string
}
const editing = ref(false)
const editId = ref('')
function blankForm(): MedForm {
  return {
    name: '',
    spec: '',
    type: 'rx',
    form: 'tablet',
    ingredientKeys: [],
    doseText: '',
    slots: [],
    startDate: '',
    stopDate: '',
    expiryDate: '',
    openedDate: '',
    openDaysText: '',
    stockText: '',
    location: '',
    active: true,
    note: ''
  }
}
const form = ref<MedForm>(blankForm())

function openCreateMed() {
  if (!currentId.value) {
    notify('请先添加一位家庭成员')
    return
  }
  editId.value = ''
  form.value = blankForm()
  editing.value = true
}
function openEditMed(m: Med) {
  editId.value = m.id
  form.value = {
    name: m.name,
    spec: m.spec ?? '',
    type: m.type,
    form: m.form,
    ingredientKeys: [...m.ingredientKeys],
    doseText: m.doseText ?? '',
    slots: [...m.slots],
    startDate: m.startDate ?? '',
    stopDate: m.stopDate ?? '',
    expiryDate: m.expiryDate ?? '',
    openedDate: m.openedDate ?? '',
    openDaysText: m.openDays != null ? String(m.openDays) : '',
    stockText: m.stockText ?? '',
    location: m.location ?? '',
    active: m.active,
    note: m.note ?? ''
  }
  editing.value = true
}
function toggleSlot(s: SlotKey) {
  const arr = form.value.slots
  const i = arr.indexOf(s)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(s)
  // 保持早中晚睡前顺序
  form.value.slots = SLOT_ORDER.filter((x) => arr.includes(x))
}
function toggleIng(k: string) {
  const arr = form.value.ingredientKeys
  const i = arr.indexOf(k)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(k)
}
async function saveMed() {
  const f = form.value
  if (!f.name.trim()) {
    notify('请填写药品通用名（优先）或商品名')
    return
  }
  const now = Date.now()
  const existed = editId.value ? meds.value.find((x) => x.id === editId.value) : undefined
  const med: Med = {
    id: editId.value || uid('med'),
    memberId: currentId.value,
    name: f.name.trim(),
    spec: f.spec.trim() || undefined,
    type: f.type,
    form: f.form,
    ingredientKeys: f.ingredientKeys,
    doseText: f.doseText.trim() || undefined,
    slots: f.slots,
    startDate: f.startDate || undefined,
    stopDate: f.stopDate || undefined,
    expiryDate: f.expiryDate || undefined,
    openedDate: f.openedDate || undefined,
    openDays: f.openDaysText ? Number(f.openDaysText) || undefined : undefined,
    stockText: f.stockText.trim() || undefined,
    location: f.location.trim() || undefined,
    active: f.active,
    note: f.note.trim() || undefined,
    createdAt: existed?.createdAt ?? now,
    updatedAt: now
  }
  await db.putMed(med)
  editing.value = false
  await reload()
}
async function deleteMed() {
  if (!editId.value) return
  const m = meds.value.find((x) => x.id === editId.value)
  if (!confirm(`删除药品「${m?.name ?? ''}」？`)) return
  await db.removeMed(editId.value)
  editing.value = false
  await reload()
}

// ————— 导出 / 提醒 —————
async function exportIcs() {
  if (activeMeds.value.length === 0) {
    notify('还没有“仍在使用”且设定了服药时段的药品')
    return
  }
  await ensureNotifyPermission()
  downloadIcs(buildMedIcs(currentMeds.value, today))
  notify('已导出 30 天服药日历（.ics），请导入系统日历')
}
function exportClinic() {
  if (!canPro.value) {
    notify('就诊带药清单导出是专业版功能')
    return
  }
  if (activeMeds.value.length === 0) {
    notify('当前没有“仍在使用”的药品')
    return
  }
  downloadText(buildClinicText(currentMember.value, currentMeds.value, today), `就诊带药清单-${currentMember.value?.name ?? ''}.txt`, 'text/plain')
}
function exportReview() {
  if (!canSafety.value) {
    notify('季度理药梳理是专业版功能')
    return
  }
  downloadText(buildReviewText(currentMember.value, currentMeds.value, today), `家庭药箱季度梳理-${currentMember.value?.name ?? ''}.txt`, 'text/plain')
}
async function exportBackup() {
  if (!canPro.value) {
    notify('加密家庭档案导出是专业版功能')
    return
  }
  const pwd = (window.prompt('设置一个备份口令（AES-GCM 加密，只存本机，忘记无法恢复）') || '').trim()
  if (!pwd) return
  const payload = await exportEncrypted(
    { version: 1, exportedAt: Date.now(), member: currentMember.value, meds: currentMeds.value, ruleVersion: RULE_VERSION },
    pwd
  )
  downloadText(payload, `家庭用药档案-${currentMember.value?.name ?? ''}-${today}.json`)
}

const levelChip: Record<string, string> = { danger: '风险', warn: '提醒', info: '提示' }
</script>

<template>
  <div class="hm-app">
    <div class="page">
      <!-- 成员切换 -->
      <div class="member-bar">
        <button v-for="m in members" :key="m.id" :class="['mem-chip', { on: m.id === currentId }]" @click="currentId = m.id">{{ m.name }}</button>
        <button class="mem-chip add" @click="openAddMember">＋ 成员</button>
      </div>

      <div v-if="addingMember" class="card">
        <label>成员称呼</label>
        <input v-model="memberName" type="text" placeholder="如：爸爸 / 妈妈 / 本人" @keyup.enter="saveMember" />
        <div class="row-btns">
          <button class="btn small" @click="addingMember = false">取消</button>
          <button class="btn primary small" @click="saveMember">保存</button>
        </div>
      </div>

      <template v-if="loaded && members.length === 0 && !addingMember">
        <div class="empty">
          <div class="empty-emoji">💊</div>
          <p>先添加一位家庭成员，再为 TA 建立家庭药箱与服药计划。</p>
          <button class="btn primary big block" @click="openAddMember">＋ 添加家庭成员</button>
          <p class="muted tiny">免费版可建 {{ FREE_MEMBER_LIMIT }} 位成员；数据只存本机，不上传。</p>
        </div>
      </template>

      <template v-else-if="currentId">
        <nav class="seg">
          <button :class="{ on: tab === 'plan' }" @click="tab = 'plan'">今日用药</button>
          <button :class="{ on: tab === 'cabinet' }" @click="tab = 'cabinet'">药箱 {{ currentMeds.length }}</button>
          <button :class="{ on: tab === 'safety' }" @click="tab = 'safety'">安全梳理</button>
          <button :class="{ on: tab === 'clinic' }" @click="tab = 'clinic'">就诊清单</button>
          <button :class="{ on: tab === 'about' }" @click="tab = 'about'">说明</button>
        </nav>

        <!-- 今日用药 -->
        <section v-if="tab === 'plan'">
          <header class="board-head">
            <h1>{{ currentMember?.name }} 的今日用药</h1>
            <p class="muted tiny">{{ today }} · 具体剂量与时间请以医嘱为准</p>
          </header>
          <div v-if="plan.length === 0" class="empty">
            <p class="muted">今天没有排期的服药计划。可在「药箱」里添加药品并勾选服药时段。</p>
          </div>
          <article v-for="p in plan" :key="p.slot" class="card">
            <div class="due-top"><strong class="slot-name">{{ p.label }} · {{ p.clock }}</strong><span class="muted tiny">{{ p.items.length }} 种</span></div>
            <div v-for="it in p.items" :key="it.med.id" class="plan-item">
              <span class="dot"></span>
              <div>
                <strong>{{ it.med.name }}</strong>
                <span class="muted tiny">{{ it.med.spec || '' }} {{ it.doseText ? `· 每次 ${it.doseText}` : '' }}</span>
              </div>
            </div>
          </article>
          <button class="btn block" @click="exportIcs">📅 导出 30 天服药日历提醒（.ics）</button>
          <div class="card disc-card">
            <p class="tiny">{{ MISSED_DOSE_ADVICE }}</p>
          </div>
        </section>

        <!-- 药箱 -->
        <section v-else-if="tab === 'cabinet'">
          <header class="board-head">
            <h1>家庭药箱（{{ currentMeds.length }}）</h1>
            <p class="muted tiny">登记有效期与开封日，自动倒计时；成分/高风险提示在「安全梳理」。</p>
          </header>
          <button class="btn primary big block" @click="openCreateMed">＋ 添加药品</button>
          <article v-for="m in currentMeds" :key="m.id" class="card card-row" @click="openEditMed(m)">
            <div class="due-top">
              <strong>{{ m.name }} <span class="muted tiny">{{ MED_TYPE_LABEL[m.type] }}{{ m.active ? '' : ' · 已停用' }}</span></strong>
              <span :class="['exp-badge', `e-${expOf(m).level}`]">{{ expiryText(m) }}</span>
            </div>
            <div class="muted tiny">
              {{ DOSE_FORM_LABEL[m.form] }}<template v-if="m.slots.length"> · {{ slotNames(m.slots) }}服</template><template v-if="m.location"> · 放于{{ m.location }}</template>
            </div>
          </article>

          <!-- 编辑表单 -->
          <div v-if="editing" class="card form-card" @click.stop>
            <div class="card-h">{{ editId ? '编辑药品' : '添加药品' }}</div>
            <label>药品名称（通用名优先）</label>
            <input v-model="form.name" type="text" placeholder="如：苯磺酸氨氯地平片" />
            <div class="grid2">
              <div>
                <label>规格</label>
                <input v-model="form.spec" type="text" placeholder="如 5mg*7片" />
              </div>
              <div>
                <label>每次剂量</label>
                <input v-model="form.doseText" type="text" placeholder="如 1片 / 5ml" />
              </div>
            </div>
            <div class="grid2">
              <div>
                <label>类别</label>
                <select v-model="form.type">
                  <option v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
              <div>
                <label>剂型</label>
                <select v-model="form.form">
                  <option v-for="o in FORM_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
            </div>

            <label>服药时段（生成今日计划与日历提醒）</label>
            <div class="slot-pick">
              <button v-for="s in SLOT_ORDER" :key="s" type="button" :class="['slot-btn', { on: form.slots.includes(s) }]" @click="toggleSlot(s)">{{ SLOT_LABEL[s] }}</button>
            </div>

            <label>已知成分（拿不准可不选；选了才做成分/组合提示，避免误报）</label>
            <div class="ing-grid">
              <button v-for="o in ING_OPTIONS" :key="o.value" type="button" :class="['ing-btn', { on: form.ingredientKeys.includes(o.value) }]" @click="toggleIng(o.value)">{{ o.label }}</button>
            </div>

            <div class="grid2">
              <div>
                <label>用药开始</label>
                <input v-model="form.startDate" type="date" />
              </div>
              <div>
                <label>用药结束（长期留空）</label>
                <input v-model="form.stopDate" type="date" />
              </div>
            </div>
            <div class="grid2">
              <div>
                <label>包装有效期至</label>
                <input v-model="form.expiryDate" type="date" />
              </div>
              <div>
                <label>开封日期</label>
                <input v-model="form.openedDate" type="date" />
              </div>
            </div>
            <div class="grid2">
              <div>
                <label>开封后可用天数（滴眼液默认 28）</label>
                <input v-model="form.openDaysText" type="number" inputmode="numeric" placeholder="留空按剂型默认" />
              </div>
              <div>
                <label>存放位置</label>
                <input v-model="form.location" type="text" placeholder="如：客厅药箱第二层" />
              </div>
            </div>
            <label>剩余量 / 备注</label>
            <input v-model="form.stockText" type="text" placeholder="如：剩约半盒" />
            <label class="inline"><input type="checkbox" v-model="form.active" /> 仍在使用（取消勾选表示已停用/备用，仅做库存与梳理）</label>

            <div class="row-btns">
              <button v-if="editId" class="btn small danger-text" @click="deleteMed">删除</button>
              <span class="spacer"></span>
              <button class="btn small" @click="editing = false">取消</button>
              <button class="btn primary small" @click="saveMed">保存</button>
            </div>
          </div>
        </section>

        <!-- 安全梳理 -->
        <section v-else-if="tab === 'safety'">
          <header class="board-head">
            <h1>用药安全梳理</h1>
            <p class="muted tiny">过期/临期 + 成分重复 + 高风险组合的保守提示（规则 {{ RULE_VERSION }}）。</p>
          </header>
          <template v-if="canSafety">
            <div class="check-summary">
              <span class="chip err">风险 {{ counts.danger }}</span>
              <span class="chip warn">提醒 {{ counts.warn }}</span>
              <span class="chip info">提示 {{ counts.info }}</span>
            </div>
            <article v-if="findings.length === 0" class="card"><p class="tiny">暂未发现已知的过期、成分重复或高风险组合。未收录的成分与组合仍可能存在，用药请遵医嘱。</p></article>
            <article v-for="(f, i) in findings" :key="i" :class="['card finding', `f-${f.level}`]">
              <div class="due-top"><strong>{{ f.title }}</strong><span class="tag" :class="`t-${f.level}`">{{ levelChip[f.level] }}</span></div>
              <p class="tiny msg">{{ f.detail }}</p>
              <p v-if="f.advice" class="tiny msg advice">{{ f.advice }}</p>
              <p v-if="f.source" class="muted tiny src">来源：{{ f.source }}</p>
            </article>
            <button class="btn block" @click="exportReview">📋 导出季度理药梳理清单（.txt）</button>
          </template>
          <div v-else class="card upgrade-card">
            <div class="card-h">专业版功能</div>
            <p class="tiny">成分重复、高风险组合提示与季度理药梳理是专业版能力。药品有效期/开封倒计时在「药箱」中免费可见。</p>
            <button class="btn primary block" @click="upgrade">升级专业版 {{ billing.priceText(billing.plan.priceCents) }}</button>
          </div>
        </section>

        <!-- 就诊清单 -->
        <section v-else-if="tab === 'clinic'">
          <header class="board-head">
            <h1>就诊带药清单</h1>
            <p class="muted tiny">一键汇总在用药/保健品/中成药（通用名、剂量、频次、起止），就诊时出示给医生或药师。</p>
          </header>
          <template v-if="canPro">
            <pre class="card clinic-pre">{{ buildClinicText(currentMember, currentMeds, today) }}</pre>
            <button class="btn primary block" @click="exportClinic">⬇️ 下载/分享清单（.txt，可打印）</button>
            <button class="btn block" @click="exportBackup">🔐 加密导出本成员家庭用药档案</button>
            <p class="muted tiny center">加密档案用口令 AES-GCM 加密、只存本机，忘记口令无法恢复；清理浏览器数据前请先备份。</p>
          </template>
          <div v-else class="card upgrade-card">
            <div class="card-h">专业版功能</div>
            <p class="tiny">就诊带药清单导出/打印与加密家庭用药档案是专业版能力。</p>
            <button class="btn primary block" @click="upgrade">升级专业版 {{ billing.priceText(billing.plan.priceCents) }}</button>
          </div>
        </section>

        <!-- 说明 -->
        <section v-else>
          <div class="card about">
            <div class="card-h">使用与合规说明</div>
            <p class="tiny">① 添加家庭成员后录入药品：填写包装有效期、开封日期（滴眼液开封后默认 4 周）与服药时段，系统按更早的日期做停用倒计时。</p>
            <p class="tiny">② 「安全梳理」只收录少数说明书层面、公开科普中长期稳定的常见风险，例如多种复方感冒药同含<b>对乙酰氨基酚</b>、抗凝/抗血小板药与布洛芬等非甾体抗炎药同用可能增加出血风险；命中一律提示<b>请咨询医生或药师</b>。</p>
            <p class="tiny">③ 未勾选已知成分的药品不参与成分判断，以避免凭空误报；规则宁少勿错、可溯源（{{ RULE_VERSION }}），不代表覆盖全部药物相互作用。</p>
            <p class="tiny">④ 手机后台可能杀掉通知，建议导出 .ics 导入系统日历获得可靠提醒；漏服是否补服请以说明书或医嘱为准，切勿自行加倍。</p>
            <p class="tiny">⑤ 所有数据只存在本机 IndexedDB，清理浏览器数据会丢失，专业版可加密导出换机。</p>
            <p class="tiny"><b>本工具只做记录、提醒与说明书层面的已知规则提示，不诊断、不开药、不调整处方，不替代医生/药师的个体化判断；如出现不适或疑似不良反应，请及时就医。</b></p>
            <button class="btn small" @click="deleteMember(currentMember!)">删除该成员及其药品</button>
          </div>
        </section>
      </template>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.hm-app {
  --brand: #2f7a55;
  --brand-d: #246044;
  --ink: #20281f;
  --muted: #7c857a;
  --line: #e3e9e2;
  --bg: #f6f9f5;
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
.member-bar {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.2rem 0 0.5rem;
}
.mem-chip {
  flex: 0 0 auto;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  font-size: 0.95rem;
  color: var(--ink);
  cursor: pointer;
}
.mem-chip.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
  font-weight: 700;
}
.mem-chip.add {
  border-style: dashed;
  color: var(--brand-d);
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
  font-size: 0.85rem;
  white-space: nowrap;
  color: var(--ink);
  cursor: pointer;
}
.seg button.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.board-head h1 {
  margin: 0.5rem 0 0.2rem;
  font-size: 1.25rem;
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 0.8rem;
  line-height: 1.6;
}
.center {
  text-align: center;
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.85rem;
  padding: 0.85rem 0.95rem;
  margin-top: 0.7rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.4rem;
}
.disc-card {
  border-color: #cfe3d6;
  background: #f1f8f3;
}
.btn {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 0.6rem;
  padding: 0.6rem 0.85rem;
  font-size: 0.92rem;
  cursor: pointer;
  color: var(--ink);
}
.btn.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.btn.small {
  padding: 0.4rem 0.7rem;
  font-size: 0.82rem;
}
.btn.big {
  padding: 0.72rem 1rem;
  font-size: 1rem;
}
.btn.block {
  width: 100%;
  margin-top: 0.7rem;
}
.danger-text {
  color: #b04a3a;
  background: none;
  border-color: #e3c3bd;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
label {
  display: block;
  font-size: 0.84rem;
  margin: 0.55rem 0 0.22rem;
  color: #43503f;
}
label.inline {
  margin: 0.7rem 0;
}
input[type='text'],
input[type='number'],
input[type='date'],
select {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 0.55rem;
  font-size: 1rem;
  background: #fff;
}
.row-btns {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.row-btns .spacer {
  flex: 1;
}
.slot-pick,
.ing-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.3rem;
}
.slot-btn,
.ing-btn {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 999px;
  padding: 0.4rem 0.75rem;
  font-size: 0.82rem;
  cursor: pointer;
  color: var(--ink);
}
.ing-btn {
  border-radius: 0.6rem;
  text-align: left;
}
.slot-btn.on,
.ing-btn.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.empty {
  text-align: center;
  padding: 2.2rem 1rem;
  color: var(--muted);
}
.empty-emoji {
  font-size: 2.6rem;
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
.slot-name {
  font-size: 1.02rem;
}
.plan-item {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: 0.55rem;
}
.plan-item .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  margin-top: 0.42rem;
  flex: 0 0 auto;
}
.exp-badge {
  font-size: 0.74rem;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  white-space: nowrap;
}
.e-expired {
  background: #fdecea;
  color: #c0392b;
}
.e-near {
  background: #fff4dd;
  color: #b07409;
}
.e-ok,
.e-none {
  background: #eef3ec;
  color: #3d7a55;
}
.check-summary {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.7rem;
}
.chip {
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  font-size: 0.82rem;
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
.f-danger {
  border-left-color: #d0564a;
}
.f-warn {
  border-left-color: #e0a52f;
}
.f-info {
  border-left-color: #7ba78c;
}
.finding .msg {
  margin: 0.35rem 0 0;
}
.finding .advice {
  color: #5a3b12;
}
.finding .src {
  margin-top: 0.35rem;
}
.tag {
  border-radius: 999px;
  padding: 0.12rem 0.55rem;
  font-size: 0.76rem;
}
.t-danger {
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
.upgrade-card {
  border-color: #bcdcc9;
  background: #f1f8f3;
}
.clinic-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.82rem;
  line-height: 1.65;
  margin: 0;
}
.form-card {
  border-color: var(--brand);
  box-shadow: 0 6px 24px rgba(47, 122, 85, 0.12);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 5.2rem;
  transform: translateX(-50%);
  background: rgba(32, 40, 31, 0.93);
  color: #fff;
  padding: 0.55rem 0.95rem;
  border-radius: 999px;
  font-size: 0.86rem;
  z-index: 60;
  max-width: 88vw;
  text-align: center;
}
</style>
