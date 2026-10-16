<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { manifest } from './manifest'
import { useSeo } from '@/composables/useSeo'
import { useToolBilling } from '@/composables/useToolBilling'
import { engine } from './lib/engine'
import { ensureEmbedder } from './lib/embedder'
import { listDocs, listConversations, saveConversation, deleteConversation, newId } from './lib/store'
import { detectFormat, UNSUPPORTED_HINT } from './lib/ingest'
import {
  orderedSources,
  saveSourcePref,
  loadSourcePref,
  clearModelCache,
  BUILTIN_SOURCES,
  type SourceId
} from './lib/models'
import type { KBDocument, Conversation, ChatMessage, Citation } from './lib/types'

useSeo({
  title: '本地知识库智能问答 - 文档不出设备的本地 RAG 检索问答',
  description:
    '把合同、研报、笔记等文档拖进浏览器本地建库提问，本地语义模型加关键词混合检索，答案附原文引用，数据全程不出设备、可离线；模型支持多源与自带对象存储。',
  type: 'WebApplication',
  keywords: manifest.keywords,
  jsonLd: { offers: { '@type': 'Offer', price: '49.9', priceCurrency: 'CNY' } }
})

const billing = useToolBilling(manifest.id)
const pro = computed(() => billing.isOwned('freemium-pro') || billing.isOwned('buyout'))
const priceText = billing.priceText(billing.plan.priceCents)

const FREE_DOC_LIMIT = 20

const tab = ref<'docs' | 'chat' | 'settings'>('docs')
const docs = ref<KBDocument[]>([])
const conversations = ref<Conversation[]>([])
const activeConv = ref<Conversation | null>(null)

const notice = ref('')
const busy = ref(false)
const progressText = ref('')
const progressPct = ref(0)
const useSemantic = ref(true)
const semanticReady = ref(false)

function flash(msg: string, ms = 3200) {
  notice.value = msg
  setTimeout(() => { if (notice.value === msg) notice.value = '' }, ms)
}

async function refresh() {
  docs.value = await listDocs()
  conversations.value = await listConversations()
  semanticReady.value = engine.semanticReady()
}

onMounted(refresh)

/* ---------------- 文档导入 ---------------- */
async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  if (!pro.value && docs.value.length >= FREE_DOC_LIMIT) {
    flash(`免费版最多 ${FREE_DOC_LIMIT} 个文档，请先删除或升级专业版`)
    return
  }
  busy.value = true
  // 本批次中语义模型一旦失败，后续文件直接走关键词索引，避免每个文件都重试下载大模型
  let semanticFailed = false
  try {
    for (const file of files) {
      if (!pro.value && docs.value.length >= FREE_DOC_LIMIT) {
        flash(`已达免费版 ${FREE_DOC_LIMIT} 个上限，其余文件未导入`)
        break
      }
      if (!detectFormat(file.name)) {
        flash(`跳过 ${file.name}：${UNSUPPORTED_HINT}`, 5000)
        continue
      }
      progressText.value = `正在导入 ${file.name}`
      progressPct.value = 0
      const text = await file.text()
      const wantSemantic = useSemantic.value && !semanticFailed
      const { degraded } = await engine.ingestFile({ name: file.name, text }, wantSemantic, (p) => {
        progressText.value = `${file.name} · ${p.message}`
        if (p.embed) {
          if (p.embed.phase === 'download' && p.embed.total) {
            progressPct.value = Math.round((p.embed.received / p.embed.total) * 60)
          } else if (p.embed.phase === 'init') {
            progressPct.value = 65
          } else if (p.embed.phase === 'embed' && p.embed.count) {
            progressPct.value = 70 + Math.round((p.embed.done / p.embed.count) * 30)
          }
        } else {
          progressPct.value = Math.min(96, progressPct.value + 8)
        }
      })
      await refresh()
      if (degraded) {
        semanticFailed = true
        flash(`${file.name}：${degraded}`, 7000)
      }
    }
    flash(semanticFailed ? '导入完成（已用关键词检索；稍后可在设置页重试语义模型）' : '导入完成，已建立本地索引')
  } catch (err) {
    flash((err as Error).message || '导入失败', 6000)
  } finally {
    busy.value = false
    progressText.value = ''
    progressPct.value = 0
  }
}

