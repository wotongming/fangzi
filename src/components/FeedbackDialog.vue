<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  submitFeedback,
  openFeedbackMail,
  FEEDBACK_TARGET_EMAIL,
  type FeedbackKind
} from '../core/feedback'

const props = defineProps<{ open: boolean; query?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// 主路径：系统邮件。可在「提新需求 / 优化旧工具」两类模板间切换
const kind = ref<FeedbackKind>('new')
// 备选路径：没有邮件客户端时用在线提交
const showOnline = ref(false)

const content = ref('')
const submitting = ref(false)
const state = ref<'idle' | 'success-delivered' | 'success-queued' | 'error'>('idle')
const message = ref('')
const MAX = 2000

const remaining = computed(() => MAX - content.value.length)

function reset() {
  content.value = ''
  state.value = 'idle'
  message.value = ''
  showOnline.value = false
  kind.value = 'new'
}

function close() {
  emit('close')
  setTimeout(reset, 200)
}

/** 主操作：调起系统邮件，自动填好收件人 / 主题 / 正文模板 */
function sendMail(k: FeedbackKind) {
  openFeedbackMail(k, props.query)
}

async function submit() {
  const text = content.value.trim()
  if (!text || text.length > MAX) return
  submitting.value = true
  try {
    const res = await submitFeedback(text, props.query)
    if (res.delivered) {
      state.value = 'success-delivered'
    } else if (res.queued) {
      state.value = 'success-queued'
      message.value = res.error ?? ''
    } else {
      state.value = 'error'
      message.value = res.error ?? '提交失败，请稍后再试'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="dialog card" role="dialog" aria-modal="true" aria-label="反馈与提需求">
      <button class="close-x" @click="close" aria-label="关闭">×</button>

      <template v-if="state === 'idle'">
        <h2>向我们反馈</h2>

        <!-- 主路径：系统邮件 -->
        <template v-if="!showOnline">
          <p class="muted desc">
            选择反馈类型，点击后会自动打开你的邮件 App，<b>收件人、主题和正文开头都已填好</b>，
            补充几句直接发送即可。
          </p>

          <div class="kind-tabs" role="tablist">
            <button
              class="kind"
              :class="{ active: kind === 'new' }"
              role="tab"
              :aria-selected="kind === 'new'"
              @click="kind = 'new'"
            >
              💡 提新需求
            </button>
            <button
              class="kind"
              :class="{ active: kind === 'improve' }"
              role="tab"
              :aria-selected="kind === 'improve'"
              @click="kind = 'improve'"
            >
              🔧 优化旧工具
            </button>
          </div>

          <div class="preview">
            <div class="pv-row"><span class="pv-k">收件人</span><span class="pv-v">{{ FEEDBACK_TARGET_EMAIL }}</span></div>
            <div class="pv-row">
              <span class="pv-k">主题</span>
              <span class="pv-v">{{ kind === 'new' ? '【方子 · 新需求】我希望方子增加：' : '【方子 · 优化建议】关于工具的改进' }}</span>
            </div>
            <div class="pv-row pv-body">
              <span class="pv-k">正文</span>
              <span class="pv-v faint">{{ kind === 'new'
                ? '已预设「使用场景 / 现有麻烦 / 希望做到」三条引导，打开后按提示补充即可。'
                : '已预设「哪个工具 / 什么操作 / 期望与实际表现」三条引导，可附截图说明。' }}</span>
            </div>
          </div>

          <p v-if="query" class="faint query-hint">（你刚才在找：{{ query }}）</p>

          <button class="btn btn-primary big" @click="sendMail(kind)">
            ✉️ 打开邮件并发送{{ kind === 'new' ? '新需求' : '优化建议' }}
          </button>
          <button class="link-btn" @click="showOnline = true">没有邮件客户端？改用网页表单提交</button>
        </template>

        <!-- 备选路径：在线表单 -->
        <template v-else>
          <p class="muted desc">
            描述你遇到的具体问题或想要的工具，我们会考虑开发。<b>无需留下邮箱</b>。
            <span v-if="query" class="faint">（你刚才在找：{{ query }}）</span>
          </p>
          <textarea
            v-model="content"
            :maxlength="MAX"
            rows="6"
            placeholder="例如：我想要一个能批量把证件照压缩到 200KB 以内并改尺寸的工具……"
          ></textarea>
          <div class="foot">
            <button class="link-btn" @click="showOnline = false">← 返回邮件方式</button>
            <div class="right">
              <span class="faint" :class="{ warn: remaining < 0 }">{{ remaining }} 字</span>
              <button class="btn btn-primary" :disabled="submitting || !content.trim()" @click="submit">
                {{ submitting ? '提交中…' : '提交需求' }}
              </button>
            </div>
          </div>
        </template>
      </template>

      <template v-else-if="state === 'success-delivered' || state === 'success-queued'">
        <div class="result">
          <div class="check">✓</div>
          <h2>已收到你的需求，谢谢！</h2>
          <p class="muted">
            需求{{ state === 'success-delivered' ? '已即时发送' : '已在本机记录，将在联网后自动补发' }}到
            {{ FEEDBACK_TARGET_EMAIL }}。
          </p>
          <button class="btn btn-primary" @click="close">好的</button>
        </div>
      </template>

      <template v-else>
        <div class="result">
          <h2>提交未成功</h2>
          <p class="muted">{{ message || '请稍后再试' }}</p>
          <div class="foot">
            <button class="btn" @click="state = 'idle'">返回修改</button>
            <button class="btn btn-primary" @click="close">关闭</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(40, 38, 32, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
}
.dialog {
  width: min(520px, 100%);
  padding: 24px;
  position: relative;
}
.close-x {
  position: absolute;
  top: 10px;
  right: 14px;
  border: none;
  background: transparent;
  font-size: 26px;
  color: var(--ink-faint);
  line-height: 1;
}
h2 {
  margin: 0 0 8px;
  font-size: 18px;
}
.desc {
  font-size: 13.5px;
  margin: 0 0 14px;
}
.kind-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.kind {
  flex: 1;
  padding: 12px 10px;
  border-radius: 10px;
  border: 1.5px solid var(--line);
  background: #fdfdfb;
  font-size: 14px;
  color: var(--ink-soft, #555);
}
.kind.active {
  border-color: var(--brand);
  background: var(--brand-soft, #e9f3ee);
  color: var(--brand-dark, #1f6b4b);
  font-weight: 600;
}
.preview {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  background: #faf9f6;
  font-size: 13px;
  margin-bottom: 12px;
}
.pv-row {
  display: flex;
  gap: 10px;
  padding: 3px 0;
}
.pv-k {
  flex: 0 0 44px;
  color: var(--ink-faint, #999);
}
.pv-v {
  flex: 1;
  word-break: break-all;
}
.pv-body {
  align-items: flex-start;
}
.query-hint {
  font-size: 12.5px;
  margin: 0 0 10px;
}
.big {
  width: 100%;
  padding: 13px;
  font-size: 15px;
}
.link-btn {
  display: block;
  margin: 12px auto 0;
  border: none;
  background: transparent;
  color: var(--brand-dark, #1f6b4b);
  font-size: 13px;
  text-decoration: underline;
  cursor: pointer;
}
textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  resize: vertical;
  font-size: 14px;
  background: #fdfdfb;
}
textarea:focus {
  outline: none;
  border-color: var(--brand);
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  gap: 10px;
}
.right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
.warn {
  color: var(--danger);
}
.result {
  text-align: center;
  padding: 8px 0;
}
.check {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 12px;
}
</style>
