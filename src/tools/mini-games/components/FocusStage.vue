<script setup lang="ts">
/**
 * FocusStage —— 游戏内纯净全屏专注容器（007 炫光系列核心交互）。
 *
 * - fixed 铺满整个视口（100dvh + 安全区避让），黑底层级盖过应用顶/底栏与工具条；
 * - 进入时与应用沉浸态联动（实际系统全屏由父级在用户手势内触发，这里只做状态兜底与退出）；
 * - 游戏进行中屏幕上只有：画面 + 左上极简分数/连击 + 右上极小控制钮；
 *   控制浮层（暂停/重开/静音/退出）轻触唤出、无操作自动隐去，绝不常驻占屏；
 * - GPU 游戏铺满整屏；经典 DOM 游戏在居中限宽容器内呈现，玩法外观保持不变。
 */
import { onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useImmersive } from '@/composables/useImmersive'
import { NEON_STAGE_KEY } from './neonStageKey'

const props = withDefaults(
  defineProps<{
    title: string
    kind?: 'gpu' | 'dom'
    /** 当前分数（不传则不显示左上分数，避免与 DOM 游戏自带记分重复） */
    score?: number
    /** 连击数（>0 才显示） */
    combo?: number
    /** 是否静音 */
    muted?: boolean
    /** 是否暂停（与内部暂停按钮双向同步） */
    paused?: boolean
  }>(),
  { kind: 'gpu', score: undefined, combo: 0, muted: false, paused: false }
)

const emit = defineEmits<{
  (e: 'exit'): void
  (e: 'restart'): void
  (e: 'toggle-mute'): void
  (e: 'update:paused', v: boolean): void
}>()

const imm = useImmersive()
const menuOpen = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

function showMenu(autoHide = true): void {
  menuOpen.value = true
  if (hideTimer) clearTimeout(hideTimer)
  // 暂停状态下常驻显示，方便操作；其余情况无操作 2.5s 自动隐去。
  if (autoHide && !props.paused) {
    hideTimer = setTimeout(() => (menuOpen.value = false), 2500)
  }
}

function toggleMenu(): void {
  if (menuOpen.value) {
    menuOpen.value = false
    if (hideTimer) clearTimeout(hideTimer)
  } else {
    showMenu(true)
  }
}

function togglePause(): void {
  if (hideTimer) clearTimeout(hideTimer)
  const next = !props.paused
  emit('update:paused', next)
  menuOpen.value = true // 暂停时常驻，继续时由“继续”按钮收起
}

function resume(): void {
  emit('update:paused', false)
  menuOpen.value = false
}

function restart(): void {
  emit('update:paused', false)
  menuOpen.value = false
  emit('restart')
}

function exit_(): void {
  emit('update:paused', false)
  menuOpen.value = false
  emit('exit')
}

provide(NEON_STAGE_KEY, { toggleMenu })

onMounted(() => {
  // 正常路径父级已在手势内 enter；此处仅兜底（如被复用时未进入）。
  if (!imm.active.value) void imm.enter()
})

// 用户按 Esc / 系统手势退出系统全屏时，应用沉浸态会被置 false；联动退出专注态。
watch(
  () => imm.active.value,
  (v) => {
    if (!v) exit_()
  }
)

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
  if (imm.active.value) void imm.exit()
})
</script>

<template>
  <div class="focus-stage" :class="`is-${kind}`">
    <!-- GPU 游戏整屏铺满；DOM 游戏居中限宽 -->
    <div v-if="kind === 'gpu'" class="stage-canvas"><slot :paused="paused" /></div>
    <div v-else class="stage-dom"><slot :paused="paused" /></div>

    <!-- 极简 HUD：左上分数/连击，右上控制钮 -->
    <div class="hud">
      <div v-if="score !== undefined" class="hud-left">
        <span class="hud-score">{{ score }}</span>
        <transition name="pop">
          <span v-if="combo > 1" class="hud-combo">×{{ combo }} 连击</span>
        </transition>
      </div>
      <button class="hud-btn" aria-label="游戏控制" @click="toggleMenu">❚❚</button>
    </div>

    <!-- 极简控制浮层 -->
    <transition name="sheet">
      <div v-if="menuOpen" class="sheet" @click.stop>
        <p class="sheet-title">{{ title }}</p>
        <button class="sheet-btn" @click="paused ? resume() : togglePause()">
          {{ paused ? '▶ 继续' : '❚❚ 暂停' }}
        </button>
        <button class="sheet-btn" @click="restart">↻ 重新开始</button>
        <button class="sheet-btn" @click="emit('toggle-mute')">{{ muted ? '🔇 已静音' : '🔊 音效开' }}</button>
        <button class="sheet-btn danger" @click="exit_()">✕ 退出游戏</button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.focus-stage {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #05060d;
  color: #eaf2ff;
  overflow: hidden;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
}

.stage-canvas {
  position: absolute;
  inset: 0;
}
.stage-canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.stage-dom {
  position: absolute;
  inset: 0;
  overflow: auto;
  display: flex;
  justify-content: center;
  padding:
    calc(env(safe-area-inset-top, 0px) + 56px)
    calc(env(safe-area-inset-right, 0px) + 14px)
    calc(env(safe-area-inset-bottom, 0px) + 16px)
    calc(env(safe-area-inset-left, 0px) + 14px);
}
.stage-dom > :deep(*) {
  width: min(100%, 520px);
}
/* DOM 游戏沉浸在深色舞台上：卡片转半透明深色，文字转浅色 */
.stage-dom :deep(.m3),
.stage-dom :deep([class*='game']),
.stage-dom :deep(section) {
  color: #eaf2ff;
}

.hud {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  left: calc(env(safe-area-inset-left, 0px) + 14px);
  right: calc(env(safe-area-inset-right, 0px) + 14px);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  pointer-events: none;
}
.hud-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
  text-shadow: 0 0 12px rgba(120, 200, 255, 0.8);
  pointer-events: none;
}
.hud-score {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #f4fbff;
}
.hud-combo {
  font-size: 14px;
  font-weight: 700;
  color: #ffd76a;
  text-shadow: 0 0 10px rgba(255, 190, 80, 0.9);
}
.hud-btn {
  pointer-events: auto;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(20, 26, 44, 0.42);
  color: #dbe7ff;
  font-size: 13px;
  line-height: 1;
  backdrop-filter: blur(6px);
  opacity: 0.55;
}
.hud-btn:active {
  opacity: 1;
}

.sheet {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(78vw, 280px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 16px calc(env(safe-area-inset-bottom, 0px) + 18px);
  border-radius: 18px;
  background: rgba(14, 19, 36, 0.72);
  border: 1px solid rgba(140, 180, 255, 0.22);
  backdrop-filter: blur(14px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}
.sheet-title {
  margin: 0 0 4px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: #cfe0ff;
}
.sheet-btn {
  padding: 11px 12px;
  border-radius: 12px;
  border: 1px solid rgba(150, 190, 255, 0.25);
  background: rgba(255, 255, 255, 0.06);
  color: #eaf2ff;
  font-size: 15px;
}
.sheet-btn:active {
  background: rgba(120, 170, 255, 0.22);
}
.sheet-btn.danger {
  border-color: rgba(255, 120, 120, 0.35);
  color: #ffb4b4;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
  transform: translate(-50%, -46%) scale(0.96);
}
.pop-enter-active {
  transition: transform 0.15s ease;
}
.pop-enter-from {
  transform: scale(0.6);
}
</style>
