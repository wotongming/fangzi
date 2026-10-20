<script setup lang="ts">
/**
 * MetricsInput —— 单条内容的数据回收快照录入与历史。
 * 一条内容可多次回收（发布后 7 天、30 天各一次）。金额元→分由父组件换算。
 */
import { computed, reactive, ref } from 'vue'
import type { Content, MetricSnapshot } from '../lib/types'
import { centsToYuan } from '../lib/types'

const props = defineProps<{
  content: Content
  allMetrics: MetricSnapshot[]
}>()

const emit = defineEmits<{
  (
    e: 'add',
    p: { contentId: string; capturedAt: number; views: number; followersDelta: number; revenueYuan: number; note: string }
  ): void
}>()

const expanded = ref(false)
const form = reactive({
  capturedAt: toDateInput(new Date()),
  views: '',
  followers: '',
  revenue: '',
  note: ''
})

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const mine = computed(() =>
  props.allMetrics.filter((m) => m.contentId === props.content.id).sort((a, b) => b.capturedAt - a.capturedAt)
)
const totalCents = computed(() => mine.value.reduce((s, m) => s + m.revenueCents, 0))
const totalViews = computed(() => mine.value.reduce((s, m) => s + m.views, 0))

function save() {
  const views = Number(form.views)
  const followers = Number(form.followers)
  const revenueYuan = Number(form.revenue)
  if (!form.views.trim() && !form.revenue.trim()) return
  const d = new Date(form.capturedAt + 'T12:00:00')
  emit('add', {
    contentId: props.content.id,
    capturedAt: d.getTime(),
    views: Number.isFinite(views) ? views : 0,
    followersDelta: Number.isFinite(followers) ? followers : 0,
    revenueYuan: Number.isFinite(revenueYuan) ? revenueYuan : 0,
    note: form.note.trim()
  })
  form.views = ''
  form.followers = ''
  form.revenue = ''
  form.note = ''
}
</script>

<template>
  <div class="mi">
    <button class="mi-toggle" @click="expanded = !expanded">
      📊 回收数据<template v-if="mine.length">（已 {{ mine.length }} 次 · 累计 {{ totalViews.toLocaleString() }} 阅读 / ¥{{ centsToYuan(totalCents).toFixed(2) }}）</template>
    </button>
    <div v-if="expanded" class="mi-body">
      <div class="mi-grid">
        <label>日期<input type="date" v-model="form.capturedAt" /></label>
        <label>阅读/播放<input type="number" inputmode="numeric" v-model="form.views" placeholder="如 12000" /></label>
        <label>涨粉<input type="number" inputmode="numeric" v-model="form.followers" placeholder="选填" /></label>
        <label>本期收益(元)<input type="number" inputmode="decimal" v-model="form.revenue" placeholder="如 35.5" /></label>
      </div>
      <label class="mi-note">备注<input type="text" v-model="form.note" placeholder="选填，如 7 天节点" /></label>
      <button class="mi-save" @click="save">保存本次快照</button>
      <ul v-if="mine.length" class="mi-hist">
        <li v-for="m in mine" :key="m.id">
          {{ new Date(m.capturedAt).toLocaleDateString() }} · 阅读 {{ m.views.toLocaleString() }}
          <template v-if="m.followersDelta"> · 涨粉 {{ m.followersDelta }}</template> · ¥{{ centsToYuan(m.revenueCents).toFixed(2) }}
          <span v-if="m.note" class="muted">（{{ m.note }}）</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.mi {
  margin-top: 0.4rem;
  border-top: 1px dashed var(--line, #e6e9ef);
  padding-top: 0.4rem;
}
.mi-toggle {
  background: none;
  border: none;
  color: #3b7dd8;
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0.2rem 0;
  min-height: 32px;
}
.mi-body {
  margin-top: 0.3rem;
}
.mi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}
.mi-grid label,
.mi-note {
  display: flex;
  flex-direction: column;
  font-size: 0.76rem;
  color: #828a99;
  gap: 0.15rem;
}
.mi-grid input,
.mi-note input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--line, #e6e9ef);
  border-radius: 0.45rem;
  padding: 0.5rem 0.55rem;
  font-size: 16px;
  background: #fff;
}
.mi-save {
  margin-top: 0.45rem;
  background: #3b7dd8;
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
  min-height: 40px;
  cursor: pointer;
}
.mi-hist {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  color: #556;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.muted {
  color: #828a99;
}
</style>
