<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSeo } from '@/composables/useSeo'
import { useToolBilling } from '@/composables/useToolBilling'
import { manifest } from './manifest'
import { parsePlainText, parseResumeFile } from './lib/parse-resume'
import { matchResume } from './lib/match'
import { buildSuggestions } from './lib/suggest'
import { buildCoverLetter } from './lib/cover-letter'
import {
  deleteApplication,
  deleteResume,
  ensureDb,
  listApplications,
  listResumes,
  newId,
  saveApplication,
  saveResume
} from './lib/store'
import { applicationsToCsv, downloadMarkdown, printHtml } from './lib/export'
import { extractSkills } from './lib/normalize'
import MatchRadar from './components/MatchRadar.vue'
import type { ApplicationRecord, AppStatus, MatchResult, ResumeVersion, Suggestion } from './lib/types'
import { APP_STATUS_LABEL } from './lib/types'

useSeo({
  title: '简历×JD本地匹配与定向优化器 - 离线匹配分/硬门槛核对/求职信/投递看板',
  description:
    '本地解析 PDF/Word 简历与招聘 JD，技能/职责/资质三维匹配打分，自动核对学历年限地点证书硬门槛，给命中与缺失清单、可溯源改写建议与求职信，投递看板全程离线不上传。',
  type: 'SoftwareApplication'
})

const billing = useToolBilling(manifest.id)
const pro = computed(() => billing.canUse('unlimited-match').allowed)
const suggestPro = computed(() => billing.canUse('suggest-pro').allowed)
const coverPro = computed(() => billing.canUse('cover-pro').allowed)
const boardPro = computed(() => billing.canUse('board-pro').allowed)
async function buyPro() {
  await billing.buy('freemium-pro')
}

const FREE_QUOTA = 5
function ym(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function usedThisMonth(): number {
  const raw = localStorage.getItem(`fz-rj:used:${ym()}`)
  return raw ? Number(raw) || 0 : 0
}
const used = ref(0)
function bumpUsage() {
  const n = usedThisMonth() + 1
  localStorage.setItem(`fz-rj:used:${ym()}`, String(n))
  used.value = n
}

const tab = ref<'resume' | 'match' | 'cover' | 'board'>('resume')

// ---- 简历 ----
const resumeText = ref('')
const resumeTitle = ref('我的简历')
const resumeVersions = ref<ResumeVersion[]>([])
const activeResume = ref<ResumeVersion | null>(null)
const parseErr = ref('')
const parseBusy = ref(false)
const resumeParagraphs = computed(() => parsePlainText(resumeText.value).paragraphs)

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  parseBusy.value = true
  parseErr.value = ''
  try {
    const parsed = await parseResumeFile(file)
    resumeText.value = parsed.text
    resumeTitle.value = file.name.replace(/\.[^.]+$/, '')
  } catch (err) {
    parseErr.value = (err as Error).message
  } finally {
    parseBusy.value = false
    input.value = ''
  }
}

async function persistResume() {
  if (!resumeText.value.trim()) return
  const parsed = parsePlainText(resumeText.value)
  const rec: ResumeVersion = activeResume.value
    ? { ...activeResume.value, title: resumeTitle.value, text: parsed.text, paragraphs: parsed.paragraphs, updatedAt: Date.now() }
    : { id: newId(), title: resumeTitle.value || '我的简历', text: parsed.text, paragraphs: parsed.paragraphs, updatedAt: Date.now() }
  await saveResume(rec)
  activeResume.value = rec
  await refreshResumes()
}
function loadResume(r: ResumeVersion) {
  activeResume.value = r
  resumeTitle.value = r.title
  resumeText.value = r.text
}
async function removeResume(id: string) {
  await deleteResume(id)
  if (activeResume.value?.id === id) {
    activeResume.value = null
    resumeText.value = ''
  }
  await refreshResumes()
}
async function refreshResumes() {
  resumeVersions.value = await listResumes()
}

// ---- JD 与匹配 ----
const company = ref('')
const position = ref('')
const jdText = ref('')
const matchBusy = ref(false)
const matchErr = ref('')
const result = ref<MatchResult | null>(null)
const suggestions = ref<Suggestion[]>([])

