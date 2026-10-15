<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { manifest } from './manifest'
import { useSeo } from '@/composables/useSeo'
import { useToolBilling } from '@/composables/useToolBilling'
import {
  emptyModel, tagNameOf, isValidTagName, camelToKebab,
  type ComponentModel, type PropType
} from './lib/model'
import { nativeSource, nativeFileName } from './lib/generate/native'
import { litSource, litFileName } from './lib/generate/lit'
import { reactSource, reactFileName, vueSource, vueFileName } from './lib/generate/wrappers'
import { manifestJson } from './lib/manifest-gen'
import { docsMarkdown, docsFileName, demoHtml } from './lib/docs'
import { previewDoc } from './lib/preview'
import {
  freeFiles, proFiles, buildZip, zipName,
  downloadBlob, downloadText, modelToJson, modelFileName
} from './lib/export'
import { listModels, saveModelBilling, deleteModel, parseModelJson, FREE_LIBRARY_LIMIT } from './lib/storage'
import { buildAccess, upgrade } from './lib/monetization'

useSeo({
  title: '跨框架组件库工作台 - 可视化生成 Lit / 原生 Web Component 与 React/Vue 适配',
  description:
    '浏览器内可视化定义属性、事件、插槽与 CSS 变量主题，一次建模同时生成零依赖原生 Web Component、Lit 3 组件、React/Vue wrapper、API 文档与 custom-elements.json，Shadow DOM 实时预览，一键打包 npm 包，写一次跨 React/Vue/Angular/老系统到处用。',
  type: 'SoftwareApplication',
  keywords: manifest.keywords,
  jsonLd: { offers: { '@type': 'Offer', price: '49.9', priceCurrency: 'CNY' } }
})

const billing = useToolBilling(manifest.id)
const access = ref(buildAccess(billing))
watch(billing.billingVersion, () => { access.value = buildAccess(billing) })

/* ---------------- 视图与模型 ---------------- */
const view = ref<'library' | 'studio'>('library')
const library = ref<ComponentModel[]>(listModels())
const model = ref<ComponentModel>(emptyModel())
const notice = ref('')
const upgrading = ref(false)

function flash(msg: string) {
  notice.value = msg
  setTimeout(() => { if (notice.value === msg) notice.value = '' }, 2800)
}
async function onUpgrade() {
  upgrading.value = true
  try { await upgrade(billing); access.value = buildAccess(billing); flash('已解锁专业版') }
  finally { upgrading.value = false }
}

const tag = computed(() => tagNameOf(model.value))
const tagValid = computed(() => isValidTagName(tag.value))

function newModel() {
  model.value = emptyModel()
  enterStudio()
}
function openModel(m: ComponentModel) {
  model.value = JSON.parse(JSON.stringify(m)) as ComponentModel
  enterStudio()
}
function enterStudio() {
  view.value = 'studio'
  eventLog.value = []
  rebuildLiveProps(true)
}
function backToLibrary() {
  view.value = 'library'
  library.value = listModels()
}
function saveLibrary() {
  const r = saveModelBilling(model.value, access.value.pro)
  if (!r.saved) { flash(r.reason || '保存失败，升级专业版可不限数量'); return }
  library.value = listModels()
  flash('已保存到本地组件库')
}
function removeFromLibrary(t: string) {
  if (!confirm('确定从本地组件库删除该组件？（仅删除本地记录，已导出的文件不受影响）')) return
  deleteModel(t)
  library.value = listModels()
}

/* ---------------- 建模编辑 ---------------- */
const PROP_TYPES: { v: PropType; label: string }[] = [
  { v: 'string', label: 'string' },
  { v: 'number', label: 'number' },
  { v: 'boolean', label: 'boolean' }
]
function onClassName() { model.value.className = model.value.className || 'MyComponent' }
function onPrefix() { model.value.prefix = model.value.prefix || 'wc' }
function onPropName(p: ComponentModel['properties'][number]) {
  p.name = p.name.replace(/[^A-Za-z0-9_$]/g, '')
  p.attr = camelToKebab(p.name)
}
function addProp() {
  const used = new Set(model.value.properties.map((p) => p.name))
  let i = model.value.properties.length + 1
  let name = 'prop' + i
  while (used.has(name)) name = 'prop' + ++i
  model.value.properties.push({ name, attr: camelToKebab(name), type: 'string', default: '', description: '' })
}
function removeProp(i: number) { model.value.properties.splice(i, 1) }
function addEvent() { model.value.events.push({ name: 'event-' + (model.value.events.length + 1), detail: '{}', description: '' }) }
function removeEvent(i: number) { model.value.events.splice(i, 1) }
function addSlot() { model.value.slots.push({ name: 'slot-' + (model.value.slots.length + 1), description: '' }) }
function removeSlot(i: number) { model.value.slots.splice(i, 1) }
function addVar() { model.value.cssVars.push({ name: 'color-' + (model.value.cssVars.length + 1), default: '#333333', description: '' }) }
function removeVar(i: number) { model.value.cssVars.splice(i, 1) }

