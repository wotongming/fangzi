<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useToolsStore } from '../stores/tools'
import { billingProvider } from '../core/billing'
import {
  getQueuedFeedbackCount,
  retryQueuedFeedback,
  openFeedbackMail,
  FEEDBACK_TARGET_EMAIL
} from '../core/feedback'

const settings = useSettingsStore()
const toolsStore = useToolsStore()

const baseUrl = ref(settings.ai.baseUrl)
const model = ref(settings.ai.model)
const apiKey = ref(settings.ai.apiKey)
const embeddingsPath = ref(settings.ai.embeddingsPath ?? '')
const savedTip = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; msg: string } | null>(null)
const queued = ref(getQueuedFeedbackCount())
const providerName = billingProvider().name

function save() {
  settings.updateAi({
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
    apiKey: apiKey.value.trim(),
    embeddingsPath: embeddingsPath.value.trim() || undefined
  })
  savedTip.value = true
  testResult.value = null
  setTimeout(() => (savedTip.value = false), 1600)
}

function clearAi() {
  settings.clearAi()
  baseUrl.value = ''
  model.value = ''
  apiKey.value = ''
  embeddingsPath.value = ''
  testResult.value = null
}

async function testAndIndex() {
  save()
  testing.value = true
  testResult.value = null
  try {
    const r = await toolsStore.prepareVectors()
    if (r.ok) testResult.value = { ok: true, msg: '连接成功，全部工具的语义向量索引已建立并缓存。' }
    else testResult.value = { ok: false, msg: r.error ?? '连接失败' }
  } finally {
    testing.value = false
  }
}

async function flushFeedback() {
  const r = await retryQueuedFeedback()
  queued.value = getQueuedFeedbackCount()
  testResult.value = {
    ok: r.failed === 0,
    msg: `需求补发：成功 ${r.sent} 条，剩余未发出 ${r.failed} 条`
  }
}

function clearAllLocal() {
  if (!confirm('将清空本机的 AI 配置、收藏、订单权益、用量与反馈队列，确定继续？')) return
  localStorage.clear()
  location.reload()
}

const endpointConfigured = computed(() => Boolean(import.meta.env.VITE_FEEDBACK_ENDPOINT))
</script>

<template>
  <div class="container settings">
    <h1>设置</h1>

    <section class="card box">
      <h2>AI 语义检索（可选）</h2>
      <p class="muted">
        配置 OpenAI 兼容的 Embedding 接口后启用「向量 + 关键词混合检索」，口语化问题也能更准命中；
        <b>不配置也完全可用</b>，会自动使用高质量关键词检索（2-gram + 关键词重叠）。配置仅保存在本机浏览器。
      </p>
      <label class="field">
        接口基础地址（Base URL）
        <input v-model="baseUrl" type="text" placeholder="https://api.openai.com/v1" autocomplete="off" />
      </label>
      <label class="field">
        嵌入模型名称
        <input v-model="model" type="text" placeholder="text-embedding-3-small / bge-m3 等" autocomplete="off" />
      </label>
      <label class="field">
        API Key
        <input v-model="apiKey" type="password" placeholder="sk-..." autocomplete="off" />
      </label>
      <label class="field">
        Embeddings 路径（可选，默认 /embeddings）
        <input v-model="embeddingsPath" type="text" placeholder="/embeddings" autocomplete="off" />
      </label>
      <div class="actions">
        <button class="btn btn-primary" @click="save">保存</button>
        <button class="btn" :disabled="testing || !settings.aiConfigured" @click="testAndIndex">
          {{ testing ? '测试并建索引中…' : '测试连接并建立向量索引' }}
        </button>
        <button class="btn btn-ghost" @click="clearAi">清除配置</button>
        <span v-if="savedTip" class="ok">已保存</span>
      </div>
      <p v-if="testResult" :class="testResult.ok ? 'ok' : 'bad'">{{ testResult.msg }}</p>
      <p class="faint small">
        当前状态：{{ settings.aiConfigured ? '已配置完整参数，搜索走混合检索（向量异常会自动降级）' : '未配置，使用纯关键词检索' }}
      </p>
    </section>

    <section class="card box">
      <h2>计费</h2>
      <p class="muted">
        当前计费适配器：<code>{{ providerName }}</code>。
        {{ providerName === 'local-mock' ? '本地模拟支付（下单即到账，用于离线演示）。' : '已对接真实支付后端。' }}
        订单、权益与用量保存在本机浏览器。
      </p>
    </section>

    <section class="card box">
      <h2>意见反馈</h2>
      <p class="muted">
        推荐直接用邮件联系我们，会自动填好收件人 <code>{{ FEEDBACK_TARGET_EMAIL }}</code> 与正文模板：
      </p>
      <div class="actions">
        <button class="btn btn-primary" @click="openFeedbackMail('new')">✉️ 提新需求</button>
        <button class="btn" @click="openFeedbackMail('improve')">🔧 优化已有工具</button>
      </div>
      <p class="muted" style="margin-top: 12px;">
        此前在无搜索结果时用网页表单提交的需求{{ endpointConfigured ? '会即时发送' : '先在本机排队，配置投递地址后自动补发' }}，
        本机待发队列：<b>{{ queued }}</b> 条。
      </p>
      <div class="actions">
        <button class="btn" :disabled="!endpointConfigured || queued === 0" @click="flushFeedback">立即补发队列</button>
      </div>
    </section>

    <section class="card box danger-box">
      <h2>本地数据</h2>
      <p class="muted">清除全部本机数据（AI 配置、收藏、订单与用量、反馈队列）。</p>
      <button class="btn danger" @click="clearAllLocal">清空本机数据</button>
    </section>
  </div>
</template>

<style scoped>
.settings {
  padding-top: 24px;
  padding-bottom: 60px;
  max-width: 760px;
}
h1 {
  font-size: 22px;
  margin: 0 0 16px;
}
.box {
  padding: 20px 22px;
  margin-bottom: 16px;
}
h2 {
  font-size: 16px;
  margin: 0 0 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13.5px;
  margin: 12px 0;
  color: var(--ink-soft);
}
.field input {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-size: 14px;
}
.field input:focus {
  outline: none;
  border-color: var(--brand);
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 6px;
}
.ok {
  color: var(--brand-dark);
  font-weight: 600;
}
.bad {
  color: var(--danger);
  font-weight: 600;
}
.small {
  font-size: 12.5px;
}
code {
  background: #f0eee7;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 13px;
}
.danger {
  border-color: #e6c3bf;
  color: var(--danger);
}
</style>