const scoreColor = computed(() => {
  const s = result.value?.score ?? 0
  if (s >= 80) return '#2ea063'
  if (s >= 60) return '#d69e2e'
  return '#d64545'
})

function canMatch(): { ok: boolean; msg: string } {
  if (!resumeText.value.trim()) return { ok: false, msg: '请先在「我的简历」粘贴或导入简历内容。' }
  if (!jdText.value.trim()) return { ok: false, msg: '请粘贴招聘 JD 原文。' }
  if (!pro.value && used.value >= FREE_QUOTA) {
    return { ok: false, msg: `免费版本月已用 ${FREE_QUOTA} 次，升级专业版可不限岗位。` }
  }
  return { ok: true, msg: '' }
}

async function runMatch() {
  matchErr.value = ''
  const gate = canMatch()
  if (!gate.ok) {
    matchErr.value = gate.msg
    return
  }
  matchBusy.value = true
  try {
    const r = matchResume({
      resumeText: resumeText.value,
      resumeParagraphs: resumeParagraphs.value,
      jdText: jdText.value
    })
    result.value = r
    // 建议仅针对“能力已具备（同义词/版本别名）、但没写标准名”的技能，提示显式命名（不虚构）
    suggestions.value = suggestPro.value
      ? buildSuggestions({ synonymOnly: r.synonymOnly, synonymAlias: r.synonymAlias, paragraphs: resumeParagraphs.value })
      : []
    if (!pro.value) bumpUsage()
  } finally {
    matchBusy.value = false
  }
}

// ---- 求职信 ----
const coverLang = ref<'zh' | 'en'>('zh')
const candidateName = ref('')
const coverText = ref('')
function genCover() {
  if (!result.value) return
  const bullets = result.value.matchedBullets
    .map((id) => resumeParagraphs.value[Number(id)] ?? '')
    .filter(Boolean)
  coverText.value = buildCoverLetter({
    company: company.value,
    position: position.value,
    candidate: candidateName.value,
    hits: result.value.hits,
    bullets,
    lang: coverLang.value
  })
}

// ---- 看板 ----
const applications = ref<ApplicationRecord[]>([])
const statusFilter = ref<AppStatus | 'all'>('all')
const filteredApps = computed(() =>
  statusFilter.value === 'all' ? applications.value : applications.value.filter((a) => a.status === statusFilter.value)
)
async function addToBoard() {
  if (!result.value) return
  const rec: ApplicationRecord = {
    id: newId(),
    company: company.value || '未命名公司',
    position: position.value || '未命名岗位',
    score: result.value.score,
    status: 'todo',
    appliedAt: Date.now(),
    nextFollowUp: null,
    note: '',
    updatedAt: Date.now()
  }
  await saveApplication(rec)
  await refreshApps()
  tab.value = 'board'
}
async function setStatus(a: ApplicationRecord, status: AppStatus) {
  await saveApplication({ ...a, status, updatedAt: Date.now() })
  await refreshApps()
}
async function removeApp(id: string) {
  await deleteApplication(id)
  await refreshApps()
}
async function refreshApps() {
  applications.value = await listApplications()
}
function exportCsv() {
  const rows = applications.value.map((a) => ({
    公司: a.company,
    岗位: a.position,
    匹配分: a.score ?? '',
    状态: APP_STATUS_LABEL[a.status],
    投递日期: new Date(a.appliedAt).toLocaleDateString(),
    下次跟进: a.nextFollowUp ? new Date(a.nextFollowUp).toLocaleDateString() : '',
    备注: a.note
  }))
  const csv = applicationsToCsv(rows)
  if (csv) downloadMarkdown('投递看板.csv', csv)
}

const resumeSkillPreview = computed(() => extractSkills(resumeText.value).slice(0, 30))

onMounted(async () => {
  used.value = usedThisMonth()
  await ensureDb()
  await refreshResumes()
  await refreshApps()
})
</script>

