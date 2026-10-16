<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { POSE_EDGES } from '../lib/connections'
import { VIS_THRESHOLD, vis } from '../lib/pose-geometry'
import type { Pose } from '../lib/types'

const props = withDefaults(defineProps<{ pose: Pose | null; mirror?: boolean }>(), {
  pose: null,
  mirror: false
})

const wrap = ref<HTMLDivElement | null>(null)
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let ro: ResizeObserver | null = null

function setupCanvas() {
  const el = wrap.value
  if (!el) return
  canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'none'
  el.appendChild(canvas)
  ctx = canvas.getContext('2d')
  const resize = () => {
    if (!canvas || !el) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const r = el.getBoundingClientRect()
    canvas.width = Math.round(r.width * dpr)
    canvas.height = Math.round(r.height * dpr)
  }
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(el)
}

function draw() {
  if (!canvas || !ctx) return
  const c = ctx
  const W = canvas.width
  const H = canvas.height
  c.clearRect(0, 0, W, H)
  const pose = props.pose
  if (!pose) return
  const px = (x: number) => (props.mirror ? 1 - x : x) * W
  const py = (y: number) => y * H
  c.lineWidth = Math.max(2, W * 0.004)
  c.lineCap = 'round'
  // 连线
  c.strokeStyle = 'rgba(46,160,99,0.9)'
  c.beginPath()
  for (const [a, b] of POSE_EDGES) {
    const pa = pose[a]
    const pb = pose[b]
    if (!pa || !pb || vis(pa) < VIS_THRESHOLD || vis(pb) < VIS_THRESHOLD) continue
    c.moveTo(px(pa.x), py(pa.y))
    c.lineTo(px(pb.x), py(pb.y))
  }
  c.stroke()
  // 关键点
  c.fillStyle = '#ffd166'
  for (const p of pose) {
    if (!p || vis(p) < VIS_THRESHOLD) continue
    const r = Math.max(3, W * 0.006)
    c.beginPath()
    c.arc(px(p.x), py(p.y), r, 0, Math.PI * 2)
    c.fill()
  }
}

watch(() => props.pose, draw, { deep: false })
watch(() => props.mirror, draw)

onMounted(() => {
  setupCanvas()
  draw()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  canvas?.remove()
})
</script>

<template>
  <div ref="wrap" class="skeleton-wrap" />
</template>

<style scoped>
.skeleton-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 14px;
}
</style>
