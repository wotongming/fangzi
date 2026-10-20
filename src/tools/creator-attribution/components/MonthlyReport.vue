<script setup lang="ts">
/**
 * MonthlyReport —— 选月 → 预览月度经营报告 → 导出 .md。
 */
import { computed, ref } from 'vue'
import type { Account, Content, Deal, MetricSnapshot } from '../lib/types'
import { buildMonthlyReport } from '../lib/report'
import { downloadMarkdown } from '../lib/export'

const props = defineProps<{
  contents: Content[]
  metrics: MetricSnapshot[]
  accounts: Account[]
  deals: Deal[]
}>()

function defaultYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const ym = ref(defaultYm())
const md = computed(() => buildMonthlyReport(ym.value, props.contents, props.metrics, props.accounts, props.deals))

function exportMd() {
  downloadMarkdown(`创作月报-${ym.value}.md`, md.value)
}
</script>

<template>
  <div class="report">
    <div class="card">
      <div class="card-h">📅 月度经营报告</div>
      <div class="pick-row">
        <label>选择月份
          <input type="month" v-model="ym" />
        </label>
        <button class="btn primary" @click="exportMd">导出 .md</button>
      </div>
      <p class="muted tiny">收入构成 / TOP3 内容 / 下月选题策略 / 商单汇总，一键导出 Markdown。</p>
    </div>
    <div class="card preview">
      <pre>{{ md }}</pre>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 0.9rem;
  padding: 0.9rem;
  margin-bottom: 0.8rem;
}
.card-h {
  font-weight: 700;
  margin-bottom: 0.55rem;
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.pick-row label {
  font-size: 0.85rem;
  color: #556;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.pick-row input {
  border: 1px solid #e6e9ef;
  border-radius: 0.5rem;
  padding: 0.5rem 0.6rem;
  font-size: 16px;
}
.btn {
  appearance: none;
  border: 1px solid #e6e9ef;
  background: #fff;
  border-radius: 0.6rem;
  padding: 0.55rem 0.9rem;
  font-size: 0.88rem;
  cursor: pointer;
  min-height: 44px;
}
.btn.primary {
  background: #3b7dd8;
  border-color: #3b7dd8;
  color: #fff;
}
.preview pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.85rem;
  line-height: 1.6;
  margin: 0;
}
.muted {
  color: #828a99;
}
.tiny {
  font-size: 0.78rem;
}
</style>