<template>
  <div class="rj">
    <div class="privacy">🔒 简历与 JD 仅在本机解析与匹配，<b>不上传、不存储到云端</b>；记录保存在本机浏览器，可离线使用。</div>

    <div class="tabs">
      <button :class="{ on: tab === 'resume' }" @click="tab = 'resume'">我的简历</button>
      <button :class="{ on: tab === 'match' }" @click="tab = 'match'">匹配诊断</button>
      <button :class="{ on: tab === 'cover' }" @click="tab = 'cover'">求职信</button>
      <button :class="{ on: tab === 'board' }" @click="tab = 'board'">投递看板</button>
    </div>

    <!-- 我的简历 -->
    <section v-if="tab === 'resume'" class="card">
      <h3>我的简历</h3>
      <input v-model="resumeTitle" class="title-input" placeholder="简历版本名，如：前端-3年-2026版" />
      <div class="row">
        <label class="file-btn">
          导入 PDF / Word / TXT
          <input type="file" accept=".pdf,.docx,.txt,.md" hidden @change="onFile" :disabled="parseBusy" />
        </label>
        <span v-if="parseBusy" class="muted">解析中…</span>
        <button class="btn-primary" @click="persistResume" :disabled="!resumeText.trim()">保存为简历版本</button>
      </div>
      <p v-if="parseErr" class="err">{{ parseErr }}</p>
      <textarea v-model="resumeText" class="big-input" rows="14" placeholder="也可以直接把简历全文粘贴到这里（建议包含教育经历、工作年限、城市、技能与项目经历）"></textarea>
      <p v-if="resumeSkillPreview.length" class="muted small">识别到的技能：{{ resumeSkillPreview.join('、') }}</p>

      <div v-if="resumeVersions.length" class="versions">
        <h4>已保存的简历版本（本机）</h4>
        <ul>
          <li v-for="r in resumeVersions" :key="r.id">
            <a href="#" @click.prevent="loadResume(r)">{{ r.title }}</a>
            <span class="muted small"> · {{ new Date(r.updatedAt).toLocaleString() }}</span>
            <button class="link-danger" @click="removeResume(r.id)">删除</button>
          </li>
        </ul>
      </div>
    </section>

    <!-- 匹配诊断 -->
    <section v-else-if="tab === 'match'" class="card">
      <h3>岗位 JD 与匹配诊断</h3>
      <div class="row">
        <input v-model="company" class="half" placeholder="公司名称（选填）" />
        <input v-model="position" class="half" placeholder="岗位名称（选填）" />
      </div>
      <textarea v-model="jdText" class="big-input" rows="9" placeholder="粘贴招聘 JD 原文（含岗位职责、任职要求、学历/年限/地点/证书要求）"></textarea>
      <div class="row">
        <button class="btn-primary big" :disabled="matchBusy" @click="runMatch">
          {{ matchBusy ? '匹配中…' : '开始本地匹配' }}
        </button>
        <span class="muted small">{{ pro ? '专业版：不限岗位' : `免费版本月已用 ${used}/${FREE_QUOTA} 次` }}</span>
      </div>
      <p v-if="matchErr" class="err">{{ matchErr }}</p>
      <div v-if="!pro && used >= FREE_QUOTA && !result" class="gate">
        <p>本月免费匹配次数已用完。</p>
        <button class="btn-primary" @click="buyPro">升级专业版 ¥29.90（买断·不限岗位）</button>
      </div>

      <div v-if="result" class="result">
        <div class="score-head">
          <div class="score" :style="{ color: scoreColor }">{{ result.score }}</div>
          <div class="score-meta">
            <div class="score-tag" :style="{ background: scoreColor }">
              {{ result.score >= 80 ? '高度匹配' : result.score >= 60 ? '较为匹配，补强缺失项' : '硬条件/关键词存缺口' }}
            </div>
            <p v-if="!result.gatesAllPass" class="warn-text">⚠ 存在未满足的硬性门槛（分数已封顶），投递前请确认。</p>
          </div>
          <MatchRadar :dims="result.dims" />
        </div>

        <div class="gates">
          <h4>硬门槛核对</h4>
          <div v-for="(g, i) in result.gates" :key="i" class="gate-item" :class="g.passed ? 'pass' : 'fail'">
            <span>{{ g.passed ? '✓' : '✗' }}</span>
            <div><b>{{ g.raw }}</b><div class="muted small">{{ g.detail }}</div></div>
          </div>
          <p v-if="!result.gates.length" class="muted small">JD 中未识别到明确的学历/年限/证书/地点硬性要求。</p>
        </div>

        <div v-for="d in result.dims" :key="d.key" class="dim">
          <h4>{{ d.label }} <span class="muted">命中 {{ d.hit.length }}/{{ d.required }}</span></h4>
          <div v-if="d.hit.length" class="tags hit">
            <span v-for="t in d.hit" :key="'h' + t" class="tag hit">{{ t }}</span>
          </div>
          <div v-if="d.missing.length" class="tags">
            <span class="muted small">待补强：</span>
            <span v-for="t in d.missing.slice(0, 24)" :key="'m' + t" class="tag miss">{{ t }}</span>
          </div>
        </div>

        <!-- 改写建议（专业版） -->
        <div class="suggest">
          <h4>定向改写建议 <span class="muted small">仅基于你本人经历，可溯源、不虚构</span></h4>
          <div v-if="!suggestPro" class="gate inline">
            <span>可溯源改写建议为专业功能。</span>
            <button class="btn-primary" @click="buyPro">升级 ¥29.90 买断</button>
          </div>
          <template v-else>
            <p v-if="!suggestions.length" class="muted small">没有发现“已具备但没写标准名”的技能；真正缺失的能力请据实补充，切勿虚构。</p>
            <div v-for="(s, i) in suggestions" :key="i" class="sug-item">
              <div><b>建议补标准名：{{ s.missing }}</b> — {{ s.reason }}</div>
              <blockquote>原文（第 {{ Number(s.sourceParaId) + 1 }} 段）：{{ s.sourceText }}</blockquote>
              <div class="draft">建议：{{ s.draft }}</div>
            </div>
          </template>
        </div>

        <div class="row">
          <button class="btn-primary" @click="addToBoard">加入投递看板</button>
          <button class="btn-ghost" @click="tab = 'cover'">去写求职信 →</button>
        </div>
      </div>
    </section>

    <!-- 求职信 -->
    <section v-else-if="tab === 'cover'" class="card">
      <h3>求职信草稿</h3>
      <div v-if="!coverPro" class="gate">
        <p>中英文求职信生成与导出为专业功能（纯模板 + 你的真实经历，无 AI 虚构）。</p>
        <button class="btn-primary" @click="buyPro">升级专业版 ¥29.90（买断）</button>
      </div>
      <template v-else>
        <div class="row">
          <input v-model="candidateName" class="half" placeholder="你的称呼/姓名（选填）" />
          <label>语言
            <select v-model="coverLang">
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <button class="btn-primary" :disabled="!result" @click="genCover">根据匹配结果生成</button>
        </div>
        <p v-if="!result" class="muted small">请先在「匹配诊断」完成一次匹配，再据此生成求职信。</p>
        <textarea v-model="coverText" class="big-input" rows="16" placeholder="点击“根据匹配结果生成”，内容可用本人真实经历继续修改"></textarea>
        <div class="row">
          <button class="btn-ghost" :disabled="!coverText" @click="downloadMarkdown('求职信.md', coverText)">导出 Markdown</button>
          <button class="btn-ghost" :disabled="!coverText" @click="printHtml('求职信', coverText)">打印 / 另存为 PDF</button>
        </div>
      </template>
    </section>

    <!-- 投递看板 -->
    <section v-else class="card">
      <h3>投递看板</h3>
      <div v-if="!boardPro" class="gate">
        <p>本地投递看板（状态流转/跟进/CSV 导出）为专业功能。</p>
        <button class="btn-primary" @click="buyPro">升级专业版 ¥29.90（买断）</button>
      </div>
      <template v-else>
        <div class="row">
          <label>筛选状态
            <select v-model="statusFilter">
              <option value="all">全部</option>
              <option v-for="(label, key) in APP_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <button class="btn-ghost" @click="exportCsv">导出 CSV</button>
          <span class="muted small">共 {{ applications.length }} 条</span>
        </div>
        <p v-if="!applications.length" class="muted">还没有投递记录，完成一次匹配后可“加入投递看板”。</p>
        <ul class="board">
          <li v-for="a in filteredApps" :key="a.id">
            <div class="b-main">
              <b>{{ a.company }}</b> · {{ a.position }}
              <span v-if="a.score !== null" class="b-score" :style="{ color: a.score >= 80 ? '#2ea063' : a.score >= 60 ? '#d69e2e' : '#d64545' }">{{ a.score }}分</span>
              <div class="muted small">{{ new Date(a.appliedAt).toLocaleDateString() }}</div>
            </div>
            <div class="b-ops">
              <select :value="a.status" @change="setStatus(a, ($event.target as HTMLSelectElement).value as AppStatus)">
                <option v-for="(label, key) in APP_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
              </select>
              <button class="link-danger" @click="removeApp(a.id)">删除</button>
            </div>
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.rj { display: flex; flex-direction: column; gap: 12px; }
.privacy { font-size: 13px; color: #26704b; background: #eaf7ef; border: 1px solid #c8e8d5; border-radius: 10px; padding: 8px 12px; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tabs button { flex: 1 1 auto; min-width: 72px; padding: 8px 10px; border: 1px solid var(--border, #ddd); background: #fff; border-radius: 10px; cursor: pointer; }
.tabs button.on { background: #2ea063; color: #fff; border-color: #2ea063; }
.card { background: #fff; border: 1px solid var(--border, #e7e7e7); border-radius: 14px; padding: 14px; }
h3 { margin: 0 0 12px; }
h4 { margin: 14px 0 8px; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 10px 0; }
.half { flex: 1 1 180px; }
.title-input, .big-input, .half, select { width: 100%; box-sizing: border-box; }
.title-input { padding: 8px 10px; border: 1px solid #d4d4d4; border-radius: 8px; margin-bottom: 10px; }
.half { padding: 8px 10px; border: 1px solid #d4d4d4; border-radius: 8px; }
.big-input { padding: 10px; border: 1px solid #d4d4d4; border-radius: 10px; font-family: inherit; line-height: 1.6; resize: vertical; }
.file-btn { display: inline-block; padding: 8px 14px; border: 1px dashed #2ea063; color: #1f6b45; border-radius: 10px; cursor: pointer; background: #f6fbf8; }
.btn-primary { background: #2ea063; color: #fff; border: none; padding: 8px 16px; border-radius: 10px; cursor: pointer; }
.btn-primary:disabled { opacity: .6; cursor: default; }
.btn-ghost { background: #fff; border: 1px solid #cfd6d2; padding: 8px 16px; border-radius: 10px; cursor: pointer; }
.big { padding: 11px 26px; font-size: 15px; }
.err { color: #c0392b; background: #fdecea; border-radius: 8px; padding: 8px 10px; }
.muted { color: #8a8f8c; }
.small { font-size: 12px; }
.gate { border: 1px dashed #cfe3d6; background: #f6fbf8; border-radius: 10px; padding: 14px; text-align: center; margin: 10px 0; }
.gate.inline { display: flex; align-items: center; justify-content: space-between; gap: 10px; text-align: left; }
.versions ul { list-style: none; margin: 6px 0 0; padding: 0; }
.versions li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f2f2f2; }
.link-danger { background: none; border: none; color: #d64545; cursor: pointer; margin-left: auto; }
.result { margin-top: 8px; }
.score-head { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.score { font-size: 52px; font-weight: 800; line-height: 1; }
.score-meta { flex: 1 1 180px; }
.score-tag { display: inline-block; color: #fff; border-radius: 999px; padding: 4px 14px; font-size: 13px; }
.warn-text { color: #b5810f; margin: 8px 0 0; }
.gate-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px; border-radius: 8px; margin-bottom: 6px; }
.gate-item.pass { background: #eef9f2; }
.gate-item.fail { background: #fdecea; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; }
.tag { font-size: 13px; border-radius: 999px; padding: 2px 10px; }
.tag.hit { background: #e3f5ea; color: #1f6b45; }
.tag.miss { background: #f3f3f3; color: #666; }
.sug-item { border: 1px solid #eee; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
.sug-item blockquote { margin: 6px 0; padding: 6px 10px; border-left: 3px solid #cfd6d2; color: #555; background: #fafafa; }
.draft { color: #1f6b45; }
.board { list-style: none; margin: 8px 0 0; padding: 0; }
.board li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
.b-score { margin-left: 8px; font-weight: 700; }
.b-ops { display: flex; gap: 8px; align-items: center; }
@media (max-width: 560px) {
  .score-head { gap: 10px; }
  .score { font-size: 40px; }
}
</style>
