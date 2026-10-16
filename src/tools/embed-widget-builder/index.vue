<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { manifest } from './manifest'
import { useSeo } from '@/composables/useSeo'
import { useToolBilling } from '@/composables/useToolBilling'
import { TEMPLATES, THEME_PRESETS, templateOf, type TemplateDef } from './lib/templates'
import { widgetSource, widgetTag, widgetFileName } from './lib/gen'
import { standaloneDoc, embedSnippet } from './lib/snippet'
import {
  listInstances, saveInstance, deleteInstance,
  listPreviewSubmissions, addPreviewSubmission, clearPreviewSubmissions,
  toCSV, downloadText, submissionFileName
} from './lib/data'
import { buildAccess, upgrade, FREE_INSTANCE_LIMIT } from './lib/monetization'
import type { WidgetConfig, FieldCfg, FieldType, WidgetSubmission } from './lib/types'

useSeo({
  title: '可嵌入交互组件生成平台 - 无代码生成表单/评分/计算器/倒计时 Web Component',
  description:
    '可视化配置报名表单、满意度反馈、星级评分、价格计算器、活动倒计时，实时预览并一键导出 Shadow DOM 样式隔离的 Web Component 单文件，复制两段代码嵌入任意站点（React/Vue/WordPress），数据本地处理。',
  type: 'SoftwareApplication',
  keywords: manifest.keywords,
  jsonLd: { offers: { '@type': 'Offer', price: '24.9', priceCurrency: 'CNY' } }
})

const billing = useToolBilling(manifest.id)
const access = ref(buildAccess(billing))
watch(billing.billingVersion, () => { access.value = buildAccess(billing) })

type Step = 'list' | 'config' | 'preview' | 'embed' | 'data'
const STEPS: { key: Step; label: string }[] = [
  { key: 'list', label: '1 选模板' },
  { key: 'config', label: '2 配置' },
  { key: 'preview', label: '3 预览' },
  { key: 'embed', label: '4 嵌入导出' },
  { key: 'data', label: '5 数据' }
]
const step = ref<Step>('list')
const instances = ref<WidgetConfig[]>(listInstances())
const cfg = ref<WidgetConfig | null>(null)
const previewHtml = ref('')
const hostBase = ref('')
const notice = ref('')
const upgrading = ref(false)

const tag = computed(() => (cfg.value ? widgetTag(cfg.value) : ''))
const scriptCode = computed(() => (cfg.value ? widgetSource(cfg.value) : ''))
const embedCode = computed(() => (cfg.value ? embedSnippet(cfg.value, hostBase.value) : ''))
const submissions = ref<WidgetSubmission[]>([])
const scriptBytes = computed(() => new Blob([scriptCode.value]).size)

function flash(msg: string) {
  notice.value = msg
  setTimeout(() => { if (notice.value === msg) notice.value = '' }, 2600)
}

async function onUpgrade() {
  upgrading.value = true
  try { await upgrade(billing); access.value = buildAccess(billing); flash('已解锁专业版') }
  finally { upgrading.value = false }
}

function startTemplate(t: TemplateDef) {
  if (t.pro && !access.value.pro) { flash('该模板为专业版功能，请先解锁'); return }
  if (!access.value.pro && instances.value.length >= FREE_INSTANCE_LIMIT) {
    flash('免费版最多保存 ' + FREE_INSTANCE_LIMIT + ' 个组件，解锁专业版可不限数量')
    return
  }
  cfg.value = t.defaults()
  step.value = 'config'
}
function editInstance(c: WidgetConfig) { cfg.value = JSON.parse(JSON.stringify(c)); step.value = 'config' }
function removeInstance(c: WidgetConfig) {
  if (!confirm('确定删除组件「' + c.title + '」？已嵌入站点的旧脚本不受影响。')) return
  instances.value = deleteInstance(c.id)
  clearPreviewSubmissions(c.id)
}

