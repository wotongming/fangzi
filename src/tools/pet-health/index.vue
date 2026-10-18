<script setup lang="ts">
/**
 * 宠物健康档案与就医管家 —— 全部数据只存本地 IndexedDB。
 * 边界：只记录 / 提醒 / 整理，不诊断、不荐药、不承诺疗效；药价为本人自录。
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { manifest } from './manifest'
import {
  EVENT_META,
  GENDER_LABELS,
  PLAN_TEMPLATES,
  SPECIES_LABELS,
  createId,
  fmtYuan,
  today,
  yuanToCents,
  type CarePlan,
  type EventKind,
  type Gender,
  type HealthEvent,
  type Pet,
  type PhotoRecord,
  type Species
} from './lib/models'
import { createPetWithPlans, deletePetCascade, getAll, put, remove } from './lib/store'
import { allDues, duesForPet, type DueItem } from './lib/schedule'
import { petTimeline, weightDeltas, weightSeries } from './lib/timeline'
import { costByCategory, medPriceCompare } from './lib/cost'
import { buildSummary } from './lib/summary'
import { buildPhoto, estimateStorage, formatBytes, totalPhotoBytes, usedRatio } from './lib/photos'
import { buildIcs, downloadIcs, ensureNotifyPermission, notifyDueSoon } from './lib/notify'
import { downloadPackage, importPackage } from './lib/backup'

useSeo({
  title: '宠物健康档案与就医管家 - 疫苗驱虫提醒/体重曲线/病情摘要/自记药价',
  description:
    '多宠健康时间线、疫苗与驱虫提醒、体重曲线、给兽医的病情时间线摘要、自记药价对照与家庭档案包，化验单处方照片本地保存，全程不上传，不诊断不荐药。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canMulti = computed(() => billing.canUse('multi').allowed)
const canAnalysis = computed(() => billing.canUse('analysis').allowed)
const canSummary = computed(() => billing.canUse('summary').allowed)
const canExport = computed(() => billing.canUse('export').allowed)
const priceText = computed(() => billing.priceText(billing.plan.priceCents))
async function upgrade() {
  await billing.buy('freemium-pro')
}

// —— 数据 ——
const pets = ref<Pet[]>([])
const events = ref<HealthEvent[]>([])
const photos = ref<PhotoRecord[]>([])
const plans = ref<CarePlan[]>([])
const loaded = ref(false)
const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2600)
}

// 图片对象 URL 缓存
  const urlMap = new Map<string, string>()
function photoUrl(id?: string): string {
  if (!id) return ''
  const hit = urlMap.get(id)
  if (hit) return hit
  const p = photos.value.find((x) => x.id === id)
  if (!p) return ''
  const url = URL.createObjectURL(p.blob)
  urlMap.set(id, url)
  return url
}
function revokePhoto(id: string) {
  const u = urlMap.get(id)
  if (u) {
    URL.revokeObjectURL(u)
    urlMap.delete(id)
  }
}
onUnmounted(() => urlMap.forEach((u) => URL.revokeObjectURL(u)))

async function reload() {
  const [ps, es, phs, pls] = await Promise.all([
    getAll<Pet>('pets'),
    getAll<HealthEvent>('events'),
    getAll<PhotoRecord>('photos'),
    getAll<CarePlan>('plans')
  ])
  pets.value = ps.sort((a, b) => a.createdAt - b.createdAt)
  events.value = es
  photos.value = phs
  plans.value = pls
  if (!currentPetId.value && ps[0]) currentPetId.value = ps[0].id
  loaded.value = true
}
onMounted(reload)

const currentPetId = ref<string>('')
const currentPet = computed(() => pets.value.find((p) => p.id === currentPetId.value) ?? null)

const tab = ref<'board' | 'timeline' | 'add' | 'care' | 'me'>('board')
function switchTab(t: typeof tab.value) {
  tab.value = t
}
function selectPet(id: string) {
  currentPetId.value = id
}

// —— 待办 ——
const allDue = computed(() => allDues(plans.value, events.value))
const petDues = computed<DueItem[]>(() => (currentPet.value ? duesForPet(plans.value, events.value, currentPet.value.id) : []))
const petName = (pid: string) => pets.value.find((p) => p.id === pid)?.name ?? '宠物'

const dueBadge = computed(() => allDue.value.filter((d) => d.overdue || d.today).length)

async function markDone(d: DueItem) {
  if (!currentPet.value) return
  const tpl = PLAN_TEMPLATES.find((t) => t.key === d.plan.planKey)
  const ev: HealthEvent = {
    id: createId('ev'),
    petId: d.plan.petId,
    kind: tpl?.kind ?? 'other',
    date: today(),
    name: tpl?.label ?? d.plan.planKey,
    planKey: d.plan.planKey,
    photoIds: [],
    createdAt: Date.now()
  }
  await put('events', ev)
  await reload()
  notify('已记录完成 ✓')
}

async function togglePlan(plan: CarePlan) {
  await put('plans', { ...plan, enabled: !plan.enabled })
  await reload()
}

async function updateInterval(plan: CarePlan, days: number) {
  if (!Number.isFinite(days) || days < 1) {
    notify('周期需为大于 0 的天数')
    return
  }
  await put('plans', { ...plan, intervalDays: Math.round(days) })
  await reload()
  notify('照护周期已更新')
}

async function exportCalendar() {
  const dues = allDue.value
  if (!dues.length) {
    notify('暂未启用照护计划')
    return
  }
  downloadIcs(buildIcs(dues, petName))
  notify('已导出日历文件，打开即可导入系统日历')
}
async function enableNotifications() {
  const ok = await ensureNotifyPermission()
  notify(ok ? '已开启通知（仅应用打开期间有效，长期提醒请导出日历）' : '未获得通知权限，可用导出日历兜底')
  if (ok) notifyDueSoon(allDue.value, petName)
}

// —— 时间线 / 体重 / 费用 ——
const timeline = computed(() => (currentPet.value ? petTimeline(events.value, currentPet.value.id) : []))
const petPlans = computed(() => (currentPet.value ? plans.value.filter((p) => p.petId === currentPet.value!.id) : []))
const weights = computed(() => (currentPet.value ? weightSeries(events.value, currentPet.value.id) : []))
const weightChange = computed(() => {
  const d = weightDeltas(weights.value)
  return d.length ? d[d.length - 1]! : null
})
const costYear = ref<number>(new Date().getFullYear())
const cost = computed(() => (currentPet.value ? costByCategory(events.value, currentPet.value.id, costYear.value) : { items: [], totalCents: 0 }))
const medGroups = computed(() => (currentPet.value ? medPriceCompare(events.value, currentPet.value.id) : []))

const years = computed(() => {
  const ys = new Set<number>()
  for (const e of events.value) ys.add(Number(e.date.slice(0, 4)))
  return [...ys].sort((a, b) => b - a)
})

// —— 记一笔 ——
const costKinds = new Set<EventKind>(['med', 'visit', 'diet', 'medprice'])
const form = reactive({
  kind: 'visit' as EventKind,
  date: today(),
  name: '',
  note: '',
  hospital: '',
  doctor: '',
  amount: '',
  valueKg: '',
  spec: '',
  planKey: ''
})
const pendingPhotos = ref<{ id: string; url: string }[]>([])

function resetForm(kind: EventKind = 'visit') {
  form.kind = kind
  form.date = today()
  form.name = ''
  form.note = ''
  form.hospital = ''
  form.doctor = ''
  form.amount = ''
  form.valueKg = ''
  form.spec = ''
  form.planKey = ''
  for (const p of pendingPhotos.value) URL.revokeObjectURL(p.url)
  pendingPhotos.value = []
}

async function onPickPhotos(files: FileList | null) {
  if (!files || !currentPet.value) return
  for (const file of Array.from(files)) {
    try {
      const rec = await buildPhoto(file, currentPet.value.id)
      photos.value.push(rec)
      await put('photos', rec)
      pendingPhotos.value.push({ id: rec.id, url: photoUrl(rec.id) })
    } catch {
      notify('有图片处理失败，已跳过')
    }
  }
}

async function saveEvent() {
  if (!currentPet.value) return
  if (!form.name.trim()) {
    if (form.kind === 'weight') form.name = '体重记录'
    else {
      notify('请填写名称（如疫苗名/药品/症状）')
      return
    }
  }
  let valueKg: number | undefined
  if (form.kind === 'weight') {
    const v = Number(form.valueKg)
    if (!isFinite(v) || v <= 0) {
      notify('请输入正确的体重 kg')
      return
    }
    valueKg = +v.toFixed(2)
  }
  let amountCents: number | undefined
  if (costKinds.has(form.kind)) {
    // type=number 的 v-model 可能自动转型为 number，统一按字符串解析
    const amountText = form.amount === null || form.amount === undefined ? '' : String(form.amount)
    const c = yuanToCents(amountText)
    if (amountText.trim() && c === undefined) {
      notify('请输入正确的金额')
      return
    }
    amountCents = c
  }
  const ev: HealthEvent = {
    id: createId('ev'),
    petId: currentPet.value.id,
    kind: form.kind,
    date: form.date || today(),
    name: form.name.trim(),
    note: form.note.trim() || undefined,
    hospital: form.hospital.trim() || undefined,
    doctor: form.doctor.trim() || undefined,
    amountCents,
    valueKg,
    spec: form.spec.trim() || undefined,
    planKey: form.planKey || undefined,
    photoIds: pendingPhotos.value.map((p) => p.id),
    createdAt: Date.now()
  }
  await put('events', ev)
  await reload()
  resetForm(form.kind)
  notify('已保存到健康时间线 ✓')
}

async function deleteEvent(ev: HealthEvent) {
  if (!confirm('删除这条记录？其关联照片不会自动删除，可在档案中清理。')) return
  await remove('events', ev.id)
  await reload()
}

const kindOptions = Object.entries(EVENT_META).map(([k, v]) => ({ key: k as EventKind, label: `${v.emoji} ${v.label}` }))

// —— 宠物资料 ——
const showPetForm = ref(false)
const editingPet = ref<Pet | null>(null)
const petForm = reactive({ name: '', species: 'cat' as Species, breed: '', gender: 'unknown' as Gender, birthday: '', neutered: false, chip: '', allergies: '', chronic: '' })

function openAddPet() {
  // 免费层只允许 1 只
  if (pets.value.length >= 1 && !canMulti.value) {
    showUpgrade.value = true
    return
  }
  editingPet.value = null
  Object.assign(petForm, { name: '', species: 'cat', breed: '', gender: 'unknown', birthday: '', neutered: false, chip: '', allergies: '', chronic: '' })
  showPetForm.value = true
}
function openEditPet() {
  if (!currentPet.value) return
  editingPet.value = currentPet.value
  Object.assign(petForm, {
    name: currentPet.value.name,
    species: currentPet.value.species,
    breed: currentPet.value.breed ?? '',
    gender: currentPet.value.gender,
    birthday: currentPet.value.birthday ?? '',
    neutered: !!currentPet.value.neutered,
    chip: currentPet.value.chip ?? '',
    allergies: currentPet.value.allergies ?? '',
    chronic: currentPet.value.chronic ?? ''
  })
  showPetForm.value = true
}
async function savePetForm() {
  if (!petForm.name.trim()) {
    notify('请填写宠物名字')
    return
  }
  if (editingPet.value) {
    await put('pets', { ...editingPet.value, ...petForm, name: petForm.name.trim(), breed: petForm.breed || undefined, birthday: petForm.birthday || undefined, chip: petForm.chip || undefined, allergies: petForm.allergies || undefined, chronic: petForm.chronic || undefined })
  } else {
    await createPetWithPlans({ ...petForm, name: petForm.name.trim(), breed: petForm.breed || undefined, birthday: petForm.birthday || undefined, chip: petForm.chip || undefined, allergies: petForm.allergies || undefined, chronic: petForm.chronic || undefined })
  }
  showPetForm.value = false
  await reload()
  notify('宠物资料已保存 ✓')
}
async function removePet() {
  if (!currentPet.value) return
  if (!confirm(`删除「${currentPet.value.name}」将同时删除其全部记录与照片，且不可恢复，确定？`)) return
  const id = currentPet.value.id
  for (const ph of photos.value.filter((p) => p.petId === id)) revokePhoto(ph.id)
  await deletePetCascade(id)
  currentPetId.value = ''
  await reload()
}

// —— 病情摘要 ——
const showSummary = ref(false)
const summaryRange = reactive({ start: '', end: '' })
const summaryText = computed(() =>
  currentPet.value ? buildSummary(currentPet.value, events.value, { start: summaryRange.start || undefined, end: summaryRange.end || undefined }) : ''
)
async function copySummary() {
  try {
    await navigator.clipboard.writeText(summaryText.value)
    notify('摘要已复制，可粘贴给兽医 ✓')
  } catch {
    notify('复制失败，请长按文本手动选择复制')
  }
}
function openSummary() {
  if (!canSummary.value) {
    showUpgrade.value = true
    return
  }
  summaryRange.start = ''
  summaryRange.end = ''
  showSummary.value = true
}

// —— 升级 / 档案 ——
const showUpgrade = ref(false)

const storage = ref<{ used: string; ratio: number | null; photos: string }>({ used: '-', ratio: null, photos: '-' })
async function refreshStorage() {
  const est = await estimateStorage()
  const ratio = usedRatio(est)
  storage.value = {
    used: est.usage !== undefined ? formatBytes(est.usage) : '-',
    ratio,
    photos: formatBytes(totalPhotoBytes(photos.value))
  }
}
async function doExport(withPass: boolean) {
  if (!canExport.value) {
    showUpgrade.value = true
    return
  }
  const pass = withPass ? prompt('设置一个口令（用于加密档案包，忘记无法恢复）：') ?? '' : ''
  if (withPass && !pass) return
  await downloadPackage(pass || undefined)
  notify('档案包已导出 ✓')
}
async function onImportFile(file: File | null) {
  if (!file) return
  if (!canExport.value) {
    showUpgrade.value = true
    return
  }
  try {
    // 先尝试无口令；若为加密包则询问口令（最多让用户重试由其再次选择文件）
    const r = await importPackage(file).catch(async (e: Error) => {
      if (/加密/.test(e.message)) {
        const pass = prompt('该档案包已加密，请输入口令：')
        if (!pass) throw new Error('已取消导入')
        return importPackage(file, pass)
      }
      throw e
    })
    await reload()
    notify(`导入完成：${r.pets} 只宠物 / ${r.events} 条记录 / ${r.photos} 张照片`)
  } catch (e) {
    notify((e as Error).message || '导入失败')
  }
}

// 体重曲线几何
const chart = computed(() => {
  const pts = weights.value
  if (pts.length < 2) return null
  const W = 320
  const H = 150
  const pad = 26
  const kgs = pts.map((p) => p.kg)
  const min = Math.min(...kgs)
  const max = Math.max(...kgs)
  const span = max - min || 1
  const stepX = (W - pad * 2) / Math.max(1, pts.length - 1)
  const xy = pts.map((p, i) => {
    const x = pad + i * stepX
    const y = H - pad - ((p.kg - min) / span) * (H - pad * 2)
    return { x, y, ...p }
  })
  return { W, H, pad, points: xy, line: xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), min, max }
})

onMounted(() => {
  void refreshStorage()
})
</script>

<template>
  <div class="pet-app">
    <!-- 空状态 -->
    <section v-if="loaded && pets.length === 0" class="empty">
      <div class="empty-emoji">🐾</div>
      <h2>给毛孩子建一份本地健康档案</h2>
      <p>疫苗驱虫提醒、就诊时间线、化验单照片、体重与花费，全部只存在这台设备，不上传。</p>
      <button class="btn primary big" @click="openAddPet">建立第一只宠物档案</button>
      <p class="medical">本工具只做记录与提醒，不能替代执业兽医；宠物异常请及时就医。</p>
    </section>

    <template v-else-if="currentPet">
      <div class="apphead">
        <div class="pets-scroll">
          <button
            v-for="p in pets"
            :key="p.id"
            class="pet-chip"
            :class="{ active: p.id === currentPetId }"
            @click="selectPet(p.id)"
          >
            <img v-if="p.avatarPhotoId && photoUrl(p.avatarPhotoId)" :src="photoUrl(p.avatarPhotoId)" class="pet-ava" alt="" />
            <span v-else class="pet-ava pet-ava-ph">{{ p.species === 'cat' ? '🐱' : p.species === 'dog' ? '🐶' : '🐾' }}</span>
            <span>{{ p.name }}</span>
          </button>
          <button class="pet-chip add" @click="openAddPet">＋ 新增</button>
        </div>
        <nav class="seg" aria-label="功能导航">
          <button :class="{ on: tab === 'board' }" @click="switchTab('board')">🏠 待办<i v-if="dueBadge" class="seg-badge">{{ dueBadge }}</i></button>
          <button :class="{ on: tab === 'timeline' }" @click="switchTab('timeline')">📖 时间线</button>
          <button class="seg-add" :class="{ on: tab === 'add' }" @click="switchTab('add')">➕ 记一笔</button>
          <button :class="{ on: tab === 'care' }" @click="switchTab('care')">🩺 就医</button>
          <button :class="{ on: tab === 'me' }" @click="switchTab('me')">⚙️ 我的</button>
        </nav>
      </div>
      <!-- 待办 -->
      <section v-if="tab === 'board'" class="page">
        <h1 class="pet-title">
          {{ currentPet.name }}
          <small>{{ SPECIES_LABELS[currentPet.species] }}{{ currentPet.breed ? ' · ' + currentPet.breed : '' }} · {{ GENDER_LABELS[currentPet.gender] }}{{ currentPet.neutered ? ' · 已绝育' : '' }}</small>
        </h1>

        <div class="card">
          <div class="card-h">📌 照护待办 <span class="muted">（打开即更新）</span></div>
          <p v-if="petDues.length === 0" class="muted">暂未启用照护计划，可在「我的 → 照护计划」里开启。</p>
          <ul class="due-list">
            <li v-for="d in petDues" :key="d.plan.id" class="due-item" :class="{ overdue: d.overdue, today: d.today }">
              <div class="due-main">
                <strong>{{ PLAN_TEMPLATES.find((t) => t.key === d.plan.planKey)?.label || d.plan.planKey }}</strong>
                <span class="due-date">{{ d.dueDate }} ·
                  <template v-if="d.overdue">已逾期 {{ -d.daysLeft }} 天</template>
                  <template v-else-if="d.today">今天到期</template>
                  <template v-else>还有 {{ d.daysLeft }} 天</template>
                </span>
                <span class="muted tiny">依据：{{ d.basis }}</span>
              </div>
              <div class="due-ops">
                <button class="btn small primary" @click="markDone(d)">已做</button>
                <button class="btn small ghost" @click="togglePlan(d.plan)">{{ d.plan.enabled ? '停用' : '启用' }}</button>
              </div>
            </li>
          </ul>
          <div class="row-ops">
            <button class="btn small ghost" @click="enableNotifications">开启通知</button>
            <button class="btn small ghost" @click="exportCalendar">导出到系统日历</button>
          </div>
          <p class="muted tiny">手机浏览器关闭后可能收不到后台通知，建议「导出到系统日历」获得长期可靠提醒。</p>
        </div>

        <div class="card hint-card">
          <div class="card-h">🩺 就诊防坑小工具</div>
          <button class="btn block" @click="switchTab('care')">生成给兽医的病情摘要 / 查看花费与自记药价</button>
        </div>
        <p class="medical">本工具不做疾病诊断、不推荐用药；以下记录供你和兽医参考。</p>
      </section>

      <!-- 时间线 -->
      <section v-else-if="tab === 'timeline'" class="page">
        <h1 class="page-h">健康时间线</h1>
        <p v-if="timeline.length === 0" class="muted">还没有记录，点底部「记一笔」开始。</p>
        <ul class="timeline">
          <li v-for="e in timeline" :key="e.id" class="t-item">
            <div class="t-head">
              <span class="t-kind">{{ EVENT_META[e.kind].emoji }} {{ EVENT_META[e.kind].label }}</span>
              <span class="muted">{{ e.date }}</span>
            </div>
            <div class="t-name">{{ e.name }}<span v-if="typeof e.valueKg === 'number'" class="tag"> {{ e.valueKg }}kg</span><span v-if="typeof e.amountCents === 'number'" class="tag"> {{ fmtYuan(e.amountCents) }}</span></div>
            <div v-if="e.hospital || e.doctor" class="muted tiny">{{ e.hospital }}<span v-if="e.doctor"> · {{ e.doctor }}</span></div>
            <div v-if="e.note" class="t-note">{{ e.note }}</div>
            <div v-if="e.photoIds.length" class="t-photos">
              <a v-for="pid in e.photoIds" :key="pid" :href="photoUrl(pid)" target="_blank" rel="noopener">
                <img :src="photoUrl(pid)" alt="单据照片" loading="lazy" />
              </a>
            </div>
            <button class="btn tiny ghost del" @click="deleteEvent(e)">删除</button>
          </li>
        </ul>
      </section>

      <!-- 记一笔 -->
      <section v-else-if="tab === 'add'" class="page">
        <h1 class="page-h">快速记一笔</h1>
        <div class="card form">
          <label>类型</label>
          <select v-model="form.kind">
            <option v-for="o in kindOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
          </select>

          <label>日期</label>
          <input type="date" v-model="form.date" />

          <label>{{ form.kind === 'weight' ? '说明（可留空）' : '名称（疫苗/药品/症状/医院…）' }}</label>
          <input type="text" v-model="form.name" :placeholder="form.kind === 'vaccine' ? '如 猫三联' : form.kind === 'symptom' ? '如 呕吐、精神差' : '名称'" />

          <div v-if="form.kind === 'weight'" class="grid2">
            <div>
              <label>体重 kg</label>
              <input type="number" inputmode="decimal" step="0.01" min="0" v-model="form.valueKg" placeholder="如 4.2" />
            </div>
          </div>

          <template v-if="form.kind === 'vaccine' || form.kind === 'deworm'">
            <label>关联照护计划（用于自动推算下次，可选）</label>
            <select v-model="form.planKey">
              <option value="">不关联</option>
              <option v-for="t in PLAN_TEMPLATES" :key="t.key" :value="t.key">{{ t.label }}</option>
            </select>
          </template>

          <template v-if="form.kind === 'visit' || form.kind === 'med' || form.kind === 'medprice'">
            <div class="grid2">
              <div><label>医院</label><input type="text" v-model="form.hospital" placeholder="宠物医院" /></div>
              <div><label>医生</label><input type="text" v-model="form.doctor" placeholder="接诊医生（可选）" /></div>
            </div>
          </template>

          <div v-if="form.kind === 'medprice'" class="grid2">
            <div><label>药品规格</label><input type="text" v-model="form.spec" placeholder="如 50mg*6片" /></div>
            <div><label>本次价格（元）</label><input type="number" inputmode="decimal" step="0.01" min="0" v-model="form.amount" placeholder="0.00" /></div>
          </div>
          <div v-else-if="['med','visit','diet'].includes(form.kind)" class="grid2">
            <div><label>花费（元，可选）</label><input type="number" inputmode="decimal" step="0.01" min="0" v-model="form.amount" placeholder="0.00" /></div>
          </div>

          <label>详情 / 备注（剂量、症状描述、医嘱…）</label>
          <textarea rows="3" v-model="form.note" placeholder="不做自我诊断，客观记录现象与医嘱即可"></textarea>

          <label>单据 / 化验单 / 处方照片（自动压缩，仅存本机）</label>
          <input type="file" accept="image/*" multiple capture="environment" @change="onPickPhotos(($event.target as HTMLInputElement).files)" />
          <div v-if="pendingPhotos.length" class="t-photos">
            <img v-for="p in pendingPhotos" :key="p.id" :src="p.url" alt="待保存照片" />
          </div>

          <button class="btn primary big block" @click="saveEvent">保存记录</button>
          <p class="muted tiny">记录「药价」时请如实填写本人实付价格，系统只做你自己的价格对照，不提供市场报价。</p>
        </div>
      </section>

      <!-- 就医助手：摘要 / 体重 / 费用 / 药价 -->
      <section v-else-if="tab === 'care'" class="page">
        <h1 class="page-h">就医助手</h1>

        <div class="card">
          <div class="card-h">📋 病情时间线摘要</div>
          <p class="muted tiny">按时间整理症状、就诊、用药、既往史与过敏，一键复制给兽医。</p>
          <button class="btn primary block" @click="openSummary">{{ canSummary ? '生成病情摘要' : '病情摘要（专业版）' }}</button>
        </div>

        <div class="card">
          <div class="card-h">⚖️ 体重曲线</div>
          <template v-if="canAnalysis">
            <p v-if="!chart" class="muted">至少记录 2 次体重后生成曲线。</p>
            <svg v-else :viewBox="`0 0 ${chart.W} ${chart.H}`" class="chart" role="img" aria-label="体重曲线">
              <polyline :points="chart.line" fill="none" stroke="#2e9e6b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
              <circle v-for="p in chart.points" :key="p.date" :cx="p.x" :cy="p.y" r="3.2" fill="#2e9e6b">
                <title>{{ p.date }}：{{ p.kg }}kg</title>
              </circle>
            </svg>
            <div class="muted tiny">范围 {{ chart?.min }}–{{ chart?.max }}kg<template v-if="weightChange">；最近一次 {{ weightChange.deltaKg > 0 ? '+' : '' }}{{ weightChange.deltaKg }}kg（{{ weightChange.pct > 0 ? '+' : '' }}{{ weightChange.pct }}%）</template>。体重短期内明显波动请咨询兽医，本曲线不用于诊断。</div>
          </template>
          <button v-else class="btn block" @click="showUpgrade = true">体重曲线与分析（专业版）</button>
        </div>

        <div class="card">
          <div class="card-h">💰 年度养宠花费</div>
          <template v-if="canAnalysis">
            <select v-model.number="costYear">
              <option v-for="y in years.length ? years : [new Date().getFullYear()]" :key="y" :value="y">{{ y }} 年</option>
            </select>
            <p v-if="cost.items.length === 0" class="muted">该年暂无花费记录。</p>
            <ul class="cost-list">
              <li v-for="c in cost.items" :key="c.kind"><span>{{ c.label }} ×{{ c.count }}</span><strong>{{ fmtYuan(c.cents) }}</strong></li>
            </ul>
            <div v-if="cost.items.length" class="cost-total">合计 <strong>{{ fmtYuan(cost.totalCents) }}</strong></div>
          </template>
          <button v-else class="btn block" @click="showUpgrade = true">花费分析（专业版）</button>
        </div>

        <div class="card">
          <div class="card-h">🏷️ 自记药价对照</div>
          <p class="muted tiny">以下均为你本人在不同医院/时间的实付记录，仅供换院参考，<strong>不是市场价</strong>。</p>
          <template v-if="canAnalysis">
            <p v-if="medGroups.length === 0" class="muted">在「记一笔 → 药价」里记录同一药品的不同购买价后，这里自动对照。</p>
            <div v-for="g in medGroups" :key="g.key" class="med-group">
              <div class="med-name">{{ g.name }}</div>
              <div v-for="r in g.rows" :key="r.date + r.hospital" class="med-row">
                <span>{{ r.date }}{{ r.hospital ? ' · ' + r.hospital : '' }}{{ r.spec ? ' · ' + r.spec : '' }}</span>
                <strong>{{ fmtYuan(r.cents) }}</strong>
              </div>
              <div v-if="g.rows.length > 1 && g.spreadCents > 0" class="med-spread">自录最大相差 {{ fmtYuan(g.spreadCents) }}</div>
            </div>
          </template>
          <button v-else class="btn block" @click="showUpgrade = true">药价对照分析（专业版）</button>
        </div>
        <p class="medical">本工具只整理你自己的记录，不诊断、不荐药；急症请立即就医。</p>
      </section>

      <!-- 我的 -->
      <section v-else-if="tab === 'me'" class="page">
        <h1 class="page-h">我的</h1>
        <div class="card">
          <div class="card-h">🐾 宠物资料</div>
          <button class="btn block" @click="openEditPet">编辑「{{ currentPet.name }}」资料</button>
          <button class="btn block danger-text" @click="removePet">删除该宠物及其全部记录</button>
        </div>

        <div class="card">
          <div class="card-h">🗓️ 照护计划</div>
          <ul class="plan-list">
            <li v-for="pl in petPlans" :key="pl.id" class="plan-item">
              <div>
                <strong>{{ PLAN_TEMPLATES.find((t) => t.key === pl.planKey)?.label || pl.planKey }}</strong>
                <div class="muted tiny">{{ PLAN_TEMPLATES.find((t) => t.key === pl.planKey)?.hint }}</div>
                <label class="inline">周期
                  <input type="number" min="1" :value="pl.intervalDays" @change="updateInterval(pl, Number(($event.target as HTMLInputElement).value))" style="width:5rem" /> 天
                </label>
              </div>
              <button class="btn small ghost" @click="togglePlan(pl)">{{ pl.enabled ? '停用' : '启用' }}</button>
            </li>
          </ul>
        </div>

        <div class="card">
          <div class="card-h">💾 家庭档案包</div>
          <p class="muted tiny">导出含照片的完整档案用于备份 / 换机 / 家人协作；可加口令加密。</p>
          <div class="row-ops">
            <button class="btn" @click="doExport(false)">导出</button>
            <button class="btn" @click="doExport(true)">加密导出</button>
          </div>
          <label class="btn block file-btn">
            导入档案包
            <input type="file" accept="application/json,.json" class="hidden-file" @change="onImportFile(($event.target as HTMLInputElement).files?.[0] ?? null)" />
          </label>
          <button class="btn block ghost" @click="refreshStorage">刷新存储占用</button>
          <p class="muted tiny">本机照片约占 {{ storage.photos }}<template v-if="storage.ratio !== null">；浏览器存储已用 {{ (storage.ratio * 100).toFixed(1) }}%</template>。清理浏览器数据会丢失档案，请定期导出。</p>
        </div>

        <div class="card upgrade-card" v-if="!canMulti || !canAnalysis || !canSummary || !canExport">
          <div class="card-h">✨ 专业版</div>
          <p class="muted tiny">多宠档案、体重与花费分析、病情摘要、家庭档案包，一次买断 {{ priceText }}（也可订阅）。数据仍只存本机。</p>
          <button class="btn primary block" @click="upgrade">升级专业版</button>
        </div>
        <p class="medical">仅健康记录与提醒，不能替代执业兽医。</p>
      </section>
    </template>

      <!-- 宠物表单弹层 -->
    <div v-if="showPetForm" class="modal-mask" @click.self="showPetForm = false">
      <div class="modal">
        <h3>{{ editingPet ? '编辑宠物资料' : '新建宠物档案' }}</h3>
        <label>名字</label><input type="text" v-model="petForm.name" placeholder="如 豆豆" />
        <div class="grid2">
          <div><label>种类</label>
            <select v-model="petForm.species"><option value="cat">猫</option><option value="dog">狗</option><option value="other">其他</option></select>
          </div>
          <div><label>性别</label>
            <select v-model="petForm.gender"><option value="unknown">未知</option><option value="male">公</option><option value="female">母</option></select>
          </div>
        </div>
        <div class="grid2">
          <div><label>品种</label><input type="text" v-model="petForm.breed" placeholder="可选" /></div>
          <div><label>出生日期</label><input type="date" v-model="petForm.birthday" /></div>
        </div>
        <label class="inline"><input type="checkbox" v-model="petForm.neutered" /> 已绝育</label>
        <label>芯片号（可选）</label><input type="text" v-model="petForm.chip" />
        <label>过敏史（可选）</label><textarea rows="2" v-model="petForm.allergies" placeholder="如 对某药物/食物过敏"></textarea>
        <label>既往基础病（可选）</label><textarea rows="2" v-model="petForm.chronic" placeholder="如 慢性肾病等"></textarea>
        <div class="row-ops">
          <button class="btn" @click="showPetForm = false">取消</button>
          <button class="btn primary" @click="savePetForm">保存</button>
        </div>
      </div>
    </div>

    <!-- 病情摘要弹层 -->
    <div v-if="showSummary" class="modal-mask" @click.self="showSummary = false">
      <div class="modal wide">
        <h3>病情时间线摘要</h3>
        <div class="grid2">
          <div><label>开始日期</label><input type="date" v-model="summaryRange.start" /></div>
          <div><label>结束日期</label><input type="date" v-model="summaryRange.end" /></div>
        </div>
        <textarea rows="14" class="summary-box" :value="summaryText" readonly></textarea>
        <div class="row-ops">
          <button class="btn" @click="showSummary = false">关闭</button>
          <button class="btn primary" @click="copySummary">复制给兽医</button>
        </div>
      </div>
    </div>

    <!-- 升级弹层 -->
    <div v-if="showUpgrade" class="modal-mask" @click.self="showUpgrade = false">
      <div class="modal">
        <h3>专业版功能</h3>
        <ul class="feat">
          <li>多只宠物档案与切换</li>
          <li>体重曲线与年度花费分析</li>
          <li>一键生成给兽医的病情摘要</li>
          <li>家庭档案包导出 / 导入（含照片，可加密）</li>
        </ul>
        <p class="muted">一次买断 {{ priceText }}，所有数据仍只保存在你的设备。</p>
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
.pet-app {
  --brand: #2e9e6b;
  --brand-d: #237a52;
  --ink: #20241f;
  --muted: #8a908a;
  --line: #e7eae6;
  --bg: #f5f6f3;
  --card: #ffffff;
  min-height: 100%;
  background: var(--bg);
  color: var(--ink);
  padding-bottom: 0.5rem;
}
.apphead {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 0.5rem 0.75rem 0.45rem;
}
.pets-scroll {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.seg {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.3rem;
  margin-top: 0.5rem;
}
.seg button {
  position: relative;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 0.6rem;
  padding: 0.45rem 0.15rem;
  font-size: 0.8rem;
  color: #5c635c;
  white-space: nowrap;
}
.seg button.on {
  border-color: var(--brand);
  background: #eaf7f0;
  color: var(--brand-d);
  font-weight: 700;
}
.seg .seg-add.on {
  background: var(--brand);
  color: #fff;
}
.seg-badge {
  position: absolute;
  top: -0.3rem;
  right: 0.1rem;
  background: #e0675a;
  color: #fff;
  font-style: normal;
  font-size: 0.6rem;
  min-width: 0.95rem;
  height: 0.95rem;
  line-height: 0.95rem;
  border-radius: 999px;
  padding: 0 0.18rem;
}
/* 桌面端外壳已有吸顶品牌栏，工具头不再吸顶，避免双层重叠 */
@media (min-width: 821px) {
  .apphead {
    position: static;
    background: transparent;
    border-bottom: 0;
  }
}
.pet-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 0.3rem 0.75rem 0.3rem 0.35rem;
  font-size: 0.9rem;
  color: var(--ink);
}
.pet-chip.active {
  border-color: var(--brand);
  background: #eaf7f0;
  color: var(--brand-d);
  font-weight: 600;
}
.pet-chip.add {
  padding: 0.3rem 0.8rem;
  color: var(--brand-d);
}
.pet-ava {
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 50%;
  object-fit: cover;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #eef1ee;
  font-size: 1rem;
}
.page {
  padding: 0.85rem 0.85rem 1rem;
  max-width: 720px;
  margin: 0 auto;
}
.pet-title {
  font-size: 1.35rem;
  margin: 0.2rem 0 0.75rem;
}
.pet-title small {
  display: block;
  font-size: 0.82rem;
  font-weight: 400;
  color: var(--muted);
  margin-top: 0.15rem;
}
.page-h {
  font-size: 1.2rem;
  margin: 0.2rem 0 0.75rem;
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  padding: 0.9rem;
  margin-bottom: 0.8rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.55rem;
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 0.78rem;
}
.medical {
  color: #b06a2a;
  font-size: 0.78rem;
  text-align: center;
  margin: 0.6rem 0.2rem;
}
.hint-card .btn {
  margin-top: 0.3rem;
}
.due-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.due-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  padding: 0.6rem 0.7rem;
}
.due-item.overdue {
  border-color: #e0877a;
  background: #fdf1ef;
}
.due-item.today {
  border-color: #e4b84a;
  background: #fdf8ea;
}
.due-main {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.due-date {
  font-size: 0.85rem;
}
.overdue .due-date {
  color: #c2483a;
  font-weight: 600;
}
.due-ops {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}
.row-ops {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
  flex-wrap: wrap;
}
.btn {
  appearance: none;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--ink);
  border-radius: 0.6rem;
  padding: 0.5rem 0.85rem;
  font-size: 0.9rem;
  cursor: pointer;
}
.btn.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.btn.primary:active {
  background: var(--brand-d);
}
.btn.ghost {
  background: transparent;
}
.btn.small {
  padding: 0.32rem 0.6rem;
  font-size: 0.82rem;
}
.btn.tiny {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
}
.btn.big {
  padding: 0.7rem 1rem;
  font-size: 1rem;
}
.btn.block {
  width: 100%;
  margin-top: 0.5rem;
  text-align: center;
}
.danger-text {
  color: #c2483a;
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.t-item {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  padding: 0.7rem 0.8rem;
}
.t-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--muted);
}
.t-kind {
  color: var(--brand-d);
  font-weight: 600;
}
.t-name {
  font-weight: 600;
  margin: 0.2rem 0;
}
.tag {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 500;
  background: #eef3f0;
  color: var(--brand-d);
  border-radius: 0.4rem;
  padding: 0 0.4rem;
  margin-left: 0.3rem;
}
.t-note {
  font-size: 0.88rem;
  margin-top: 0.2rem;
  white-space: pre-wrap;
}
.t-photos {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}
.t-photos img {
  width: 4.5rem;
  height: 4.5rem;
  object-fit: cover;
  border-radius: 0.5rem;
  border: 1px solid var(--line);
}
.del {
  margin-top: 0.5rem;
  color: #c2483a;
}
.form label {
  display: block;
  font-size: 0.82rem;
  color: #555d55;
  margin: 0.6rem 0 0.25rem;
}
.form input,
.form select,
.form textarea,
.modal input,
.modal select,
.modal textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  font-size: 0.95rem;
  background: #fff;
  color: var(--ink);
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.inline {
  display: inline-flex !important;
  align-items: center;
  gap: 0.4rem;
  margin: 0.6rem 0;
}
.inline input[type='checkbox'] {
  width: auto;
}
.chart {
  width: 100%;
  height: auto;
  background: #fcfdfc;
  border: 1px solid var(--line);
  border-radius: 0.6rem;
}
.cost-list,
.plan-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
}
.cost-list li {
  display: flex;
  justify-content: space-between;
  padding: 0.35rem 0;
  border-bottom: 1px dashed var(--line);
}
.cost-total {
  text-align: right;
  margin-top: 0.5rem;
}
.med-group {
  border-top: 1px solid var(--line);
  padding: 0.5rem 0;
}
.med-name {
  font-weight: 600;
}
.med-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #444;
}
.med-spread {
  font-size: 0.78rem;
  color: #b06a2a;
}
.plan-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  border-bottom: 1px solid var(--line);
  padding: 0.5rem 0;
}
.empty {
  text-align: center;
  padding: 3rem 1.5rem;
  max-width: 460px;
  margin: 0 auto;
}
.empty-emoji {
  font-size: 3rem;
}
.empty h2 {
  font-size: 1.2rem;
}
.file-btn {
  position: relative;
  overflow: hidden;
  display: block;
}
.hidden-file {
  position: absolute;
  inset: 0;
  opacity: 0;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 20, 0.45);
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
  padding: 1rem 1.1rem calc(1.2rem + env(safe-area-inset-bottom, 0));
  max-height: 88vh;
  overflow-y: auto;
}
.modal.wide {
  max-width: 680px;
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
.summary-box {
  width: 100%;
  font-size: 0.85rem;
  line-height: 1.5;
}
.feat {
  margin: 0.5rem 0;
  padding-left: 1.1rem;
}
.feat li {
  margin: 0.3rem 0;
}
.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(4.8rem + env(safe-area-inset-bottom, 0));
  background: rgba(30, 34, 30, 0.92);
  color: #fff;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  font-size: 0.85rem;
  z-index: 60;
  max-width: 86vw;
  text-align: center;
}
</style>