/* ---------------- 生成产物 ---------------- */
const nativeCode = computed(() => nativeSource(model.value))
const litCode = computed(() => litSource(model.value))
const reactCode = computed(() => reactSource(model.value))
const vueCode = computed(() => vueSource(model.value))
const docsCode = computed(() => docsMarkdown(model.value))
const cemCode = computed(() => manifestJson(model.value))

interface CodeTab { key: string; label: string; pro: boolean; lang: string }
const CODE_TABS: CodeTab[] = [
  { key: 'native', label: '原生 JS', pro: false, lang: 'javascript' },
  { key: 'lit', label: 'Lit + TS', pro: true, lang: 'typescript' },
  { key: 'react', label: 'React', pro: true, lang: 'tsx' },
  { key: 'vue', label: 'Vue', pro: true, lang: 'typescript' },
  { key: 'docs', label: 'API 文档', pro: false, lang: 'markdown' },
  { key: 'cem', label: 'manifest', pro: false, lang: 'json' }
]
const codeTab = ref<string>('native')
const activeTab = computed(() => CODE_TABS.find((t) => t.key === codeTab.value)!)
const activeCode = computed(() => {
  switch (codeTab.value) {
    case 'lit': return { code: litCode.value, file: litFileName(model.value), mime: 'text/typescript' }
    case 'react': return { code: reactCode.value, file: reactFileName(model.value), mime: 'text/typescript' }
    case 'vue': return { code: vueCode.value, file: vueFileName(model.value), mime: 'text/typescript' }
    case 'docs': return { code: docsCode.value, file: docsFileName(model.value), mime: 'text/markdown' }
    case 'cem': return { code: cemCode.value, file: 'custom-elements.json', mime: 'application/json' }
    default: return { code: nativeCode.value, file: nativeFileName(model.value), mime: 'application/javascript' }
  }
})
const activeLocked = computed(() => activeTab.value.pro && !access.value.pro)

/* ---------------- 实时预览（srcdoc + postMessage） ---------------- */
const frame = ref<HTMLIFrameElement | null>(null)
const frameReady = ref(false)
const liveProps = ref<Record<string, string>>({})
const eventLog = ref<string[]>([])
const previewHtml = computed(() => previewDoc(model.value))

function rawDefault(type: PropType, d: string): string {
  if (type === 'boolean') return String(d).trim().toLowerCase() === 'true' ? 'true' : 'false'
  return d
}
function rebuildLiveProps(resetAll: boolean) {
  const next: Record<string, string> = resetAll ? {} : { ...liveProps.value }
  for (const p of model.value.properties) {
    if (!(p.name in next)) next[p.name] = rawDefault(p.type, p.default)
  }
  for (const k of Object.keys(next)) {
    if (!model.value.properties.some((p) => p.name === k)) delete next[k]
  }
  liveProps.value = next
}
function sendProps() {
  const w = frame.value?.contentWindow
  // postMessage 使用结构化克隆，不能传 Vue reactive 代理，否则抛 DataCloneError；
  // 属性值均为原始类型，浅拷贝成普通对象即可（同 reusable-module/worker-post 的教训）。
  if (w) w.postMessage({ type: 'fz-set-props', props: { ...liveProps.value } }, '*')
}
function onFrameLoad() {
  frameReady.value = false
  const w = frame.value?.contentWindow
  // 主动 ping：子文档就绪后会回 ready（子文档也会自重发，双向消除竞态）
  if (w) w.postMessage({ type: 'fz-ping' }, '*')
  setTimeout(sendProps, 60)
}
function setLive(name: string, val: string) { liveProps.value = { ...liveProps.value, [name]: val } }
watch(liveProps, () => sendProps(), { deep: true })
watch(
  () => model.value.properties.map((p) => p.name).join(','),
  () => rebuildLiveProps(false)
)