/* ---------- 配置编辑 ---------- */
function addField() {
  const fields = cfg.value?.fields
  if (!fields || !cfg.value) return
  const n = fields.length + 1
  fields.push({ id: 'f' + Date.now(), name: 'field_' + n, label: '新字段 ' + n, type: 'text', required: false, placeholder: '' })
}
function removeField(i: number) { cfg.value?.fields?.splice(i, 1) }
function onFieldType(f: FieldCfg, v: FieldType) { f.type = v }
const FIELD_TYPES: { v: FieldType; label: string }[] = [
  { v: 'text', label: '单行文本' }, { v: 'email', label: '邮箱' },
  { v: 'textarea', label: '多行文本' }, { v: 'number', label: '数字' }
]
const choicesText = ref('')
watch(cfg, (c) => { choicesText.value = c?.choices?.join('\n') ?? '' }, { immediate: true })
watch(choicesText, (v) => {
  if (cfg.value && cfg.value.kind === 'feedback') {
    cfg.value.choices = v.split('\n').map((s) => s.trim()).filter(Boolean)
  }
})

function saveCurrent() {
  if (!cfg.value) return
  // 免费版强制保留角标
  if (!access.value.pro) cfg.value.poweredBy = true
  instances.value = saveInstance(cfg.value)
  flash('已保存到「我的组件」')
}
function gotoPreview() {
  if (!cfg.value) return
  saveCurrent()
  previewHtml.value = standaloneDoc(cfg.value, true, '这是组件在第三方网页中的真实效果（Shadow DOM 内样式与宿主页面隔离）。可直接在右侧试用并提交一条测试数据。')
  submissions.value = listPreviewSubmissions(cfg.value.id) as WidgetSubmission[]
  step.value = 'preview'
}

/* ---------- 复制 / 下载 ---------- */
const copied = ref<Record<string, boolean>>({})
async function copy(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta)
    ta.select(); document.execCommand('copy'); ta.remove()
  }
  copied.value[key] = true; setTimeout(() => (copied.value[key] = false), 1600)
}
function downloadJs() {
  if (!cfg.value) return
  downloadText(widgetFileName(cfg.value), scriptCode.value, 'application/javascript')
}
function downloadDemo() {
  if (!cfg.value) return
  downloadText(widgetTag(cfg.value) + '-demo.html', standaloneDoc(cfg.value, false), 'text/html')
}

/* ---------- 数据面板 ---------- */
function openData() {
  if (!cfg.value) return
  submissions.value = listPreviewSubmissions(cfg.value.id) as WidgetSubmission[]
  step.value = 'data'
}
function exportCSV() {
  if (!cfg.value) return
  if (!access.value.pro) { flash('CSV 导出为专业版功能'); return }
  const rows = submissions.value as unknown as Array<Record<string, unknown>>
  const csv = toCSV(rows)
  if (!csv) { flash('暂无可导出的测试数据'); return }
  downloadText(submissionFileName(cfg.value, 'csv'), csv, 'text/csv')
}
function clearData() {
  if (!cfg.value || !confirm('清空该组件的本地测试提交记录？')) return
  clearPreviewSubmissions(cfg.value.id)
  submissions.value = []
}

/* ---------- 接收预览 iframe 的提交 ---------- */
function onMessage(e: MessageEvent) {
  const d = e.data
  if (d && d.__fzWidget === 'submit' && cfg.value && String(d.id) === String(cfg.value.id)) {
    addPreviewSubmission(d.data as WidgetSubmission)
    submissions.value = listPreviewSubmissions(cfg.value.id) as WidgetSubmission[]
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

function fmtTime(ts: number) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }) }
</script>

