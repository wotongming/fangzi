<script setup lang="ts">
import { computed } from 'vue'
import type { DimScore } from '../lib/types'

const props = defineProps<{ dims: DimScore[] }>()

const SIZE = 220
const C = SIZE / 2
const R = 78
const LABEL_R = R + 16

// 三维雷达（三角形），从顶部开始均匀分布
const axes = computed(() => {
  const n = props.dims.length || 3
  return props.dims.map((d, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      label: d.label,
      pct: Math.round(d.coverage * 100),
      cos,
      // 名称/百分比分两行，按所在方位选择对齐：右侧点文字向左收(end)、左侧点向右展(start)，避免越出画布
      anchor: cos > 0.35 ? 'end' : cos < -0.35 ? 'start' : 'middle',
      nameY: C + LABEL_R * sin - 7,
      pctY: C + LABEL_R * sin + 9,
      // 两侧标签略微向中心内收，彻底避开画布左右缘
      lx: C + (LABEL_R - 4) * cos,
      px: C + R * d.coverage * cos,
      py: C + R * d.coverage * sin,
      ax: C + R * cos,
      ay: C + R * sin
    }
  })
})

const polygon = computed(() => axes.value.map((a) => `${a.px},${a.py}`).join(' '))
const ringPoints = (scale: number) =>
  axes.value
    .map((_a, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / axes.value.length
      return `${C + R * scale * Math.cos(ang)},${C + R * scale * Math.sin(ang)}`
    })
    .join(' ')
const rings = [0.33, 0.66, 1]
</script>

<template>
  <svg :width="SIZE" :height="SIZE" :viewBox="`0 0 ${SIZE} ${SIZE}`" class="radar" role="img" aria-label="三维匹配度雷达图">
    <polygon v-for="(rg, ri) in rings" :key="ri" :points="ringPoints(rg)" fill="none" stroke="#e3e3e3" stroke-width="1" />
    <line v-for="(a, i) in axes" :key="'l' + i" :x1="C" :y1="C" :x2="a.ax" :y2="a.ay" stroke="#e3e3e3" />
    <polygon :points="polygon" fill="rgba(46,160,99,0.22)" stroke="#2ea063" stroke-width="2" />
    <circle v-for="(a, i) in axes" :key="'p' + i" :cx="a.px" :cy="a.py" r="3.5" fill="#2ea063" />
    <text
      v-for="(a, i) in axes"
      :key="'tn' + i"
      :x="a.lx"
      :y="a.nameY"
      :text-anchor="a.anchor"
      dominant-baseline="middle"
      class="lbl name"
    >{{ a.label }}</text>
    <text
      v-for="(a, i) in axes"
      :key="'tp' + i"
      :x="a.lx"
      :y="a.pctY"
      :text-anchor="a.anchor"
      dominant-baseline="middle"
      class="lbl pct"
    >{{ a.pct }}%</text>
  </svg>
</template>

<style scoped>
.radar {
  max-width: 100%;
  height: auto;
}
.lbl {
  fill: #444;
}
.name {
  font-size: 12px;
}
.pct {
  font-size: 11px;
  fill: #2ea063;
  font-weight: 700;
}
</style>
