<script setup lang="ts">
/**
 * AttributionBoard —— 四维归因看板（主题/形式/平台/时段）。
 * 手写内联 SVG 柱状图（按收益）+ 数值表。空数据引导。零图表库。
 */
import { computed, ref } from 'vue'
import type { Account, AttributionDim, AttributionRow, Content, MetricSnapshot } from '../lib/types'
import { attribute } from '../lib/attribution'
import { centsToYuan } from '../lib/types'

const props = defineProps<{
  contents: Content[]
  metrics: MetricSnapshot[]
  accounts: Account[]
}>()

const dims: Array<{ key: AttributionDim; label: string }> = [
  { key: 'tag', label: '主题' },
  { key: 'format', label: '形式' },
  { key: 'platform', label: '平台' },
  { key: 'slot', label: '发布时段' }
]
const dim = ref<AttributionDim>('tag')

const rows = computed<AttributionRow[]>(() => attribute(props.contents, props.metrics, props.accounts, dim.value))

// —— SVG 柱状图布局 ——
const W = 640
const H = 260
const padL = 8
const padB = 26
const chart = computed(() => {
  const data = rows.value
  if (!data.length) return null
  const maxRev = Math.max(...data.map((r) => r.revenueYuan), 1)
  const plotH = H - padB - 10
  const band = (W - padL) / data.length
  const barW = Math.min(48, band * 0.6)
  const bars = data.map((r, i) => {
    const h = (r.revenueYuan / maxRev) * plotH
    return {
      x: padL + i * band + (band - barW) / 2,
      y: 10 + plotH - h,
      w: barW,
      h: Math.max(2, h),
      label: r.label,
      rev: r.revenueYuan
    }
  })
  return { bars, plotH }
})
</script>

<template>
  <div class="board">
    <nav class="dims" aria-label="归因维度">
      <button v-for="d in dims" :key="d.key" :class="{ on: dim === d.key }" @click="dim = d.key">
        {{ d.label }}
      </button>
    </nav>

    <p v-if="!rows.length" class="muted empty-tip">
      还没有可归因的数据。先在「台账」录几条内容、并回收一次阅读/收益快照，这里就会按{{ dims.find((d) => d.key === dim)?.label }}自动出图。
    </p>

    <template v-else>
      <svg v-if="chart" :viewBox="`0 0 ${W} ${H}`" class="chart" role="img" aria-label="各维度收益柱状图">
        <g v-for="(b, i) in chart.bars" :key="i">
          <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" fill="#3b7dd8" rx="3" />
          <text :x="b.x + b.w / 2" :y="H - 8" text-anchor="middle" class="axis-label">
            {{ b.label.length > 6 ? b.label.slice(0, 6) + '…' : b.label }}
          </text>
          <title>{{ b.label }}：¥{{ b.rev.toFixed(2) }}</title>
        </g>
      </svg>

      <table class="tbl">
        <thead>
          <tr>
            <th>{{ dims.find((d) => d.key === dim)?.label }}</th>
            <th class="num">条数</th>
            <th class="num">阅读</th>
            <th class="num">收益</th>
            <th class="num">元/条</th>
            <th class="num">时薪</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.label">
            <td class="lbl">{{ r.label }}</td>
            <td class="num">{{ r.count }}</td>
            <td class="num">{{ r.views.toLocaleString() }}</td>
            <td class="num">¥{{ centsToYuan(r.revenueCents).toFixed(2) }}</td>
            <td class="num">¥{{ r.perContentYuan.toFixed(2) }}</td>
            <td class="num">{{ r.roiYuanPerHour === null ? '—（工时0）' : '¥' + r.roiYuanPerHour.toFixed(2) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.dims {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.3rem;
  margin-bottom: 0.7rem;
}
.dims button {
  border: 1px solid #e6e9ef;
  background: #fff;
  border-radius: 0.6rem;
  padding: 0.5rem 0.2rem;
  font-size: 0.85rem;
  min-height: 44px;
  cursor: pointer;
  color: #5c6370;
}
.dims button.on {
  border-color: #3b7dd8;
  background: #e8f0fd;
  color: #2a5fb0;
  font-weight: 700;
}
.empty-tip {
  padding: 2rem 1rem;
  text-align: center;
}
.chart {
  width: 100%;
  height: auto;
  background: #fcfdff;
  border: 1px solid #e6e9ef;
  border-radius: 0.6rem;
}
.axis-label {
  font-size: 11px;
  fill: #828a99;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.7rem;
  font-size: 0.82rem;
}
.tbl th,
.tbl td {
  border-bottom: 1px solid #eef0f4;
  padding: 0.45rem 0.3rem;
  text-align: left;
}
.tbl .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tbl .lbl {
  font-weight: 600;
}
.muted {
  color: #828a99;
}
</style>
