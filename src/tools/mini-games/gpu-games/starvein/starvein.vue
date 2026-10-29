<script setup lang="ts">
/**
 * 《星脉》（starvein）—— 最薄 Vue wrapper。
 * 只负责把 canvas 交给 vein-core 内核、转发宿主 props/事件、卸载清理；
 * 玩法、渲染、音频、自动快照全部在 game/vein-core.ts 内。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mount, type VeinHandle } from './game/vein-core'

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
let handle: VeinHandle | null = null

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
  ;(window as unknown as Record<string, unknown>).__starvein = handle
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
  delete (window as unknown as Record<string, unknown>).__starvein
})
</script>

<template>
  <div class="vein">
    <canvas ref="canvasEl" class="vein-canvas" />
  </div>
</template>

<style scoped>
.vein {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.vein-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