async function removeDoc(id: string) {
  busy.value = true
  try {
    await engine.removeDoc(id)
    await refresh()
    flash('文档及其索引已删除')
  } finally {
    busy.value = false
  }
}

/* ---------------- 问答 ---------------- */
const question = ref('')
const asking = ref(false)
const openCitation = ref<Citation | null>(null)

function newConversation() {
  activeConv.value = {
    id: newId('conv_'),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function openConv(c: Conversation) {
  activeConv.value = c
  tab.value = 'chat'
}

async function ask() {
  const q = question.value.trim()
  if (!q || asking.value) return
  if (!docs.value.length) {
    flash('请先在「文档库」导入文档')
    return
  }
  if (!activeConv.value) newConversation()
  const conv = activeConv.value!
  conv.messages.push({ role: 'user', content: q, at: Date.now() })
  if (conv.title === '新对话') conv.title = q.slice(0, 18)
  question.value = ''
  asking.value = true
  try {
    const res = await engine.ask(q, useSemantic.value)
    const msg: ChatMessage = {
      role: 'assistant',
      content: res.answer,
      at: Date.now(),
      citations: res.citations,
      confidence: res.confidence,
      semantic: res.semantic
    }
    conv.messages.push(msg)
    if (res.lowConfidence) flash('本次结果置信度较低，建议结合引用原文判断', 5000)
    conv.updatedAt = Date.now()
    await saveConversation(conv)
    conversations.value = await listConversations()
    semanticReady.value = engine.semanticReady()
  } catch (err) {
    conv.messages.push({ role: 'assistant', content: '出错了：' + ((err as Error).message || err), at: Date.now() })
  } finally {
    asking.value = false
  }
}

async function removeConv(id: string) {
  await deleteConversation(id)
  if (activeConv.value?.id === id) activeConv.value = null
  await refresh()
}

function exportConv(conv: Conversation) {
  const md =
    `# ${conv.title}\n\n` +
    conv.messages
      .map((m) => (m.role === 'user' ? `## 问\n${m.content}` : `## 答\n${m.content}`))
      .join('\n\n')
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${conv.title.replace(/[\\/:*?"<>|]/g, '_')}.md`
  a.click()
  URL.revokeObjectURL(a.href)
}

/* ---------------- 设置 / 模型源 ---------------- */
const customBase = ref(loadSourcePref()?.customBase ?? '')
const sourceOrder = ref<SourceId[]>(loadSourcePref()?.order ?? ['custom', 'self', 'hf-mirror', 'huggingface'])
const probeMsg = ref('')

function persistSources() {
  saveSourcePref({ customBase: pro.value ? customBase.value : '', order: sourceOrder.value })
  engine.setSources(orderedSources())
}

async function prepareModel() {
  busy.value = true
  probeMsg.value = '正在探测可用模型源并下载模型…'
  try {
    persistSources()
    await engine.pickSources()
    await ensureEmbedder(orderedSources(), (p) => {
      if (p.phase === 'download' && p.total) probeMsg.value = `下载 ${p.file ?? ''} ${Math.round((p.received / p.total) * 100)}%`
      else if (p.phase === 'init') probeMsg.value = '初始化模型…'
    })
    semanticReady.value = true
    probeMsg.value = '语义模型已就绪（已缓存，可离线使用）'
  } catch (err) {
    probeMsg.value = '模型准备失败（可继续使用关键词检索）：' + ((err as Error).message || err)
  } finally {
    busy.value = false
  }
}

async function wipeCache() {
  await clearModelCache()
  semanticReady.value = engine.semanticReady()
  probeMsg.value = '已清除本地模型缓存，下次使用将重新下载'
}

async function upgrade() {
  await billing.buy('freemium-pro')
  await refresh()
}

const sourceLabel: Record<SourceId, string> = {
  custom: '自定义对象存储/CDN',
  self: '方子同源（推荐，国内直连/可离线）',
  'hf-mirror': 'hf-mirror.com（国内镜像）',
  huggingface: 'huggingface.co（官方）'
}
const builtin = BUILTIN_SOURCES
</script>

<template>
  <div class="lkb">
    <header class="top">
      <div>
        <h1>{{ manifest.name }}</h1>
        <p class="sub">{{ manifest.tagline }}</p>
      </div>
      <div class="pro-badge" :class="{ on: pro }">
        <span v-if="pro">● 专业版已解锁</span>
        <button v-else class="btn-up" @click="upgrade">升级专业版 {{ priceText }}（买断）</button>
      </div>
    </header>

    <nav class="tabs">
      <button :class="{ active: tab === 'docs' }" @click="tab = 'docs'">文档库 <i>{{ docs.length }}</i></button>
      <button :class="{ active: tab === 'chat' }" @click="tab = 'chat'">问答</button>
      <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button>
    </nav>

    <transition name="fade"><p v-if="notice" class="notice">{{ notice }}</p></transition>

    <!-- ============ 文档库 ============ -->
    <section v-if="tab === 'docs'" class="panel">
      <div class="bar">
        <h2 style="margin:0">我的本地知识库
          <span class="muted">（{{ docs.length }}<template v-if="!pro">/{{ FREE_DOC_LIMIT }}</template>）</span>
        </h2>
        <div class="btnrow">
          <label class="btn-primary">
            ＋ 导入文档
            <input type="file" multiple accept=".txt,.md,.markdown,.csv,.html,.htm" hidden @change="onFiles">
          </label>
          <label class="chk"><input type="checkbox" v-model="useSemantic"> 启用语义嵌入</label>
        </div>
      </div>

      <div v-if="busy" class="progress">
        <div class="bar-track"><div class="bar-fill" :style="{ width: (progressPct || 30) + '%' }"></div></div>
        <p class="muted small">{{ progressText || '处理中…' }}</p>
      </div>

      <p class="muted small">支持 txt / Markdown / CSV / HTML，全部在本机解析、分块、嵌入与存储，文档内容不上传。PDF / Word 解析将在下一版本提供。</p>

      <table v-if="docs.length" class="doclist">
        <thead><tr><th>文档</th><th>类型</th><th>分块</th><th>大小</th><th></th></tr></thead>
        <tbody>
          <tr v-for="d in docs" :key="d.id">
            <td class="dn">{{ d.name }}</td>
            <td>{{ d.format }}</td>
            <td>{{ d.chunkCount }}</td>
            <td>{{ (d.sizeBytes / 1024).toFixed(1) }} KB</td>
            <td><button class="mini danger" :disabled="busy" @click="removeDoc(d.id)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted empty">还没有文档。点击「导入文档」，选择合同、笔记、研报等本地文件开始。</p>
    </section>

    <!-- ============ 问答 ============ -->
    <section v-if="tab === 'chat'" class="panel chat">
      <div class="chat-layout">
        <aside class="conv-list">
          <button class="btn-primary full" @click="newConversation">＋ 新对话</button>
          <div v-for="c in conversations" :key="c.id" class="conv-item" :class="{ on: activeConv?.id === c.id }">
            <span class="conv-title" @click="openConv(c)">{{ c.title }}</span>
            <button class="mini" @click="exportConv(c)">导出</button>
            <button class="mini danger" @click="removeConv(c.id)">删</button>
          </div>
          <p v-if="!conversations.length" class="muted small">提问后自动保存对话。</p>
        </aside>

        <div class="chat-main">
          <div class="messages">
            <p v-if="!activeConv || !activeConv.messages.length" class="muted empty">
              基于已导入的 {{ docs.length }} 个文档提问，例如：这份合同的违约条款是什么？答案会标注引用来源。
            </p>
            <div v-for="(m, i) in activeConv?.messages ?? []" :key="i" class="msg" :class="m.role">
              <div class="role">{{ m.role === 'user' ? '我' : '知识库' }}</div>
              <div class="bubble">
                <div class="content">{{ m.content }}</div>
                <div v-if="m.role === 'assistant'" class="meta">
                  <span :class="m.confidence !== undefined && m.confidence < 0.32 ? 'warn' : 'ok'">
                    {{ m.semantic ? '语义+关键词检索' : '关键词检索' }} · 置信度 {{ (m.confidence ?? 0).toFixed(2) }}
                  </span>
                </div>
                <div v-if="m.citations?.length" class="cites">
                  <button v-for="(cit, ci) in m.citations" :key="cit.chunkId" class="cite" @click="openCitation = cit">[{{ ci + 1 }}] {{ cit.docName }}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="ask">
            <textarea v-model="question" rows="2" placeholder="针对本地文档提问…" @keydown.enter.prevent="ask"></textarea>
            <button class="btn-primary" :disabled="asking || !docs.length" @click="ask">{{ asking ? '检索中…' : '发送' }}</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 设置 ============ -->
    <section v-if="tab === 'settings'" class="panel">
      <h2 style="margin-top:0">本地语义模型</h2>
      <p class="muted small">
        状态：<b :class="semanticReady ? 'ok' : 'warn'">{{ semanticReady ? '已就绪（可离线）' : '未加载' }}</b>。
        未加载或加载失败时，问答自动使用关键词（BM25）检索，功能不受影响。
      </p>
      <div class="btnrow">
        <button class="btn-primary" :disabled="busy" @click="prepareModel">{{ semanticReady ? '重新检测 / 更新模型' : '下载并准备语义模型（约 24MB）' }}</button>
        <button class="btn-ghost" :disabled="busy" @click="wipeCache">清除模型缓存</button>
      </div>
      <p v-if="probeMsg" class="muted small">{{ probeMsg }}</p>

      <h2>模型下载源（大文件对象存储 / CDN）</h2>
      <p class="muted small">
        内置源会自动探测、故障切换。专业版可填写<b>自带对象存储</b>（按 Hugging Face 目录布局存放）：
        Cloudflare R2（10GB 免费、出口流量 $0）或腾讯云 COS + CDN（新客 50GB / 6 个月免费），公开桶开启 CORS 即可。
      </p>
      <div class="form-row">
        <label>自定义源 Base URL</label>
        <input v-model="customBase" type="url" placeholder="https://your-bucket.r2.dev" :disabled="!pro" @change="persistSources">
        <span v-if="!pro" class="muted small">专业版功能</span>
      </div>
      <div class="form-row">
        <label>源优先级（从上到下探测）</label>
        <div class="order">
          <span v-for="sid in sourceOrder" :key="sid" class="tag">{{ sourceLabel[sid] }}</span>
        </div>
      </div>
      <ul class="muted small srcs">
        <li v-for="s in builtin" :key="s.id">{{ s.label }}</li>
      </ul>

      <h2>隐私</h2>
      <p class="muted small">文档、向量、对话均存于本机 IndexedDB / Cache Storage，不经过任何服务器，也不采集文档内容与提问。清除浏览器站点数据会删除本地知识库。</p>
    </section>

    <!-- 引用原文弹层 -->
    <div v-if="openCitation" class="modal" @click.self="openCitation = null">
      <div class="modal-card">
        <h3 style="margin-top:0">{{ openCitation.docName }} · 片段 #{{ openCitation.index + 1 }}</h3>
        <p class="cite-text">{{ openCitation.text }}</p>
        <div class="btnrow end"><button class="btn-primary" @click="openCitation = null">关闭</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lkb { max-width: 1080px; margin: 0 auto; padding: 8px 4px 60px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
h1 { font-size: 26px; margin: 6px 0; }
.sub { color: #667; line-height: 1.6; font-size: 14px; }
.btn-up { background: #16a34a; color: #fff; border: none; border-radius: 8px; padding: 9px 14px; cursor: pointer; white-space: nowrap; }
.pro-badge.on span { color: #16a34a; font-size: 13px; }
.tabs { display: flex; gap: 6px; margin: 16px 0 10px; border-bottom: 1px solid #e5e7eb; }
.tabs button { background: none; border: none; padding: 10px 16px; cursor: pointer; color: #555; border-bottom: 2px solid transparent; font-size: 15px; }
.tabs button.active { color: #166534; border-bottom-color: #16a34a; font-weight: 600; }
.tabs i { font-style: normal; color: #98a2b3; font-size: 12px; margin-left: 2px; }
.panel { background: #fff; border: 1px solid #e8eaf0; border-radius: 12px; padding: 18px; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.btnrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.btnrow.end { justify-content: flex-end; }
.btn-primary { background: #16a34a; color: #fff; border: none; border-radius: 8px; padding: 9px 14px; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-ghost { background: #fff; border: 1px solid #d0d5dd; border-radius: 8px; padding: 9px 14px; cursor: pointer; }
.full { width: 100%; justify-content: center; }
.chk { font-size: 13px; color: #444; display: flex; gap: 5px; align-items: center; }
.mini { border: 1px solid #d0d5dd; background: #fff; border-radius: 6px; padding: 3px 9px; cursor: pointer; font-size: 12px; }
.mini.danger { color: #dc2626; }
.notice { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.progress { margin: 10px 0; }
.bar-track { height: 8px; background: #eef; border-radius: 4px; overflow: hidden; background: #eef2f7; }
.bar-fill { height: 100%; background: #16a34a; transition: width .2s; }
.muted { color: #7a8699; }
.small { font-size: 12.5px; }
.empty { padding: 26px 0; text-align: center; }
.doclist { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
.doclist th, .doclist td { text-align: left; padding: 9px 8px; border-bottom: 1px solid #eef0f4; }
.doclist .dn { max-width: 420px; word-break: break-all; }
.chat-layout { display: grid; grid-template-columns: 210px 1fr; gap: 14px; }
.conv-list { border-right: 1px solid #eef0f4; padding-right: 12px; display: flex; flex-direction: column; gap: 6px; }
.conv-item { display: flex; align-items: center; gap: 4px; font-size: 13px; padding: 4px; border-radius: 6px; }
.conv-item.on { background: #f0fdf4; }
.conv-title { flex: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-main { display: flex; flex-direction: column; min-height: 420px; }
.messages { flex: 1; max-height: 56vh; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
.msg { display: flex; gap: 8px; }
.msg.user { flex-direction: row-reverse; }
.role { font-size: 12px; color: #98a2b3; width: 40px; text-align: center; padding-top: 2px; }
.bubble { max-width: 80%; background: #f4f6f9; border-radius: 10px; padding: 9px 12px; }
.msg.user .bubble { background: #dcfce7; }
.content { white-space: pre-wrap; line-height: 1.6; font-size: 14px; }
.meta { margin-top: 6px; font-size: 12px; }
.meta .ok { color: #16a34a; }
.meta .warn { color: #d97706; }
.cites { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.cite { border: 1px solid #cfe8d6; background: #fff; color: #166534; border-radius: 6px; padding: 2px 8px; font-size: 12px; cursor: pointer; }
.ask { display: flex; gap: 8px; margin-top: 12px; }
.ask textarea { flex: 1; border: 1px solid #d0d5dd; border-radius: 8px; padding: 9px; font: inherit; resize: vertical; }
.form-row { margin: 12px 0; display: flex; flex-direction: column; gap: 5px; font-size: 14px; }
.form-row input { padding: 9px; border: 1px solid #d0d5dd; border-radius: 8px; max-width: 480px; }
.order { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { background: #eef7ff; color: #0369a1; border-radius: 6px; padding: 3px 9px; font-size: 12.5px; }
.srcs { padding-left: 18px; line-height: 1.8; }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.modal-card { background: #fff; border-radius: 12px; padding: 20px; max-width: 640px; width: 100%; max-height: 80vh; overflow: auto; }
.cite-text { white-space: pre-wrap; line-height: 1.8; background: #f8fafc; padding: 12px; border-radius: 8px; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (max-width: 720px) {
  .chat-layout { grid-template-columns: 1fr; }
  .conv-list { border-right: none; border-bottom: 1px solid #eef0f4; padding: 0 0 10px; }
  .bubble { max-width: 92%; }
}
</style>
