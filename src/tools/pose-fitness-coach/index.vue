<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSeo } from '@/composables/useSeo'
import { useToolBilling } from '@/composables/useToolBilling'
import { manifest } from './manifest'
import { CoachEngine } from './lib/coach'
import { startCamera, type CameraHandle } from './lib/camera'
import { createPoseRunner, type PoseRunner } from './lib/pose-runner'
import { EXERCISE_META, exerciseName } from './lib/exercises'
import { listSessions, saveSession, deleteSession, newId } from './lib/store'
import { buildWeeklyPlan, GOAL_LABELS, type DayPlan, type Goal, type Equipment } from './lib/plan'
import type { CoachFrame, Pose, SessionRecord } from './lib/types'
import RepHud from './components/RepHud.vue'
import SkeletonOverlay from './components/SkeletonOverlay.vue'
import TrendChart from './components/TrendChart.vue'

useSeo({
  title: '居家健身摄像头本地纠错教练 - 端侧姿态识别自动计数',
  description:
    '打开摄像头本地识别深蹲、俯卧撑、弓步蹲、臀桥、肩推、平板，自动计数并实时纠错评分，含训练计划与历史趋势；视频不录制、不上传，可离线使用。',
  type: 'SoftwareApplication'
})

const billing = useToolBilling(manifest.id)
const proEx = computed(() => billing.canUse('ex-pro').allowed)
const coachPro = computed(() => billing.canUse('coach-pro').allowed)
const planPro = computed(() => billing.canUse('plan-pro').allowed)
const trendPro = computed(() => billing.canUse('trend-pro').allowed)
async function buyPro() {
  await billing.buy('freemium-pro')
}

const tab = ref<'train' | 'plan' | 'history' | 'settings'>('train')
const exerciseId = ref('squat')
const facing = ref<'user' | 'environment'>('environment')
const mirror = ref(true)
const muted = ref(false)

type RunStatus = 'idle' | 'loading' | 'running' | 'error'
const status = ref<RunStatus>('idle')
const errMsg = ref('')
const logMsg = ref('')
const frame = ref<CoachFrame | null>(null)
const delegate = ref<'' | 'GPU' | 'CPU'>('')
const isTimed = ref(false)

let engine: CoachEngine | null = null
let runner: PoseRunner | null = null
let camera: CameraHandle | null = null
let rafId = 0
const videoEl = ref<HTMLVideoElement | null>(null)

// 免费用户：仅保留“幅度不足”这类基础提示，隐藏高级纠错与评分
const displayFrame = computed<CoachFrame | null>(() => {
  const f = frame.value
  if (!f) return f
  if (coachPro.value) return f
  return {
    ...f,
    lastScore: null,
    issues: f.issues.filter((i) => i.code.endsWith('-half'))
  }
})

/** 合成注入自检接缝：页面存在 window.__fzPoseInject() 时跳过摄像头/模型（仅供自动化 E2E） */
function injectProvider(): (() => Pose | null) | null {
  const w = window as unknown as { __fzPoseInject?: () => Pose | null }
  return typeof w.__fzPoseInject === 'function' ? w.__fzPoseInject : null
}