<template>
  <div class="ewb">
    <header class="top">
      <div>
        <h1>{{ manifest.name }}</h1>
        <p class="sub">{{ manifest.tagline }}</p>
      </div>
      <div class="pro-badge" :class="{ on: access.pro }">
        <span v-if="access.pro">● 专业版已解锁</span>
        <button v-else class="btn-up" :disabled="upgrading" @click="onUpgrade">
          {{ upgrading ? '处理中…' : '升级专业版 ' + access.priceText + '（买断）' }}
        </button>
      </div>
    </header>

    <nav class="steps">
      <button v-for="s in STEPS" :key="s.key" class="step" :class="{ active: step === s.key, disabled: !cfg && s.key !== 'list' }"
        @click="cfg && (step = s.key)">{{ s.label }}</button>
    </nav>
    <transition name="fade"><p v-if="notice" class="notice">{{ notice }}</p></transition>

    <!-- 步骤1：我的组件 + 选模板 -->
    <section v-if="step === 'list'" class="panel">
      <div v-if="instances.length" class="mine">
        <h2>我的组件 <span class="muted">（{{ instances.length }}<template v-if="!access.pro">/{{ FREE_INSTANCE_LIMIT }}</template>）</span></h2>
        <div class="mine-grid">
          <div v-for="c in instances" :key="c.id" class="mine-card">
            <div class="mine-title">{{ templateOf(c.kind).emoji }} {{ c.title }}</div>
            <div class="mine-tag">{{ widgetTag(c) }}</div>
            <div class="mine-actions">
              <button class="mini" @click="editInstance(c)">编辑</button>
              <button class="mini" @click="cfg = c; gotoPreview()">预览/数据</button>
              <button class="mini danger" @click="removeInstance(c)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <h2>选择模板新建</h2>
      <div class="tpl-grid">
        <button v-for="t in TEMPLATES" :key="t.kind" class="tpl" @click="startTemplate(t)">
          <div class="tpl-emoji">{{ t.emoji }}</div>
          <div class="tpl-name">{{ t.name }}<span v-if="t.pro" class="pro-tag">Pro</span></div>
          <div class="tpl-desc">{{ t.desc }}</div>
        </button>
      </div>
      <p class="muted small">免费版含前 3 类基础模板、最多保存 {{ FREE_INSTANCE_LIMIT }} 个组件；价格计算器、倒计时、去角标、不限数量与 CSV 导出为专业版功能。</p>
    </section>

    <!-- 步骤2：配置 -->
    <section v-else-if="step === 'config' && cfg" class="panel cfg">
      <div class="cfg-main">
        <h2>基础信息</h2>
        <label>组件标题<input v-model="cfg.title"></label>
        <label>描述 / 引导语<textarea v-model="cfg.description" rows="2"></textarea></label>
        <div class="row2">
          <label v-if="cfg.kind !== 'countdown'">提交按钮文字<input v-model="cfg.submitLabel"></label>
          <label v-if="cfg.kind !== 'countdown'">成功提示<input v-model="cfg.successText"></label>
        </div>

        <!-- contact 字段编辑 -->
        <template v-if="cfg.kind === 'contact'">
          <h2>表单字段 <button class="mini" @click="addField">+ 增加字段</button></h2>
          <div v-for="(f, i) in cfg.fields" :key="f.id" class="field-row">
            <input v-model="f.label" placeholder="字段标题" class="grow">
            <input v-model="f.name" placeholder="数据键名(英文)" class="key" pattern="[a-zA-Z0-9_]">
            <select :value="f.type" @change="onFieldType(f, ($event.target as HTMLSelectElement).value as FieldType)">
              <option v-for="ft in FIELD_TYPES" :key="ft.v" :value="ft.v">{{ ft.label }}</option>
            </select>
            <label class="chk"><input type="checkbox" v-model="f.required">必填</label>
            <button class="mini danger" @click="removeField(i)">删</button>
          </div>
        </template>

        <!-- feedback 选项 -->
        <template v-else-if="cfg.kind === 'feedback'">
          <h2>评价选项（每行一个）</h2>
          <textarea v-model="choicesText" rows="4" class="mono"></textarea>
        </template>

        <!-- rating -->
        <template v-else-if="cfg.kind === 'rating'">
          <h2>评分设置</h2>
          <div class="row2">
            <label>星级上限（3–10）<input type="number" min="3" max="10" v-model.number="cfg.max"></label>
            <label>低端文案<input v-model="cfg.lowLabel"></label>
          </div>
          <label>高端文案<input v-model="cfg.highLabel"></label>
        </template>

        <!-- calculator -->
        <template v-else-if="cfg.kind === 'calculator' && cfg.calc">
          <h2>计价规则 <span class="muted small">合计 = 数量 × 单价 + 固定费用</span></h2>
          <div class="row2">
            <label>数量项名称<input v-model="cfg.calc.qtyLabel"></label>
            <label>货币符号<input v-model="cfg.calc.currency" maxlength="3"></label>
          </div>
          <div class="row3">
            <label>默认数量<input type="number" min="0" v-model.number="cfg.calc.qtyDefault"></label>
            <label>单价<input type="number" min="0" step="0.01" v-model.number="cfg.calc.unitPrice"></label>
            <label>固定费用<input type="number" min="0" step="0.01" v-model.number="cfg.calc.fixedFee"></label>
          </div>
        </template>

        <!-- countdown -->
        <template v-else-if="cfg.kind === 'countdown' && cfg.countdown">
          <h2>倒计时设置</h2>
          <div class="row2">
            <label>目标时间<input type="datetime-local" v-model="cfg.countdown.targetAt"></label>
            <label class="chk col"><input type="checkbox" v-model="cfg.countdown.showSeconds">显示秒</label>
          </div>
          <label>到期文案<input v-model="cfg.countdown.completeText"></label>
        </template>

        <div class="cfg-actions">
          <button class="btn-ghost" @click="step = 'list'">返回</button>
          <button class="btn-primary" @click="gotoPreview">保存并预览 →</button>
        </div>
      </div>

      <!-- 主题 -->
      <aside class="cfg-side">
        <h2>主题样式</h2>
        <label>品牌主色
          <div class="swatches">
            <button v-for="c in THEME_PRESETS" :key="c" class="sw" :style="{ background: c }"
              :class="{ on: cfg.theme.primary === c }" @click="cfg.theme.primary = c"></button>
            <input type="color" v-model="cfg.theme.primary" class="colorpick">
          </div>
        </label>
        <label>圆角 <span class="muted">{{ cfg.theme.radius }}px</span>
          <input type="range" min="0" max="24" v-model.number="cfg.theme.radius"></label>
        <label class="chk"><input type="checkbox" :checked="cfg.poweredBy" :disabled="!access.pro"
          @change="cfg.poweredBy = ($event.target as HTMLInputElement).checked">
          显示「由方子生成」角标 <span v-if="!access.pro" class="pro-tag">Pro 可关闭</span></label>
        <p class="muted small">组件标签：<code>{{ widgetTag(cfg) }}</code></p>
      </aside>
    </section>

    <!-- 步骤3：预览 -->
    <section v-else-if="step === 'preview' && cfg" class="panel">
      <div class="preview-bar">
        <button class="btn-ghost" @click="step = 'config'">← 继续配置</button>
        <button class="btn-ghost" @click="gotoPreview">刷新预览</button>
        <button class="btn-primary" @click="step = 'embed'">下一步：嵌入代码 →</button>
      </div>
      <div class="preview-wrap">
        <iframe class="preview-frame" title="组件实时预览" :srcdoc="previewHtml" sandbox="allow-scripts allow-forms allow-popups"></iframe>
        <aside class="preview-side">
          <h2>测试提交 <span class="muted">（{{ submissions.length }}）</span></h2>
          <p class="muted small">在左侧真实组件中操作并提交，数据会显示在这里。</p>
          <ul class="sub-list">
            <li v-for="(s, i) in submissions" :key="i"><code>{{ JSON.stringify(s) }}</code></li>
            <li v-if="!submissions.length" class="muted small">还没有测试提交</li>
          </ul>
          <button class="mini" @click="openData">前往数据面板</button>
        </aside>
      </div>
    </section>

    <!-- 步骤4：嵌入导出 -->
    <section v-else-if="step === 'embed' && cfg" class="panel">
      <h2>1. 下载组件脚本（单文件、零依赖）</h2>
      <p class="muted small">文件名 <code>{{ widgetFileName(cfg) }}</code>，约 {{ (scriptBytes / 1024).toFixed(1) }} KB。上传到你站点任意静态目录（如 /widgets/v1/）。</p>
      <div class="btnrow">
        <button class="btn-primary" @click="downloadJs">下载 .js 脚本</button>
        <button class="btn-ghost" @click="downloadDemo">下载可直接打开的 demo.html</button>
      </div>

      <h2>2. 复制两段嵌入代码</h2>
      <label class="hostbase">脚本托管域名（留空 = 相对路径，脚本与页面同目录）
        <input v-model="hostBase" placeholder="https://your-site.com"></label>
      <pre class="code"><code>{{ embedCode }}</code></pre>
      <button class="mini" @click="copy('embed', embedCode)">{{ copied.embed ? '已复制 ✓' : '复制嵌入代码' }}</button>

      <h2>脚本内容（可自查 / 自行托管）</h2>
      <pre class="code src"><code>{{ scriptCode }}</code></pre>
      <div class="btnrow">
        <button class="mini" @click="copy('src', scriptCode)">{{ copied.src ? '已复制 ✓' : '复制脚本源码' }}</button>
        <button class="btn-ghost" @click="step = 'preview'">← 返回预览</button>
      </div>
      <p class="muted small">组件标签 <code>{{ tag }}</code>。React / Vue / 原生 HTML / WordPress 自定义 HTML 块均可直接粘贴；Shadow DOM 保证样式与宿主站点互不污染。数据默认保存在访问者浏览器，可给标签加 <code>data-endpoint="https://你的接口"</code> 把提交 POST 到自有服务。</p>
    </section>

    <!-- 步骤5：数据 -->
    <section v-else-if="step === 'data' && cfg" class="panel">
      <div class="preview-bar">
        <h2 style="margin:0">「{{ cfg.title }}」的本地测试数据（{{ submissions.length }}）</h2>
        <div>
          <button class="btn-primary" @click="exportCSV">导出 CSV <span v-if="!access.pro" class="pro-tag">Pro</span></button>
          <button class="btn-ghost" @click="clearData">清空</button>
        </div>
      </div>
      <p class="muted small">说明：组件正式嵌入第三方站点后，提交数据存于访问者/宿主站点本地或你配置的 data-endpoint，受浏览器同源策略限制不会跨域回流到本生成器；这里汇总的是你在「预览」中产生的测试提交。</p>
      <table class="data-table">
        <thead><tr><th>时间</th><th>类型</th><th>内容（JSON）</th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in submissions" :key="i"><td>{{ fmtTime(s.ts) }}</td><td>{{ s.kind }}</td><td><code>{{ JSON.stringify(s) }}</code></td></tr>
          <tr v-if="!submissions.length"><td colspan="3" class="muted">暂无数据，可到「预览」提交测试。</td></tr>
        </tbody>
      </table>
      <button class="btn-ghost" @click="step = 'list'">返回我的组件</button>
    </section>
  </div>
