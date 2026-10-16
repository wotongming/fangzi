<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SessionRecord } from '../lib/types'

const props = defineProps<{ sessions: SessionRecord[] }>()
const cv = ref<HTMLCanvasElement | null>(null)

function render() {
  const canvas = cv.value
  if (!canvas) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const cssW = canvas.clientWidth || 320
  const cssH = 160
  canvas.width = cssW * dpr
  canvas.height = cssH * dpr
  const c = canvas.getContext('2d')
  if (!c) return
  c.scale(dpr, dpr)
  const W = cssW
  const H = cssH
  c.clearRect(0, 0, W, H)
  const pad = { l: 30, r: 8, t: 12, b: 18 }
  const data = props.sessions.slice(-20)
  // 网格 0-100
  c.strokeStyle = 'rgba(0,0,0,0.08)'
  c.fillStyle = 'rgba(0,0,0,0.45)'
  c.font = '10px sans-serif'
  for (const g of [0, 50, 100]) {
    const y = pad.t + ((100 - g) / 100) * (H - pad.t - pad.b)
    c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke()
    c.fillText(String(g), 4, y + 3)
  }
  if (data.length === 0) {
    c.fillStyle = 'rgba(0,0,0,0.4)'
    c.fillText('暂无训练记录', W / 2 - 34, H / 2)
    return
  }
  const xStep = data.length > 1 ? (W - pad.l - pad.r) / (data.length - 1) : 0
  const xy = (i: number, v: number) => ({
    x: pad.l + i * xStep,
    y: pad.t + ((100 - Math.max(0, Math.min(100, v))) / 100) * (H - pad.t - pad.b)
  })
  // 面积折线：平均动作分
  c.strokeStyle = '#2ea063'
  c.lineWidth = 2
  c.beginPath()
  data.forEach((s, i) => {
    const { x, y } = xy(i, s.avgScore || 0)
    if (i === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  })
  c.stroke()
  c.fillStyle = '#2ea063'
  data.forEach((s, i) => {
    const { x, y } = xy(i, s.avgScore || 0)
    c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill()
  })
}

onMounted(() => nextTick(render))
watch(() => props.sessions, () => nextTick(render), { deep: true })
onBeforeUnmount(() => {})
</script>

<template>
  <canvas ref="cv" class="trend" style="width: 100%; height: 160px" />
</template>