async function start() {
  if (status.value === 'running' || status.value === 'loading') return
  status.value = 'loading'
  errMsg.value = ''
  frame.value = null
  engine = new CoachEngine(exerciseId.value)
  engine.setMuted(muted.value)
  isTimed.value = engine.isTimed

  const inject = injectProvider()
  try {
    if (inject) {
      logMsg.value = '自检模式（合成关键点）'
      delegate.value = ''
    } else {
      camera = await startCamera(facing.value)
      if (videoEl.value) {
        videoEl.value.srcObject = camera.stream
        await videoEl.value.play().catch(() => undefined)
      }
      runner = await createPoseRunner((m) => (logMsg.value = m))
      delegate.value = runner.delegate
    }
    engine.start()
    status.value = 'running'
    let last = performance.now()
    const tick = async (t: number) => {
      if (status.value !== 'running' || !engine) return
      let pose: Pose | null = null
      if (inject) {
        pose = inject()
      } else if (runner && videoEl.value) {
        pose = runner.detect(videoEl.value, t)
      }
      frame.value = engine.onPose(pose, t)
      last = t
      void last
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  } catch (e) {
    errMsg.value = (e as Error).message ?? '启动失败'
    status.value = 'error'
    teardownRun()
  }
}

function teardownRun() {
  cancelAnimationFrame(rafId)
  rafId = 0
  try { runner?.close() } catch { /* ignore */ }
  runner = null
  camera?.stop()
  camera = null
  if (videoEl.value) videoEl.value.srcObject = null
}

async function stopAndSave() {
  if (!engine || status.value !== 'running') return
  const result = engine.stop()
  teardownRun()
  status.value = 'idle'
  if (result.reps > 0) {
    const rec: SessionRecord = {
      id: newId(),
      exerciseId: exerciseId.value,
      reps: result.reps,
      goodReps: result.goodReps,
      avgScore: result.avgScore,
      durationMs: result.durationMs,
      issueCounts: result.issueCounts,
      createdAt: Date.now()
    }
    await saveSession(rec)
    await refreshSessions()
  }
  frame.value = null
  engine = null
}

function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}分${s % 60}秒`
}

// ---- 计划 ----
const planGoal = ref<Goal>('fatloss')
const planEquip = ref<Equipment>('none')
const planDays = ref(3)
const weekPlan = ref<DayPlan[] | null>(null)
function generatePlan() {
  if (!planPro.value) return
  weekPlan.value = buildWeeklyPlan(planGoal.value, planEquip.value, planDays.value)
}

// ---- 历史 ----
const sessions = ref<SessionRecord[]>([])
async function refreshSessions() {
  sessions.value = await listSessions()
}
async function removeSession(id: string) {
  await deleteSession(id)
  await refreshSessions()
}
const trendData = computed(() => [...sessions.value].slice(0, 20).reverse())
const totalReps = computed(() => sessions.value.reduce((s, r) => s + r.reps, 0))

onMounted(refreshSessions)
onBeforeUnmount(teardownRun)
</script>

<template>
  <div class="coach">
    <div class="privacy">🔒 画面只在本机实时分析，<b>不录制、不上传</b>；首次加载模型后可离线使用。</div>

    <div class="tabs">
      <button :class="{ on: tab === 'train' }" @click="tab = 'train'">自由练</button>
      <button :class="{ on: tab === 'plan' }" @click="tab = 'plan'">训练计划</button>
      <button :class="{ on: tab === 'history' }" @click="tab = 'history'">历史趋势</button>
      <button :class="{ on: tab === 'settings' }" @click="tab = 'settings'">设置</button>
    </div>

    <!-- 自由练 -->
    <section v-if="tab === 'train'" class="card">
      <div class="ex-pick">
        <button
          v-for="ex in EXERCISE_META"
          :key="ex.id"
          class="ex-btn"
          :class="{ on: exerciseId === ex.id }"
          @click="exerciseId = ex.id"
        >
          {{ ex.name }}
          <span v-if="!ex.free" class="lock">Pro</span>
        </button>
      </div>

      <div class="stage-wrap">
        <div class="stage">
          <video
            v-if="status === 'running' || status === 'loading'"
            ref="videoEl"
            class="cam"
            playsinline
            muted
            :style="{ transform: mirror ? 'scaleX(-1)' : 'none' }"
          />
          <div v-if="status === 'running'" class="overlay">
            <SkeletonOverlay :pose="displayFrame?.smoothed ?? null" :mirror="mirror" />
            <RepHud v-if="displayFrame" :frame="displayFrame" :exercise-name="exerciseName(exerciseId)" :is-timed="isTimed" />
          </div>
          <div v-if="status === 'idle'" class="placeholder">
            <p>把手机侧放在地、对准全身侧面（深蹲/俯卧撑/平板），肩推可用正面。</p>
            <p class="muted">选择动作后点「开始」，允许摄像头权限。</p>
          </div>
          <div v-if="status === 'loading'" class="placeholder">{{ logMsg || '正在准备…' }}</div>
        </div>
      </div>

      <p v-if="errMsg" class="err">{{ errMsg }}</p>
      <p v-else-if="logMsg && status !== 'running'" class="muted">{{ logMsg }}</p>
      <p v-if="delegate === 'CPU'" class="muted">当前为 CPU 兼容模式，帧率可能较低，功能正常。</p>

      <!-- 选中 Pro 动作但未解锁 -->
      <div v-if="!proEx && !EXERCISE_META.find((e) => e.id === exerciseId)?.free" class="gate">
        <p>「{{ exerciseName(exerciseId) }}」为专业动作。</p>
        <button class="btn-primary" @click="buyPro">升级专业版 ¥49.90（买断）</button>
      </div>

      <template v-else>
        <div class="controls">
          <label v-if="status !== 'running'">
            摄像头
            <select v-model="facing">
              <option value="environment">后置（推荐）</option>
              <option value="user">前置</option>
            </select>
          </label>
          <label><input type="checkbox" v-model="mirror" :disabled="status === 'running'" /> 镜像</label>
          <label><input type="checkbox" v-model="muted" @change="engine?.setMuted(muted)" /> 静音语音</label>
        </div>
        <div class="run-btns">
          <button v-if="status !== 'running'" class="btn-primary big" :disabled="status === 'loading'" @click="start">
            {{ status === 'loading' ? '准备中…' : '开始跟练' }}
          </button>
          <button v-else class="btn-danger big" @click="stopAndSave">结束并保存</button>
        </div>
        <p v-if="!coachPro" class="muted small">免费版提供深蹲/俯卧撑自动计数与基础提示；升级后解锁全部动作、实时纠错与动作评分。</p>
      </template>
    </section>

    <!-- 计划 -->
    <section v-else-if="tab === 'plan'" class="card">
      <h3>周期训练计划</h3>
      <div v-if="!planPro" class="gate">
        <p>按目标与器械生成每周课表是专业功能。</p>
        <button class="btn-primary" @click="buyPro">升级专业版 ¥49.90（买断）</button>
      </div>
      <template v-else>
        <div class="controls">
          <label>目标
            <select v-model="planGoal">
              <option v-for="(label, key) in GOAL_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label>器械
            <select v-model="planEquip">
              <option value="none">无器械（自重）</option>
              <option value="dumbbell">有哑铃</option>
            </select>
          </label>
          <label>每周练
            <select v-model.number="planDays">
              <option :value="2">2 天</option>
              <option :value="3">3 天</option>
              <option :value="4">4 天</option>
              <option :value="5">5 天</option>
            </select>
          </label>
          <button class="btn-primary" @click="generatePlan">生成周计划</button>
        </div>
        <div v-if="weekPlan" class="week">
          <div v-for="d in weekPlan" :key="d.day" class="day" :class="{ rest: d.rest }">
            <div class="day-h">周{{ ['一', '二', '三', '四', '五', '六', '日'][d.day - 1] }} · {{ d.title }}</div>
            <ul v-if="!d.rest">
              <li v-for="(it, k) in d.items" :key="k">
                {{ exerciseName(it.exerciseId) }} · {{ it.sets }} 组 × {{ it.reps }}
              </li>
            </ul>
          </div>
        </div>
      </template>
    </section>

    <!-- 历史 -->
    <section v-else-if="tab === 'history'" class="card">
      <h3>训练记录 <span class="muted">共 {{ totalReps }} 次/秒</span></h3>
      <div v-if="trendPro" class="chart-box">
        <h4>最近 20 次平均动作分</h4>
        <TrendChart :sessions="trendData" />
      </div>
      <p v-else-if="sessions.length" class="muted small">升级专业版可查看趋势图。</p>
      <p v-if="sessions.length === 0" class="muted">还没有训练记录，去「自由练」完成一组吧。</p>
      <ul class="history">
        <li v-for="s in sessions" :key="s.id">
          <div>
            <b>{{ exerciseName(s.exerciseId) }}</b>
            <span class="muted"> · {{ s.reps }}{{ s.avgScore ? ` · 均分 ${s.avgScore}` : '' }} · {{ fmtTime(s.durationMs) }}</span>
            <div class="muted small">{{ new Date(s.createdAt).toLocaleString() }}</div>
          </div>
          <button class="link-danger" @click="removeSession(s.id)">删除</button>
        </li>
      </ul>
    </section>

    <!-- 设置 -->
    <section v-else class="card">
      <h3>设置与权益</h3>
      <ul class="settings-list">
        <li>深蹲 / 俯卧撑自动计数 + 基础提示 <span class="ok">免费</span></li>
        <li>弓步蹲 / 臀桥 / 肩推 / 平板 <span :class="proEx ? 'ok' : 'lock'">{{ proEx ? '已解锁' : 'Pro' }}</span></li>
        <li>实时纠错 + 动作评分 <span :class="coachPro ? 'ok' : 'lock'">{{ coachPro ? '已解锁' : 'Pro' }}</span></li>
        <li>周期训练计划 <span :class="planPro ? 'ok' : 'lock'">{{ planPro ? '已解锁' : 'Pro' }}</span></li>
        <li>历史趋势图 <span :class="trendPro ? 'ok' : 'lock'">{{ trendPro ? '已解锁' : 'Pro' }}</span></li>
      </ul>
      <button v-if="!proEx" class="btn-primary" @click="buyPro">升级专业版 ¥49.90（一次买断）</button>
      <p class="muted small">建议在光线充足处侧对摄像头、露出全身关节；判定为端侧辅助参考，疼痛请停止并咨询专业教练/医生。</p>
    </section>
  </div>
</template>

<style scoped>
.coach {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.privacy {
  font-size: 13px;
  color: #26704b;
  background: #eaf7ef;
  border: 1px solid #c8e8d5;
  border-radius: 10px;
  padding: 8px 12px;
}
.tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tabs button {
  flex: 1 1 auto;
  min-width: 72px;
  padding: 8px 10px;
  border: 1px solid var(--border, #ddd);
  background: #fff;
  border-radius: 10px;
  cursor: pointer;
}
.tabs button.on {
  background: #2ea063;
  color: #fff;
  border-color: #2ea063;
}
.card {
  background: #fff;
  border: 1px solid var(--border, #e7e7e7);
  border-radius: 14px;
  padding: 14px;
}
.ex-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.ex-btn {
  position: relative;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid #d4d4d4;
  background: #fafafa;
  cursor: pointer;
}
.ex-btn.on {
  background: #eaf7ef;
  border-color: #2ea063;
  color: #1f6b45;
  font-weight: 600;
}
.lock {
  margin-left: 6px;
  font-size: 11px;
  color: #b5810f;
}
.stage-wrap {
  display: flex;
  justify-content: center;
}
.stage {
  position: relative;
  width: 100%;
  max-width: 560px;
  aspect-ratio: 3 / 4;
  background: #111;
  border-radius: 14px;
  overflow: hidden;
}
.cam {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.overlay {
  position: absolute;
  inset: 0;
}
.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #d7e7dd;
  text-align: center;
  padding: 20px;
  font-size: 15px;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
  font-size: 14px;
}
.controls select {
  padding: 4px 6px;
}
.run-btns {
  display: flex;
  justify-content: center;
}
.big {
  padding: 12px 34px;
  font-size: 16px;
  border-radius: 12px;
}
.btn-primary {
  background: #2ea063;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 10px;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn-danger {
  background: #d64545;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 10px;
  cursor: pointer;
}
.err {
  color: #c0392b;
  background: #fdecea;
  border-radius: 8px;
  padding: 8px 10px;
}
.gate {
  border: 1px dashed #cfe3d6;
  background: #f6fbf8;
  border-radius: 10px;
  padding: 14px;
  text-align: center;
  margin-top: 12px;
}
.week {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.day {
  border: 1px solid #e7e7e7;
  border-radius: 10px;
  padding: 10px;
}
.day.rest {
  background: #fafafa;
  color: #888;
}
.day-h {
  font-weight: 600;
  margin-bottom: 6px;
}
.day ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
.chart-box {
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 12px;
}
.history {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}
.link-danger {
  background: none;
  border: none;
  color: #d64545;
  cursor: pointer;
}
.settings-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
}
.settings-list li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f2f2f2;
}
.ok {
  color: #2ea063;
}
.muted {
  color: #8a8f8c;
}
.small {
  font-size: 12px;
}
</style>