function onMessage(e: MessageEvent) {
  const d = e.data
  if (!d || typeof d !== 'object') return
  if (d.__fzWidget === 'ready') { frameReady.value = true; sendProps() }
  else if (d.__fzWidget === 'event') {
    eventLog.value = [`${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${d.name}  ${JSON.stringify(d.detail ?? {})}`, ...eventLog.value].slice(0, 30)
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

/* ---------------- 复制 / 下载 / 导入 ---------------- */
const copied = ref(false)
async function copyActive() {
  if (activeLocked.value) { flash('该产物为专业版功能'); return }
  try { await navigator.clipboard.writeText(activeCode.value.code) }
  catch {
    const ta = document.createElement('textarea'); ta.value = activeCode.value.code; document.body.appendChild(ta)
    ta.select(); document.execCommand('copy'); ta.remove()
  }
  copied.value = true; setTimeout(() => (copied.value = false), 1500)
}
function downloadActive() {
  if (activeLocked.value) { flash('该产物为专业版功能，请先解锁'); return }
  downloadText(activeCode.value.code, activeCode.value.file, activeCode.value.mime)
}
function downloadNative() { downloadText(nativeCode.value, nativeFileName(model.value), 'application/javascript') }
function downloadDemo() { downloadText(demoHtml(model.value), `${tag.value}.demo.html`, 'text/html') }
function downloadFreeZip() {
  downloadBlob(buildZip(freeFiles(model.value)), zipName(model.value, false), 'application/zip')
}
function downloadProZip() {
  if (!access.value.pro) { flash('完整 npm 包（Lit + React/Vue wrapper）为专业版功能'); return }
  downloadBlob(buildZip(proFiles(model.value)), zipName(model.value, true), 'application/zip')
}
function downloadModel() { downloadText(modelToJson(model.value), modelFileName(model.value), 'application/json') }
const fileInput = ref<HTMLInputElement | null>(null)
function triggerImport() { fileInput.value?.click() }
async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  try {
    const text = await f.text()
    const m = parseModelJson(text)
    model.value = m
    enterStudio()
    flash('已导入模型：' + tagNameOf(m))
  } catch (err) {
    flash('导入失败：' + ((err as Error).message || '模型文件无效'))
  }
  finally { input.value = '' }
}
</script>

<template>
  <div class="wcb">
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
    <transition name="fade"><p v-if="notice" class="notice">{{ notice }}</p></transition>

    <!-- ============ 组件库 ============ -->
    <section v-if="view === 'library'" class="panel">
      <div class="lib-bar">
        <h2 style="margin:0">我的组件库 <span class="muted">（{{ library.length }}<template v-if="!access.pro">/{{ FREE_LIBRARY_LIMIT }}</template>）</span></h2>
        <div class="btnrow">
          <button class="btn-primary" @click="newModel">＋ 新建组件</button>
          <button class="btn-ghost" @click="triggerImport">导入模型 .json</button>
          <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onImportFile">
        </div>
      </div>
      <div v-if="library.length" class="lib-grid">
        <div v-for="m in library" :key="tagNameOf(m)" class="lib-card">
          <div class="lib-name">{{ m.className }}</div>
          <div class="lib-tag">&lt;{{ tagNameOf(m) }}&gt;</div>
          <div class="lib-meta muted">{{ m.properties.length }} 属性 · {{ m.events.length }} 事件 · {{ m.slots.length }} 插槽 · {{ m.cssVars.length }} 变量</div>
          <div class="lib-actions">
            <button class="mini" @click="openModel(m)">在工作台打开</button>
            <button class="mini danger" @click="removeFromLibrary(tagNameOf(m))">删除</button>
          </div>
        </div>
      </div>
      <p v-else class="muted small empty-hint">还没有组件。点击「新建组件」开始可视化建模：定义属性、事件、插槽与主题，左侧建模、中间实时预览、右侧直接拿可运行代码。</p>
      <p class="muted small">免费版可生成零依赖原生 Web Component、API 文档与 custom-elements.json，本地保存 {{ FREE_LIBRARY_LIMIT }} 个；Lit 生成、React/Vue wrapper 与完整 npm 包打包为专业版。</p>
    </section>

    <!-- ============ 工作台 ============ -->
    <section v-else class="studio">
      <div class="studio-bar">
        <button class="btn-ghost" @click="backToLibrary">← 返回组件库</button>
        <div class="tag-info">
          <span class="lib-name">{{ model.className }}</span>
          <code :class="{ bad: !tagValid }">&lt;{{ tag }}&gt;</code>
          <span v-if="!tagValid" class="warn">标签需为全小写且含连字符</span>
        </div>
        <div class="btnrow">
          <button class="btn-ghost" @click="downloadModel">导出模型</button>
          <button class="btn-primary" @click="saveLibrary">保存到组件库</button>
        </div>
      </div>

      <div class="grid3">
        <!-- 左：建模表单 -->
        <div class="col form-col">
          <h3>基础信息</h3>
          <label>类名（PascalCase）<input :value="model.className" @input="model.className = ($event.target as HTMLInputElement).value" @blur="onClassName"></label>
          <label>标签前缀 / 命名空间<input :value="model.prefix" @input="model.prefix = ($event.target as HTMLInputElement).value" @blur="onPrefix"></label>
          <label>组件描述<textarea rows="2" v-model="model.description"></textarea></label>

          <div class="seg-head">
            <h3>属性 Properties</h3><button class="mini" @click="addProp">＋</button>
          </div>
          <div v-for="(p, i) in model.properties" :key="'p' + i" class="card">
            <div class="card-row">
              <input v-model="p.name" placeholder="属性名 camelCase" class="grow mono" @change="onPropName(p)">
              <select v-model="p.type">
                <option v-for="t in PROP_TYPES" :key="t.v" :value="t.v">{{ t.label }}</option>
              </select>
              <button class="mini danger" @click="removeProp(i)">删</button>
            </div>
            <input v-model="p.attr" placeholder="attribute（自动派生，可改）" class="mono attr">
            <input v-model="p.default" :placeholder="p.type === 'boolean' ? '默认值 true/false' : '默认值'">
            <input v-model="p.description" placeholder="属性说明（写入文档 / manifest）">
          </div>
          <p v-if="!model.properties.length" class="muted small">无属性</p>

          <div class="seg-head">
            <h3>事件 Events</h3><button class="mini" @click="addEvent">＋</button>
          </div>
          <div v-for="(e, i) in model.events" :key="'e' + i" class="card">
            <div class="card-row">
              <input v-model="e.name" placeholder="事件名 kebab-case" class="grow mono">
              <button class="mini danger" @click="removeEvent(i)">删</button>
            </div>
            <input v-model="e.detail" placeholder="detail 字段，如 { value: string }" class="mono">
            <input v-model="e.description" placeholder="事件说明">
          </div>
          <p v-if="!model.events.length" class="muted small">无事件</p>

          <div class="seg-head">
            <h3>插槽 Slots</h3><button class="mini" @click="addSlot">＋</button>
          </div>
          <div v-for="(s, i) in model.slots" :key="'s' + i" class="card">
            <div class="card-row">
              <input v-model="s.name" placeholder="插槽名（留空=默认插槽）" class="grow mono">
              <button class="mini danger" @click="removeSlot(i)">删</button>
            </div>
            <input v-model="s.description" placeholder="插槽说明">
          </div>
          <p v-if="!model.slots.length" class="muted small">无插槽</p>

          <div class="seg-head">
            <h3>CSS 变量主题</h3><button class="mini" @click="addVar">＋</button>
          </div>
          <div v-for="(v, i) in model.cssVars" :key="'v' + i" class="card">
            <div class="card-row">
              <input v-model="v.name" placeholder="变量名（不含 --）" class="grow mono">
              <button class="mini danger" @click="removeVar(i)">删</button>
            </div>
            <div class="card-row">
              <input v-model="v.default" placeholder="默认值" class="grow">
              <input v-model="v.description" placeholder="说明" class="grow">
            </div>
          </div>
          <p v-if="!model.cssVars.length" class="muted small">无 CSS 变量</p>
        </div>

        <!-- 中：实时预览 -->
        <div class="col preview-col">
          <h3>实时预览 <span class="muted" :class="{ ok: frameReady }">{{ frameReady ? '· 已连接' : '· 加载中' }}</span></h3>
          <iframe ref="frame" class="frame" title="组件实时预览" :srcdoc="previewHtml" sandbox="allow-scripts allow-forms allow-popups" @load="onFrameLoad"></iframe>

          <h3>属性试值 <span class="muted small">（实时写入组件，不改动默认值）</span></h3>
          <div v-for="p in model.properties" :key="'l' + p.name" class="live-row">
            <label class="live-name">{{ p.name }}</label>
            <input v-if="p.type === 'boolean'" type="checkbox"
              :checked="liveProps[p.name] === 'true'"
              @change="setLive(p.name, ($event.target as HTMLInputElement).checked ? 'true' : 'false')">
            <input v-else-if="p.type === 'number'" type="number" :value="liveProps[p.name] ?? ''"
              @input="setLive(p.name, ($event.target as HTMLInputElement).value)">
            <input v-else type="text" :value="liveProps[p.name] ?? ''"
              @input="setLive(p.name, ($event.target as HTMLInputElement).value)">
          </div>
          <p v-if="!model.properties.length" class="muted small">该组件没有可试值的属性</p>

          <h3>事件日志</h3>
          <pre class="eventlog"><template v-if="eventLog.length"><div v-for="(l, i) in eventLog" :key="i">{{ l }}</div></template><span v-else class="muted small">在预览中点击组件按钮，自定义事件会显示在这里（bubbles + composed，可跨越 Shadow DOM）。</span></pre>
        </div>

        <!-- 右：代码与导出 -->
        <div class="col code-col">
          <div class="tabs">
            <button v-for="t in CODE_TABS" :key="t.key" class="tab" :class="{ active: codeTab === t.key }" @click="codeTab = t.key">
              {{ t.label }}<span v-if="t.pro" class="pro-tag">Pro</span>
            </button>
          </div>
          <div class="code-wrap">
            <pre class="code"><code>{{ activeLocked ? '' : activeCode.code }}</code></pre>
            <div v-if="activeLocked" class="lock">
              <div class="lock-inner">
                <div class="lock-title">{{ activeTab.label }} 为专业版功能</div>
                <p class="muted small">升级后可生成 {{ activeTab.label }} 源码，并在完整 npm 包中批量导出。</p>
                <button class="btn-up" :disabled="upgrading" @click="onUpgrade">{{ upgrading ? '处理中…' : '解锁专业版 ' + access.priceText }}</button>
              </div>
            </div>
          </div>
          <div class="btnrow">
            <button class="mini" :disabled="activeLocked" @click="copyActive">{{ copied ? '已复制 ✓' : '复制' }}</button>
            <button class="mini" :disabled="activeLocked" @click="downloadActive">下载此文件</button>
          </div>

          <h3>打包导出</h3>
          <div class="export-list">
            <button class="exp" @click="downloadNative"><b>单文件组件 .js</b><span class="muted small">零依赖，&lt;script&gt; 即用 · 免费</span></button>
            <button class="exp" @click="downloadDemo"><b>交互演示页 .html</b><span class="muted small">独立打开，含属性控制面板 · 免费</span></button>
            <button class="exp" @click="downloadFreeZip"><b>最小可用包 .zip</b><span class="muted small">组件 + 文档 + manifest + demo · 免费</span></button>
            <button class="exp pro-exp" @click="downloadProZip"><b>完整 npm 包 .zip <span class="pro-tag">Pro</span></b><span class="muted small">package.json + Lit + React/Vue wrapper + dist · 一次买断</span></button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wcb { max-width: 1280px; margin: 0 auto; padding: 4px 0 40px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.top h1 { font-size: 22px; margin: 0 0 6px; }
.sub { color: #6b7280; font-size: 13px; margin: 0; max-width: 820px; }
.btn-up { background: #0f7a4f; color: #fff; border: 0; border-radius: 8px; padding: 9px 14px; font-weight: 700; cursor: pointer; }
.btn-up:disabled { opacity: .6; cursor: default; }
.pro-badge.on { color: #0f7a4f; font-weight: 700; font-size: 13px; }
.notice { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 9px 12px; border-radius: 8px; font-size: 13px; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px; margin-top: 14px; }
.muted { color: #9ca3af; font-weight: 400; }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
code.bad { background: #fee2e2; color: #b91c1c; }
.warn { color: #dc2626; font-size: 12px; margin-left: 6px; }
.lib-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.btnrow { display: flex; gap: 8px; flex-wrap: wrap; }
.btn-primary, .btn-ghost { border-radius: 9px; padding: 9px 15px; font-weight: 700; font-size: 13px; cursor: pointer; }
.btn-primary { background: #0f7a4f; color: #fff; border: 1px solid #0f7a4f; }
.btn-ghost { background: #fff; color: #374151; border: 1px solid #d1d5db; }
.mini { border: 1px solid #d1d5db; background: #fff; border-radius: 7px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.mini:disabled { opacity: .5; cursor: not-allowed; }
.mini.danger { color: #dc2626; border-color: #fecaca; }
.pro-tag { background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 700; border-radius: 5px; padding: 1px 5px; margin-left: 4px; }
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 16px 0; }
.lib-card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; }
.lib-name { font-weight: 700; font-size: 15px; }
.lib-tag { font-family: ui-monospace, monospace; font-size: 12px; color: #0f7a4f; margin: 4px 0; }
.lib-meta { font-size: 12px; margin-bottom: 10px; }
.lib-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.empty-hint { margin: 18px 0 8px; }
.studio { margin-top: 14px; }
.studio-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 16px; }
.tag-info { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.grid3 { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(280px, 0.9fr) minmax(340px, 1.15fr); gap: 14px; margin-top: 14px; align-items: start; }
.col { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; min-width: 0; }
.col h3 { font-size: 14px; margin: 14px 0 8px; display: flex; align-items: center; gap: 8px; }
.col h3:first-child { margin-top: 0; }
.col label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin: 8px 0; }
.col input[type="text"], .col input:not([type]), .col input[type="number"], .col textarea, .col select {
  width: 100%; box-sizing: border-box; margin-top: 5px; padding: 7px 9px; border: 1px solid #d1d5db; border-radius: 7px; font: inherit; font-weight: 400; }
.col textarea { resize: vertical; }
.seg-head { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; border-top: 1px dashed #eef0f2; padding-top: 8px; }
.seg-head h3 { margin: 0; }
.card { border: 1px solid #eef0f2; border-radius: 9px; padding: 9px; margin: 8px 0; background: #fcfcfd; }
.card-row { display: flex; gap: 7px; align-items: center; margin-bottom: 6px; }
.card-row .grow { flex: 1; min-width: 0; }
.card select { width: auto !important; margin: 0 !important; padding: 7px !important; }
.card .attr { font-size: 11px; margin-bottom: 6px; }
.frame { width: 100%; height: 300px; border: 1px solid #e5e7eb; border-radius: 10px; background: #f3f4f6; }
.live-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f6f7f8; }
.live-name { font-family: ui-monospace, monospace; font-size: 12px; color: #374151; }
.live-row input[type="text"], .live-row input[type="number"] { width: 150px; margin: 0 !important; }
.live-row input[type="checkbox"] { width: 16px; height: 16px; }
.eventlog { background: #0b1020; color: #86efac; border-radius: 9px; padding: 10px; font-size: 11.5px; min-height: 64px; max-height: 150px; overflow: auto; margin: 0; }
.eventlog div { white-space: pre-wrap; word-break: break-all; }
.ok { color: #0f7a4f !important; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.tab { border: 1px solid #e5e7eb; background: #fafafa; border-radius: 7px; padding: 5px 9px; font-size: 12px; cursor: pointer; color: #4b5563; }
.tab.active { background: #111827; color: #fff; border-color: #111827; }
.code-wrap { position: relative; }
.code { background: #0b1020; color: #d7e0ff; border-radius: 10px; padding: 12px; font-size: 11.5px; overflow: auto; margin: 0; height: 340px; }
.code code { background: none; padding: 0; color: inherit; white-space: pre; font-size: 11.5px; }
.lock { position: absolute; inset: 0; border-radius: 10px; background: rgba(11, 16, 32, .82); display: flex; align-items: center; justify-content: center; padding: 16px; }
.lock-inner { text-align: center; color: #e5e7eb; }
.lock-title { font-weight: 700; margin-bottom: 6px; }
.lock-inner .muted { color: #9ca3af; display: block; margin-bottom: 12px; }
.export-list { display: grid; gap: 8px; }
.exp { text-align: left; border: 1px solid #e5e7eb; border-radius: 9px; padding: 10px 12px; background: #fff; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.exp:hover { border-color: #0f7a4f; }
.exp b { font-size: 13px; color: #111827; }
@media (max-width: 1080px) {
  .grid3 { grid-template-columns: 1fr; }
  .frame { height: 360px; }
  .code { height: 280px; }
}
</style>
