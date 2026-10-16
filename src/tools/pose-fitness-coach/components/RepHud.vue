<script setup lang="ts">
import type { FsmFrame } from '../lib/types'

defineProps<{
  frame: FsmFrame
  exerciseName: string
  isTimed?: boolean
}>()
</script>

<template>
  <div class="hud">
    <div class="hud-top">
      <div class="hud-count">
        <span class="num">{{ isTimed ? frame.reps + 's' : frame.reps }}</span>
        <span class="cap">{{ isTimed ? '已坚持' : '次数' }}</span>
      </div>
      <div class="hud-meta">
        <div class="phase" :class="frame.phase">{{ frame.present ? (frame.phase === 'down' ? '目标位' : '起始位') : '未检测到人' }}</div>
        <div v-if="frame.lastScore !== null" class="score">上次评分 <b>{{ frame.lastScore }}</b></div>
        <div v-if="frame.angle !== null" class="angle">角度 {{ frame.angle }}°</div>
      </div>
    </div>
    <div v-if="frame.issues.length" class="issues">
      <span v-for="i in frame.issues" :key="i.code" class="issue" :class="i.level">{{ i.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 10px;
  pointer-events: none;
}
.hud-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.hud-count {
  background: rgba(15, 23, 20, 0.55);
  color: #fff;
  border-radius: 12px;
  padding: 6px 14px;
  text-align: center;
  backdrop-filter: blur(4px);
}
.num {
  display: block;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.1;
}
.cap {
  font-size: 12px;
  opacity: 0.85;
}
.hud-meta {
  text-align: right;
  color: #fff;
  font-size: 13px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.phase {
  display: inline-block;
  background: rgba(46, 160, 99, 0.92);
  border-radius: 999px;
  padding: 2px 12px;
  font-size: 13px;
}
.phase.idle,
.phase.up {
  background: rgba(15, 23, 20, 0.55);
}
.score b {
  color: #ffd166;
}
.issues {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.issue {
  font-size: 13px;
  border-radius: 8px;
  padding: 3px 10px;
  color: #fff;
}
.issue.warn {
  background: rgba(214, 158, 46, 0.92);
}
.issue.critical {
  background: rgba(214, 69, 69, 0.92);
}
.issue.info {
  background: rgba(60, 90, 120, 0.9);
}
</style>