</template>

<style scoped>
.ewb { max-width: 1080px; margin: 0 auto; padding: 4px 0 40px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.top h1 { font-size: 22px; margin: 0 0 6px; }
.sub { color: #6b7280; font-size: 13px; margin: 0; max-width: 720px; }
.btn-up { background: #0f7a4f; color: #fff; border: 0; border-radius: 8px; padding: 9px 14px; font-weight: 700; cursor: pointer; }
.btn-up:disabled { opacity: .6; cursor: default; }
.pro-badge.on { color: #0f7a4f; font-weight: 700; font-size: 13px; }
.steps { display: flex; gap: 6px; margin: 16px 0; flex-wrap: wrap; }
.step { border: 1px solid #e5e7eb; background: #fff; border-radius: 999px; padding: 7px 14px; font-size: 13px; cursor: pointer; color: #4b5563; }
.step.active { background: #111827; color: #fff; border-color: #111827; }
.step.disabled { opacity: .45; cursor: not-allowed; }
.notice { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 9px 12px; border-radius: 8px; font-size: 13px; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px; }
.panel h2 { font-size: 15px; margin: 18px 0 10px; display: flex; align-items: center; gap: 10px; }
.panel h2:first-child { margin-top: 0; }
.muted { color: #9ca3af; font-weight: 400; }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.tpl { text-align: left; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; background: #fff; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.tpl:hover { border-color: #0f7a4f; box-shadow: 0 4px 14px rgba(15, 122, 79, .12); }
.tpl-emoji { font-size: 26px; }
.tpl-name { font-weight: 700; margin: 6px 0 3px; display: flex; align-items: center; gap: 6px; }
.tpl-desc { font-size: 12px; color: #6b7280; line-height: 1.5; }
.pro-tag { background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 700; border-radius: 5px; padding: 1px 5px; }
.mine { margin-bottom: 22px; }
.mine-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.mine-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
.mine-title { font-weight: 700; font-size: 14px; }
.mine-tag { font-family: ui-monospace, monospace; font-size: 11px; color: #9ca3af; margin: 3px 0 9px; }
.mine-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.cfg { display: grid; grid-template-columns: 1fr 260px; gap: 24px; }
.cfg label { display: block; font-size: 13px; font-weight: 600; margin: 10px 0; }
.cfg input[type="text"], .cfg input:not([type]), .cfg input[type="number"], .cfg input[type="datetime-local"], .cfg textarea, .cfg select {
  width: 100%; box-sizing: border-box; margin-top: 5px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; font-weight: 400; }
.cfg textarea { resize: vertical; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.field-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.field-row .grow { flex: 2; min-width: 120px; }
.field-row .key { flex: 1; min-width: 110px; font-family: ui-monospace, monospace; }
.field-row select { width: auto; margin: 0; padding: 8px; }
.chk { display: flex; align-items: center; gap: 7px; font-weight: 500 !important; }
.chk.col { justify-content: center; }
.chk input { width: auto !important; margin: 0 !important; }
.cfg-side { border-left: 1px solid #f1f2f4; padding-left: 22px; }
.swatches { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
.sw { width: 26px; height: 26px; border-radius: 7px; border: 2px solid #fff; box-shadow: 0 0 0 1px #e5e7eb; cursor: pointer; }
.sw.on { box-shadow: 0 0 0 2px #111827; }
.colorpick { width: 34px !important; height: 30px; padding: 0 !important; border: 0; }
.cfg-actions { display: flex; justify-content: space-between; margin-top: 22px; }
.btn-primary, .btn-ghost { border-radius: 9px; padding: 10px 16px; font-weight: 700; font-size: 14px; cursor: pointer; }
.btn-primary { background: #0f7a4f; color: #fff; border: 1px solid #0f7a4f; }
.btn-ghost { background: #fff; color: #374151; border: 1px solid #d1d5db; }
.mini { border: 1px solid #d1d5db; background: #fff; border-radius: 7px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.mini.danger { color: #dc2626; border-color: #fecaca; }
.btnrow { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 4px; }
.preview-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.preview-wrap { display: grid; grid-template-columns: 1fr 280px; gap: 18px; }
.preview-frame { width: 100%; height: 560px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f3f4f6; }
.preview-side h2 { margin-top: 0; }
.sub-list { list-style: none; padding: 0; margin: 0 0 10px; max-height: 420px; overflow: auto; }
.sub-list li { border-bottom: 1px solid #f3f4f6; padding: 6px 0; word-break: break-all; }
.sub-list code { font-size: 11px; color: #374151; }
.hostbase { font-size: 13px; font-weight: 600; display: block; margin: 8px 0; }
.hostbase input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; font-weight: 400; }
.code { background: #0b1020; color: #d7e0ff; border-radius: 10px; padding: 14px; font-size: 12.5px; overflow: auto; margin: 8px 0; }
.code.src { max-height: 340px; }
.code code { white-space: pre; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.data-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
.data-table th, .data-table td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
.data-table th { background: #f9fafb; }
.data-table code { white-space: normal; word-break: break-all; }
@media (max-width: 860px) {
  .cfg, .preview-wrap { grid-template-columns: 1fr; }
  .cfg-side { border-left: 0; padding-left: 0; border-top: 1px solid #f1f2f4; padding-top: 16px; }
  .row2, .row3 { grid-template-columns: 1fr; }
  .preview-frame { height: 460px; }
}
</style>
