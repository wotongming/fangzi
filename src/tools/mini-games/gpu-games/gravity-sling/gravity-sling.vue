<script setup lang="ts">
/**
 * 《挽星弓》（gravity-sling）—— 最薄 Vue wrapper。
 * 只负责把 canvas 交给 sling-core 内核、转发宿主 props/事件、卸载清理；
 * 游戏状态机、物理、渲染、音频、自动快照全部在 game/sling-core.ts 内。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mount, type SlingHandle } from './game/sling-core'

const props = withDefaults(
  defineProps<{
    paused?: boolean
    muted?: boolean
    vibrate?: boolean
    particle?: 'auto' | 'high' | 'low'
  }>(),
  { paused: false, muted: false, vibrate: true, particle: 'auto' }
)

const emit = defineEmits<{
  (e: 'score', v: number): void
  (e: 'combo', v: number): void
  (e: 'gameover'): void
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
let handle: SlingHandle | null = null

onMounted(() => {
  const canvas = canvasEl.value
  if (!canvas) return
  handle = mount(canvas, {
    onScore: (v) => emit('score', v),
    onCombo: (v) => emit('combo', v),
    onGameover: () => emit('gameover'),
    muted: props.muted,
    vibrate: props.vibrate
  })
  // E2E/调试接缝：句柄本体 + debug 子命名空间，仅供自动化校验
  ;(window as unknown as Record<string, unknown>).__gravitySling = handle
})

watch(
  () => props.paused,
  (p) => handle?.setPaused(p)
)
watch(
  () => props.muted,
  (m) => handle?.setMuted(m)
)

onBeforeUnmount(() => {
  handle?.destroy()
  handle = null
  delete (window as unknown as Record<string, unknown>).__gravitySling
})
</script>

<template>
  <div class="sling">
    <canvas ref="canvasEl" class="sling-canvas" />
  </div>
</template>

<style scoped>
.sling {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.sling-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
