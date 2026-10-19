<script setup lang="ts">
/**
 * 备考错题调度 —— 全部数据只存本地 IndexedDB，离线可用。
 * 边界：只管理用户自录的错题与复习节奏，不做搜答案、不内置任何机构题库；
 * 决策看板仅为保守参考文案，不承诺通过率。
 */
import { computed, onMounted, onUnmounted, reactive, ref, toRaw } from 'vue'
import { useToolBilling } from '@/composables/useToolBilling'
import { useSeo } from '@/composables/useSeo'
import { manifest } from './manifest'
import {
  createId,
  today,
  type Grade,
  type MockExam,
  type Project,
  type Question,
  type ReviewLog,
  type TagNode
} from './lib/models'
import {
  deleteProjectCascade,
  dumpAll,
  getAllMockExams,
  getAllProjects,
  getAllQuestions,
  getAllReviews,
  mergeImport,
  putMockExam,
  putProject,
  putQuestion,
  putReview,
  removeMockExam,
  removeQuestion
} from './lib/store'
import { initialSchedule, scheduleNext } from './lib/scheduler'
import { dueToday } from './lib/queue'
import { analyzeWeakness } from './lib/weakness'
import { buildCurve } from './lib/curve'
import { buildDecision } from './lib/decision'
import { buildReviewIcs, downloadIcs, ensureNotifyPermission, notifyDueSoon } from './lib/notify'
import { compressPhoto } from './lib/photos'
import { OCR_NOTICE } from './lib/ocr'

const FREE_QUESTION_LIMIT = 50

