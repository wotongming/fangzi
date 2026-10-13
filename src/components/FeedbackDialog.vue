<script setup lang="ts">
import { computed, ref } from 'vue'
import { submitFeedback, FEEDBACK_TARGET_EMAIL } from '../core/feedback'

const props = defineProps<{ open: boolean; query?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

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
}

function close() {
  emit('close')
  setTimeout(reset, 200)
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
    <div class="dialog card" role="dialog" aria-modal="true" aria-label="提交工具需求">
      <button class="close-x" @click="close" aria-label="关闭">×</button>

      <template v-if="state === 'idle'">
        <h2>告诉我们你需要什么工具</h2>
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
          <span class="faint" :class="{ warn: remaining < 0 }">{{ remaining }} 字</span>
          <button class="btn btn-primary" :disabled="submitting || !content.trim()" @click="submit">
            {{ submitting ? '提交中…' : '提交需求' }}
          </button>
        </div>
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
  margin: 0 0 12px;
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