useSeo({
  title: '备考错题调度 - 艾宾浩斯间隔复习/弱项热力图/模考曲线',
  description:
    '把纸质讲义、PDF、网课截图里的错题按科目章节考点录成本地错题本，按艾宾浩斯遗忘曲线自动排今日复习队列，三键自评后智能安排下次复习；弱项热力图标出最该补的考点，模考分数曲线对照目标分，报考/保弃决策保守参考。全程本地存储、离线可用，不搜答案、不内置题库。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const canMulti = computed(() => billing.canUse('multi-project').allowed)
const canUnlimited = computed(() => billing.canUse('unlimited-questions').allowed)
const canReports = computed(() => billing.canUse('reports').allowed)
const priceText = computed(() => billing.priceText(billing.plan.priceCents))
async function upgrade() {
  await billing.buy('freemium-pro')
}

// —— 数据 ——
const projects = ref<Project[]>([])
const questions = ref<Question[]>([])
const reviews = ref<ReviewLog[]>([])
const mockExams = ref<MockExam[]>([])
const loaded = ref(false)
const toast = ref('')
function notify(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2600)
}

// 图片对象 URL 缓存
const urlMap = new Map<string, string>()
function photoUrl(q: Question): string {
  if (!q.photoBlob) return ''
  const hit = urlMap.get(q.id)
  if (hit) return hit
  const url = URL.createObjectURL(q.photoBlob)
  urlMap.set(q.id, url)
  return url
}
onUnmounted(() => urlMap.forEach((u) => URL.revokeObjectURL(u)))

async function reload() {
  const [ps, qs, rs, ms] = await Promise.all([
    getAllProjects(),
    getAllQuestions(),
    getAllReviews(),
    getAllMockExams()
  ])
  projects.value = ps.sort((a, b) => a.createdAt - b.createdAt)
  questions.value = qs
  reviews.value = rs
  mockExams.value = ms
  if (!currentProjectId.value && ps[0]) currentProjectId.value = ps[0].id
  loaded.value = true
}
onMounted(reload)

const currentProjectId = ref<string>('')
const currentProject = computed(() => projects.value.find((p) => p.id === currentProjectId.value) ?? null)

const tab = ref<'queue' | 'book' | 'weak' | 'exam' | 'me'>('queue')
function switchTab(t: typeof tab.value) {
  tab.value = t
}
function selectProject(id: string) {
  currentProjectId.value = id
}

const myQuestions = computed(() =>
  currentProject.value ? questions.value.filter((q) => q.projectId === currentProject.value!.id) : []
)

// —— 今日队列 ——
const todayStr = today()
const due = computed(() => dueToday(myQuestions.value, todayStr))
const dueBadge = computed(() => due.value.length)

async function rate(q: Question, grade: Grade) {
  const sched = scheduleNext(q, grade, todayStr)
  const raw = toRaw(q)
  const updated: Question = {
    ...raw,
    pointPath: { ...toRaw(raw.pointPath) },
    ease: sched.ease,
    intervalDays: sched.intervalDays,
    reps: sched.reps,
    nextReview: sched.nextReview
  }
  await putQuestion(toRaw(updated))
  await putReview(toRaw({ id: createId('rv'), questionId: q.id, ts: Date.now(), grade, intervalAfter: sched.intervalDays }))
  await reload()
  notify(grade === 5 ? '记得 ✓ 已安排下次复习' : grade === 3 ? '模糊，稍后再见' : '已忘，回到明天再背')
}

// —— 错题录入 ——
const showQForm = ref(false)
const qForm = reactive({ stem: '', wrongCause: '', answer: '', source: '', subject: '', chapter: '', point: '' })
const pendingPhoto = ref<{ blob: Blob; mime: string; width: number; height: number; url: string } | null>(null)

const subjectOptions = computed(() => (currentProject.value?.tags ?? []).map((t) => t.subject))
function chapterOptions(subject: string): string[] {
  const node = currentProject.value?.tags.find((t) => t.subject === subject)
  return node ? node.chapters.map((c) => c.name) : []
}
function pointOptions(subject: string, chapter: string): string[] {
  const node = currentProject.value?.tags.find((t) => t.subject === subject)
  const ch = node?.chapters.find((c) => c.name === chapter)
  return ch ? ch.points : []
}

function openQForm() {
  // 免费层 50 题门
  if (questions.value.length >= FREE_QUESTION_LIMIT && !canUnlimited.value) {
    showUpgrade.value = true
    return
  }
  if (!currentProject.value) return
  Object.assign(qForm, { stem: '', wrongCause: '', answer: '', source: '', subject: '', chapter: '', point: '' })
  if (pendingPhoto.value) {
    URL.revokeObjectURL(pendingPhoto.value.url)
    pendingPhoto.value = null
  }
  showQForm.value = true
}

async function onPickPhoto(file: File | null) {
  if (!file) return
  try {
    const r = await compressPhoto(file)
    if (pendingPhoto.value) URL.revokeObjectURL(pendingPhoto.value.url)
    pendingPhoto.value = { blob: r.blob, mime: r.mime, width: r.width, height: r.height, url: URL.createObjectURL(r.blob) }
  } catch {
    notify('图片处理失败，可直接手动录入')
  }
}

/** 确保所选/新建考点存在于项目标签树，返回更新后的 tags。 */
function ensurePoint(tags: TagNode[], subject: string, chapter: string, point: string): TagNode[] {
  const next: TagNode[] = JSON.parse(JSON.stringify(tags))
  let node = next.find((t) => t.subject === subject)
  if (!node) {
    node = { subject, chapters: [] }
    next.push(node)
  }
  let ch = node.chapters.find((c) => c.name === chapter)
  if (!ch) {
    ch = { name: chapter, points: [] }
    node.chapters.push(ch)
  }
  if (!ch.points.includes(point)) ch.points.push(point)
  return next
}

async function saveQuestion() {
  if (!currentProject.value) return
  if (!qForm.stem.trim()) {
    notify('请填写题干')
    return
  }
  if (!qForm.subject.trim() || !qForm.chapter.trim() || !qForm.point.trim()) {
    notify('必选到最末级考点（科目 / 章节 / 考点都要填）')
    return
  }
  // 写回标签树
  const tags = ensurePoint(currentProject.value.tags, qForm.subject.trim(), qForm.chapter.trim(), qForm.point.trim())
  await putProject(toRaw({ ...currentProject.value, tags }))

  const init = initialSchedule(todayStr)
  const q: Question = {
    id: createId('q'),
    projectId: currentProject.value.id,
    stem: qForm.stem.trim(),
    wrongCause: qForm.wrongCause.trim(),
    answer: qForm.answer.trim(),
    source: qForm.source.trim(),
    pointPath: { subject: qForm.subject.trim(), chapter: qForm.chapter.trim(), point: qForm.point.trim() },
    ease: init.ease,
    intervalDays: init.intervalDays,
    reps: init.reps,
    nextReview: init.nextReview,
    createdAt: Date.now()
  }
  if (pendingPhoto.value) {
    q.photoBlob = pendingPhoto.value.blob
    q.photoMime = pendingPhoto.value.mime
    q.photoWidth = pendingPhoto.value.width
    q.photoHeight = pendingPhoto.value.height
  }
  await putQuestion(toRaw(q))
  showQForm.value = false
  await reload()
  notify('错题已收录，明天首次提醒复习 ✓')
}

async function deleteQuestion(q: Question) {
  if (!confirm('删除这道错题？其复习记录会一并保留供统计。')) return
  await removeQuestion(q.id)
  await reload()
}

// —— 弱项热力 ——
const weakness = computed(() => analyzeWeakness(myQuestions.value, reviews.value))
const levelClass: Record<string, string> = { red: 'lv-red', yellow: 'lv-yellow', green: 'lv-green', none: 'lv-none' }

// —— 模考 ——
const mForm = reactive({ date: todayStr, subject: '', score: '', fullScore: '100', minutes: '' })
const curve = computed(() => (currentProject.value ? buildCurve(mockExams.value.filter((m) => m.projectId === currentProject.value!.id), currentProject.value.targetScore) : null))

async function saveMockExam() {
  if (!currentProject.value) return
  const score = Number(mForm.score)
  const full = Number(mForm.fullScore)
  const minutes = Number(mForm.minutes)
  if (!mForm.subject.trim()) {
    notify('请填写科目')
    return
  }
  if (!isFinite(score) || !isFinite(full) || full <= 0) {
    notify('请填写正确的得分与满分')
    return
  }
  await putMockExam(
    toRaw({
      id: createId('mk'),
      projectId: currentProject.value.id,
      date: mForm.date || todayStr,
      subject: mForm.subject.trim(),
      score,
      fullScore: full,
      minutes: isFinite(minutes) && minutes > 0 ? minutes : 0,
      createdAt: Date.now()
    })
  )
  mForm.subject = ''
  mForm.score = ''
  mForm.minutes = ''
  await reload()
  notify('模考成绩已记录 ✓')
}
async function deleteMockExam(m: MockExam) {
  await removeMockExam(m.id)
  await reload()
}

const decision = computed(() =>
  currentProject.value ? buildDecision(currentProject.value, mockExams.value, todayStr) : null
)

// —— 项目管理 ——
const showPForm = ref(false)
const pForm = reactive({ name: '', examDate: '', targetScore: '60' })
function openAddProject() {
  if (projects.value.length >= 1 && !canMulti.value) {
    showUpgrade.value = true
    return
  }
  Object.assign(pForm, { name: '', examDate: '', targetScore: '60' })
  showPForm.value = true
}
async function saveProject() {
  if (!pForm.name.trim()) {
    notify('请填写项目名称，如 "CPA-会计 2026"')
    return
  }
  const target = Number(pForm.targetScore)
  await putProject(
    toRaw({
      id: createId('p'),
      name: pForm.name.trim(),
      examDate: pForm.examDate || '',
      targetScore: isFinite(target) ? target : 60,
      createdAt: Date.now(),
      tags: []
    })
  )
  showPForm.value = false
  await reload()
  notify('考试项目已建立 ✓')
}
async function removeProject() {
  if (!currentProject.value) return
  if (!confirm(`删除「${currentProject.value.name}」将同时删除其全部错题、复习记录与模考成绩，不可恢复。`)) return
  const id = currentProject.value.id
  await deleteProjectCascade(id)
  currentProjectId.value = ''
  await reload()
}

// —— 提醒 / 备份 ——
async function enableNotify() {
  const ok = await ensureNotifyPermission()
  notify(ok ? '已开启通知（仅应用打开时有效，长期请导出日历）' : '未授权通知，可用导出系统日历兜底')
  if (ok && due.value.length) notifyDueSoon(due.value.length, due.value[0]!.question.stem)
}
function exportIcs() {
  if (!currentProject.value) return
  if (!due.value.length) {
    notify('当前没有到期的复习题')
    return
  }
  downloadIcs(buildReviewIcs(due.value.map((d) => d.question), currentProject.value.name))
  notify('已导出 .ics，用系统日历打开即可导入')
}
async function doExport() {
  if (!canReports.value) {
    showUpgrade.value = true
    return
  }
  const data = await dumpAll()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fangzi-exam-review-${today()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  notify('备份包已导出 ✓')
}
async function onImportFile(file: File | null) {
  if (!file) return
  if (!canReports.value) {
    showUpgrade.value = true
    return
  }
  try {
    const text = await file.text()
    const r = await mergeImport(JSON.parse(text))
    await reload()
    notify(`导入完成：新增 ${r.added} 条，按 id 去重跳过 ${r.skipped} 条`)
  } catch (e) {
    notify((e as Error).message || '导入失败，请选择本工具导出的 JSON')
  }
}

const showUpgrade = ref(false)

function windowOpen(url: string) {
  if (url) window.open(url, '_blank')
}
</script>

<template>
  <div class="er-app">
    <!-- 空状态 -->
    <section v-if="loaded && projects.length === 0" class="empty">
      <div class="empty-emoji">📚</div>
      <h2>建一个考试项目，开始管理你的错题</h2>
      <p>把纸质讲义、PDF、网课截图里的错题按科目/章节/考点录进来，系统会按遗忘曲线每天提醒你复习最该刷的题。数据只存这台设备，离线也能用。</p>
      <button class="btn primary big" @click="openAddProject">建立第一个考试项目</button>
      <p class="muted tiny">本工具只管理你自录的错题，不做搜答案、不内置任何机构题库。</p>
    </section>

    <template v-else-if="currentProject">
      <div class="apphead">
        <div class="proj-scroll">
          <button
            v-for="p in projects"
            :key="p.id"
            class="proj-chip"
            :class="{ active: p.id === currentProjectId }"
            @click="selectProject(p.id)"
          >
            🎯 {{ p.name }}
          </button>
          <button class="proj-chip add" @click="openAddProject">＋ 新项目</button>
        </div>
        <nav class="seg" aria-label="功能导航">
          <button :class="{ on: tab === 'queue' }" @click="switchTab('queue')">
            🔁 今日<i v-if="dueBadge" class="seg-badge">{{ dueBadge }}</i>
          </button>
          <button :class="{ on: tab === 'book' }" @click="switchTab('book')">📖 错题本</button>
          <button :class="{ on: tab === 'weak' }" @click="switchTab('weak')">🔥 弱项</button>
          <button :class="{ on: tab === 'exam' }" @click="switchTab('exam')">📈 模考</button>
          <button :class="{ on: tab === 'me' }" @click="switchTab('me')">⚙️ 我的</button>
        </nav>
      </div>

      <!-- 今日队列 -->
      <section v-if="tab === 'queue'" class="page">
        <h1 class="page-h">今日复习
          <small class="muted">{{ dueBadge }} 道到期 · 打开即更新</small>
        </h1>
        <p v-if="due.length === 0" class="muted">今天没有到期的错题，去「错题本」录两道，或过会儿再看。</p>
        <ul class="due-list">
          <li v-for="d in due" :key="d.question.id" class="due-item" :class="{ overdue: d.overdueDays > 0 }">
            <div class="due-main">
              <strong class="stem">{{ d.question.stem }}</strong>
              <span class="muted tiny">{{ d.question.pointPath.subject }} / {{ d.question.pointPath.chapter }} / {{ d.question.pointPath.point }}</span>
              <span v-if="d.overdueDays > 0" class="overdue-tag">已逾期 {{ d.overdueDays }} 天</span>
              <span v-else class="today-tag">今天到期</span>
            </div>
            <div class="rate-row">
              <button class="rate forgot" @click="rate(d.question, 1)">已忘</button>
              <button class="rate fuzzy" @click="rate(d.question, 3)">模糊</button>
              <button class="rate good" @click="rate(d.question, 5)">记得</button>
            </div>
          </li>
        </ul>
        <div class="row-ops">
          <button class="btn small ghost" @click="enableNotify">开启通知</button>
          <button class="btn small ghost" @click="exportIcs">导出到系统日历</button>
        </div>
        <p class="muted tiny">手机浏览器关闭后收不到后台通知，「导出到系统日历」可长期兜底提醒。</p>
      </section>

      <!-- 错题本 -->
      <section v-else-if="tab === 'book'" class="page">
        <div class="book-head">
          <h1 class="page-h" style="margin:0">错题本
            <small class="muted">共 {{ myQuestions.length }} 道<template v-if="!canUnlimited">（免费 {{ questions.length }}/{{ FREE_QUESTION_LIMIT }}）</template></small>
          </h1>
          <button class="btn primary" @click="openQForm">＋ 录错题</button>
        </div>
        <p v-if="myQuestions.length === 0" class="muted">还没有错题，点右上角「录错题」开始。题干/错因/正解都由你自己记录。</p>
        <ul class="q-list">
          <li v-for="q in myQuestions" :key="q.id" class="q-item">
            <div class="q-stem">{{ q.stem }}</div>
            <div class="muted tiny">{{ q.pointPath.subject }} / {{ q.pointPath.chapter }} / {{ q.pointPath.point }}</div>
            <div v-if="q.wrongCause" class="q-line"><span class="lb">错因</span>{{ q.wrongCause }}</div>
            <div v-if="q.answer" class="q-line"><span class="lb">正解</span>{{ q.answer }}</div>
            <div v-if="q.source" class="muted tiny">来源：{{ q.source }}</div>
            <img v-if="photoUrl(q)" :src="photoUrl(q)" class="q-photo" alt="错题附件" @click="windowOpen(photoUrl(q))" />
            <div class="q-meta muted tiny">下次复习：{{ q.nextReview }} · 间隔 {{ q.intervalDays }} 天</div>
            <button class="btn tiny ghost del" @click="deleteQuestion(q)">删除</button>
          </li>
        </ul>
      </section>

      <!-- 弱项 -->
      <section v-else-if="tab === 'weak'" class="page">
        <h1 class="page-h">弱项热力图</h1>
        <p class="muted tiny">按考点汇总错题数与最近正确率：<span class="lv-red sw">红</span>&lt;50%、<span class="lv-yellow sw">黄</span>50–70%、<span class="lv-green sw">绿</span>&gt;70%。优先刷红块。</p>
        <p v-if="weakness.length === 0" class="muted">录入错题并完成几次自评后，这里会自动生成弱项分布。</p>
        <ul class="weak-grid">
          <li v-for="c in weakness" :key="c.key" class="weak-cell" :class="levelClass[c.level]">
            <div class="wc-point">{{ c.point }}</div>
            <div class="wc-sub muted tiny">{{ c.subject }} / {{ c.chapter }}</div>
            <div class="wc-stat">
              错题 {{ c.questionCount }} · 复习 {{ c.reviewCount }} ·
              {{ c.accuracy === null ? '未测' : `正确率 ${(c.accuracy * 100).toFixed(0)}%` }}
            </div>
          </li>
        </ul>
      </section>

      <!-- 模考 -->
      <section v-else-if="tab === 'exam'" class="page">
        <h1 class="page-h">模考记录</h1>
        <div class="card">
          <div class="card-h">记录一次计时模考</div>
          <div class="grid2">
            <div><label>日期</label><input type="date" v-model="mForm.date" /></div>
            <div><label>科目</label><input type="text" v-model="mForm.subject" placeholder="如 会计" /></div>
            <div><label>得分</label><input type="number" inputmode="decimal" v-model="mForm.score" placeholder="如 68" /></div>
            <div><label>满分</label><input type="number" inputmode="decimal" v-model="mForm.fullScore" placeholder="100" /></div>
          </div>
          <label>用时（分钟，可选）</label>
          <input type="number" inputmode="numeric" v-model="mForm.minutes" placeholder="如 180" />
          <button class="btn primary block" @click="saveMockExam">保存模考成绩</button>
        </div>

        <div class="card">
          <div class="card-h">分数趋势（对照目标线 {{ currentProject.targetScore }}%）</div>
          <p v-if="!curve || curve.points.length < 2" class="muted">录入至少 2 次模考后生成曲线。</p>
          <svg v-else :viewBox="`0 0 ${curve.W} ${curve.H}`" class="chart" role="img" aria-label="模考分数曲线">
            <line
              v-if="curve.targetY !== null"
              :x1="curve.pad" :y1="curve.targetY" :x2="curve.W - curve.pad" :y2="curve.targetY"
              stroke="#e0675a" stroke-width="1.5" stroke-dasharray="6 5"
            />
            <polyline :points="curve.line" fill="none" stroke="#3b7dd8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
            <circle v-for="p in curve.points" :key="p.exam.id" :cx="p.x" :cy="p.y" r="3.5" fill="#3b7dd8">
              <title>{{ p.exam.date }} {{ p.exam.subject }}：{{ p.percent.toFixed(0) }}%</title>
            </circle>
          </svg>
          <div v-if="curve && curve.avg !== null" class="muted tiny">
            平均约 {{ curve.avg.toFixed(0) }}%
            <template v-if="curve.trend !== null">；最近一次较首次 {{ curve.trend >= 0 ? '+' : '' }}{{ curve.trend.toFixed(0) }} 个百分点</template>。
          </div>
          <ul class="mk-list">
            <li v-for="m in mockExams.filter((x) => x.projectId === currentProject!.id).slice().sort((a, b) => b.date.localeCompare(a.date))" :key="m.id" class="mk-item">
              <span>{{ m.date }} · {{ m.subject }}</span>
              <strong>{{ m.score }}/{{ m.fullScore }}{{ m.minutes ? ` · ${m.minutes}分钟` : '' }}</strong>
              <button class="btn tiny ghost del" @click="deleteMockExam(m)">删</button>
            </li>
          </ul>
        </div>

        <div class="card">
          <div class="card-h">报考 / 保弃决策看板</div>
          <template v-if="canReports">
            <p v-for="(line, i) in decision?.lines" :key="i" class="dec-line">{{ line }}</p>
          </template>
          <button v-else class="btn block" @click="showUpgrade = true">决策看板与备份导出（专业版）</button>
        </div>
      </section>

      <!-- 我的 -->
      <section v-else-if="tab === 'me'" class="page">
        <h1 class="page-h">我的</h1>
        <div class="card">
          <div class="card-h">🎯 当前项目</div>
          <div class="muted">{{ currentProject.name }}<template v-if="currentProject.examDate"> · 考试日 {{ currentProject.examDate }}</template> · 目标 {{ currentProject.targetScore }}%</div>
          <button class="btn block danger-text" @click="removeProject">删除该项目及其全部数据</button>
        </div>

        <div class="card">
          <div class="card-h">💾 备份与迁移</div>
          <p class="muted tiny">全库 JSON 导出 / 导入（按 id 去重合并），换机或重装浏览器时带走错题本。</p>
          <template v-if="canReports">
            <div class="row-ops">
              <button class="btn" @click="doExport">导出备份</button>
              <label class="btn file-btn">导入备份
                <input type="file" accept="application/json,.json" class="hidden-file" @change="onImportFile(($event.target as HTMLInputElement).files?.[0] ?? null)" />
              </label>
            </div>
          </template>
          <button v-else class="btn block" @click="showUpgrade = true">导出 / 导入备份（专业版）</button>
        </div>

        <div class="card">
          <div class="card-h">🗣️ 拍照识别（实验）</div>
          <p class="muted tiny">{{ OCR_NOTICE }}</p>
        </div>

        <div class="card upgrade-card" v-if="!canMulti || !canUnlimited || !canReports">
          <div class="card-h">✨ 专业版</div>
          <ul class="feat">
            <li>多个考试项目并行管理</li>
            <li>错题数量不限（免费 50 道）</li>
            <li>报考/保弃决策看板与全库导出/导入备份</li>
          </ul>
          <p class="muted tiny">一次买断 {{ priceText }}（也可订阅 月 ¥2.6 / 年 ¥26）。数据仍只存本机。</p>
          <button class="btn primary block" @click="upgrade">升级专业版</button>
        </div>
        <p class="compliance">本工具只管理你自录的错题，不做搜答案、不内置任何机构题库或出版社内容；决策文案仅供参考，不承诺通过率。</p>
      </section>
    </template>

    <!-- 录错题弹层 -->
    <div v-if="showQForm" class="modal-mask" @click.self="showQForm = false">
      <div class="modal">
        <h3>录一道错题</h3>
        <label>题干 *</label>
        <textarea rows="2" v-model="qForm.stem" placeholder="抄下题目，或粘贴 PDF 里的题干"></textarea>
        <label>错因（为什么选错）</label>
        <textarea rows="2" v-model="qForm.wrongCause" placeholder="概念混淆/计算失误/没看清题干…"></textarea>
        <label>正解 / 知识点</label>
        <textarea rows="2" v-model="qForm.answer" placeholder="正确答案与解析要点"></textarea>
        <label>来源（纸质书/PDF/网课，自由填写）</label>
        <input type="text" v-model="qForm.source" placeholder="如 轻一 第3章 例12" />
        <label>标签（必选到末级考点 *，可直接输入新标签）</label>
        <div class="grid3">
          <input list="er-subjects" v-model="qForm.subject" placeholder="科目" />
          <datalist id="er-subjects"><option v-for="s in subjectOptions" :key="s" :value="s"></option></datalist>
          <input list="er-chapters" v-model="qForm.chapter" placeholder="章节" />
          <datalist id="er-chapters"><option v-for="c in chapterOptions(qForm.subject)" :key="c" :value="c"></option></datalist>
          <input list="er-points" v-model="qForm.point" placeholder="考点" />
          <datalist id="er-points"><option v-for="p in pointOptions(qForm.subject, qForm.chapter)" :key="p" :value="p"></option></datalist>
        </div>
        <label>拍照附件（自动压缩去 EXIF，免费可用，不做识别）</label>
        <input type="file" accept="image/*" capture="environment" @change="onPickPhoto(($event.target as HTMLInputElement).files?.[0] ?? null)" />
        <img v-if="pendingPhoto" :src="pendingPhoto.url" class="preview" alt="待保存照片" />
        <div class="row-ops">
          <button class="btn" @click="showQForm = false">取消</button>
          <button class="btn primary" @click="saveQuestion">保存错题</button>
        </div>
      </div>
    </div>

    <!-- 项目弹层 -->
    <div v-if="showPForm" class="modal-mask" @click.self="showPForm = false">
      <div class="modal">
        <h3>新建考试项目</h3>
        <label>项目名称 *</label>
        <input type="text" v-model="pForm.name" placeholder="如 CPA-会计 2026" />
        <div class="grid2">
          <div><label>考试日期</label><input type="date" v-model="pForm.examDate" /></div>
          <div><label>目标分（百分制）</label><input type="number" inputmode="decimal" v-model="pForm.targetScore" /></div>
        </div>
        <div class="row-ops">
          <button class="btn" @click="showPForm = false">取消</button>
          <button class="btn primary" @click="saveProject">建立项目</button>
        </div>
      </div>
    </div>

    <!-- 升级弹层 -->
    <div v-if="showUpgrade" class="modal-mask" @click.self="showUpgrade = false">
      <div class="modal">
        <h3>专业版功能</h3>
        <ul class="feat">
          <li>多个考试项目并行管理（免费仅 1 个）</li>
          <li>错题数量不限（免费 50 道）</li>
          <li>报考/保弃决策看板与全库导出/导入备份</li>
        </ul>
        <p class="muted">一次买断 {{ priceText }}，所有数据仍只保存在你的设备，不上云。</p>
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
.er-app {
  --brand: #3b7dd8;
  --brand-d: #2a5fb0;
  --ink: #1f2430;
  --muted: #828a99;
  --line: #e6e9ef;
  --bg: #f4f6fa;
  --card: #ffffff;
  min-height: 100%;
  background: var(--bg);
  color: var(--ink);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
}
.apphead {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 0.5rem 0.75rem 0.45rem;
}
.proj-scroll {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.proj-chip {
  white-space: nowrap;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 0.45rem 0.8rem;
  font-size: 0.88rem;
  min-height: 44px;
  color: var(--ink);
}
.proj-chip.active {
  border-color: var(--brand);
  background: #e8f0fd;
  color: var(--brand-d);
  font-weight: 700;
}
.proj-chip.add {
  color: var(--brand-d);
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
  padding: 0.5rem 0.1rem;
  font-size: 0.82rem;
  color: #5c6370;
  min-height: 44px;
}
.seg button.on {
  border-color: var(--brand);
  background: #e8f0fd;
  color: var(--brand-d);
  font-weight: 700;
}
.seg-badge {
  position: absolute;
  top: -0.3rem;
  right: 0.1rem;
  background: #e0675a;
  color: #fff;
  font-style: normal;
  font-size: 0.62rem;
  min-width: 1rem;
  height: 1rem;
  line-height: 1rem;
  border-radius: 999px;
  padding: 0 0.2rem;
}
@media (min-width: 821px) {
  .apphead {
    position: static;
    background: transparent;
    border-bottom: 0;
  }
}
.page {
  padding: 0.85rem 0.85rem calc(1rem + env(safe-area-inset-bottom, 0px));
  max-width: 760px;
  margin: 0 auto;
}
.page-h {
  font-size: 1.25rem;
  margin: 0.2rem 0 0.75rem;
}
.page-h small {
  display: block;
  font-size: 0.8rem;
  font-weight: 400;
  margin-top: 0.15rem;
}
.book-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
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
.due-list,
.q-list,
.weak-grid {
  list-style: none;
  margin: 0 0 0.8rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.due-item {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  padding: 0.7rem 0.8rem;
}
.due-item.overdue {
  border-color: #e8a79f;
  background: #fdf3f2;
}
.due-main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.stem {
  font-size: 0.98rem;
}
.overdue-tag {
  color: #c2483a;
  font-weight: 700;
  font-size: 0.8rem;
}
.today-tag {
  color: #b08a2a;
  font-size: 0.8rem;
}
.rate-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
.rate {
  border-radius: 0.6rem;
  padding: 0.6rem 0;
  font-size: 0.9rem;
  min-height: 44px;
  border: 1px solid var(--line);
  background: #fff;
}
.rate.forgot {
  background: #fdeceb;
  color: #c2483a;
  border-color: #e8a79f;
}
.rate.fuzzy {
  background: #fdf6e3;
  color: #9a7a1e;
  border-color: #e6cf8a;
}
.rate.good {
  background: #e9f7ef;
  color: #237a52;
  border-color: #9cd6b6;
}
.q-item {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  padding: 0.7rem 0.8rem;
}
.q-stem {
  font-weight: 600;
  margin-bottom: 0.25rem;
}
.q-line {
  font-size: 0.88rem;
  margin: 0.2rem 0;
}
.q-line .lb {
  display: inline-block;
  color: var(--brand-d);
  margin-right: 0.3rem;
}
.q-photo {
  width: 5rem;
  height: 5rem;
  object-fit: cover;
  border-radius: 0.5rem;
  margin-top: 0.4rem;
  border: 1px solid var(--line);
}
.q-meta {
  margin-top: 0.3rem;
}
.del {
  margin-top: 0.4rem;
  color: #c2483a;
}
.weak-cell {
  background: var(--card);
  border: 1px solid var(--line);
  border-left-width: 6px;
  border-radius: 0.7rem;
  padding: 0.6rem 0.75rem;
}
.weak-cell.lv-red {
  border-left-color: #e0675a;
}
.weak-cell.lv-yellow {
  border-left-color: #e6b93f;
}
.weak-cell.lv-green {
  border-left-color: #4caf7d;
}
.weak-cell.lv-none {
  border-left-color: #c7ccd6;
}
.wc-point {
  font-weight: 700;
}
.wc-stat {
  font-size: 0.8rem;
  margin-top: 0.2rem;
}
.sw {
  padding: 0 0.3rem;
  border-radius: 0.25rem;
  color: #fff;
}
.lv-red.sw {
  background: #e0675a;
}
.lv-yellow.sw {
  background: #e6b93f;
}
.lv-green.sw {
  background: #4caf7d;
}
.chart {
  width: 100%;
  height: auto;
  background: #fcfdff;
  border: 1px solid var(--line);
  border-radius: 0.6rem;
}
.mk-list {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
}
.mk-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  border-bottom: 1px dashed var(--line);
  font-size: 0.88rem;
}
.dec-line {
  font-size: 0.92rem;
  line-height: 1.55;
  margin: 0.3rem 0;
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
  padding: 0.55rem 0.9rem;
  font-size: 0.9rem;
  cursor: pointer;
  min-height: 44px;
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
  padding: 0.35rem 0.65rem;
  font-size: 0.82rem;
}
.btn.tiny {
  padding: 0.25rem 0.55rem;
  font-size: 0.76rem;
  min-height: 32px;
}
.btn.block {
  width: 100%;
  margin-top: 0.5rem;
  text-align: center;
}
.danger-text {
  color: #c2483a;
}
.compliance {
  color: #a07a3a;
  font-size: 0.76rem;
  text-align: center;
  margin: 0.8rem 0.2rem;
  line-height: 1.5;
}
.form label,
.modal label,
.page .card label {
  display: block;
  font-size: 0.82rem;
  color: #556;
  margin: 0.6rem 0 0.25rem;
}
.modal input,
.modal textarea,
.page .card input,
.page .card select,
.page .card textarea {
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
.grid3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.4rem;
}
.preview {
  width: 6rem;
  height: 6rem;
  object-fit: cover;
  border-radius: 0.5rem;
  margin-top: 0.5rem;
  border: 1px solid var(--line);
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
.file-btn {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
}
.hidden-file {
  position: absolute;
  inset: 0;
  opacity: 0;
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
.feat {
  margin: 0.5rem 0;
  padding-left: 1.1rem;
}
.feat li {
  margin: 0.3rem 0;
}
.upgrade-card {
  border-color: #c9dcf5;
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
