<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { manifest } from './manifest'
import { useSeo } from '@/composables/useSeo'
import { useToolBilling } from '@/composables/useToolBilling'
import { decodeTo16k, startMic, type MicSession } from './lib/input'
import { ensureTranscriber, transcribe, MODEL_LABEL } from './lib/asr'
import { toSegments, formatClock, joinSegments } from './lib/segment'
import { summarize } from './lib/summarize'
import { computePeaks, drawWaveform, xToTime } from './lib/waveform'
import { exportRecord } from './lib/export'
import { listRecords, saveRecord, deleteRecord, newId } from './lib/store'
import { quotaState, addUsedSeconds, type QuotaState } from './lib/quota'
import type { AsrProgress, Segment, TranscriptRecord } from './lib/types'

useSeo({
  title: `${manifest.name} - 方子`,
  description:
    '录音、会议、采访音频在浏览器本地离线转写为带时间戳文字稿，可回听定位、编辑分段、导出文本/Markdown/SRT 字幕并自动生成会议纪要，音频不出设备。',
  type: 'WebApplication',
  keywords: manifest.keywords
})

const billing = useToolBilling(manifest.id)
const pro = computed(() => billing.isOwned('freemium-pro') || billing.isOwned('buyout'))
const priceText = billing.priceText(billing.plan.priceCents)

const tab = ref<'transcribe' | 'history'>('transcribe')
const notice = ref('')
let noticeTimer: number | undefined
function flash(msg: string, ms = 4000): void {
  notice.value = msg
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), ms)
}

/* ---------------- 输入：文件 / 麦克风 ---------------- */
const sourceName = ref('')
const pcm = ref<Float32Array | null>(null)
const durationSec = ref(0)
const audioUrl = ref('')
const audioReady = ref(false)
const busy = ref(false)
const progress = ref<AsrProgress>({ phase: 'load', percent: 0, message: '' })
const language = ref<'auto' | 'chinese' | 'english'>('auto')
const langLabel = computed(() => (language.value === 'chinese' ? '中文' : language.value === 'english' ? '英文' : '自动检测'))

const ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm'

function revokeAudio(): void {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = ''
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await loadBlob(file, file.name)
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file) await loadBlob(file, file.name)
}
function onDragOver(e: DragEvent): void {
  e.preventDefault()
}

async function loadBlob(blob: Blob, name: string): Promise<void> {
  busy.value = true
  progress.value = { phase: 'transcribe', percent: 10, message: '正在解码音频…' }
  try {
    const decoded = await decodeTo16k(blob)
    if (decoded.durationSec < 0.3) throw new Error('音频过短（不足 1 秒），请选择有效的录音文件')
    pcm.value = decoded.pcm
    durationSec.value = decoded.durationSec
    sourceName.value = name
    revokeAudio()
    audioUrl.value = URL.createObjectURL(blob)
    audioReady.value = true
    current.value = null
    await nextTick()
    drawCurrentWave()
  } catch (err) {
    flash((err as Error).message)
  } finally {
    busy.value = false
    progress.value = { phase: 'load', percent: 0, message: '' }
  }
}

/* 麦克风 */
const recording = ref(false)
const recSeconds = ref(0)
const micLevel = ref(0)
let mic: MicSession | null = null
let recTimer: number | undefined
let levelRaf = 0
async function toggleMic(): Promise<void> {
  if (recording.value) {
    try {
      const blob = await mic?.stop()
      stopRecTimers()
      recording.value = false
      if (blob) await loadBlob(blob, `麦克风录音 ${new Date().toLocaleString()}`)
    } catch (err) {
      stopRecTimers()
      recording.value = false
      flash((err as Error).message)
    }
    return
  }
  try {
    mic = await startMic()
    recording.value = true
    recSeconds.value = 0
    const t0 = Date.now()
    recTimer = window.setInterval(() => (recSeconds.value = Math.floor((Date.now() - t0) / 1000)), 200)
    const pump = () => {
      if (!recording.value) return
      micLevel.value = mic?.getLevel() ?? 0
      levelRaf = requestAnimationFrame(pump)
    }
    pump()
  } catch (err) {
    recording.value = false
    flash('无法使用麦克风：' + (err as Error).message + '（可改用导入音频文件）')
  }
}
function stopRecTimers(): void {
  window.clearInterval(recTimer)
  cancelAnimationFrame(levelRaf)
  micLevel.value = 0
}
function cancelMic(): void {
  mic?.cancel()
  mic = null
  stopRecTimers()
  recording.value = false
}

/* ---------------- 转写 ---------------- */
const current = ref<TranscriptRecord | null>(null)

async function prepareModel(): Promise<void> {
  busy.value = true
  try {
    await ensureTranscriber((p) => (progress.value = p))
    flash('语音模型已就绪，可离线转写')
  } catch (err) {
    flash((err as Error).message)
  } finally {
    busy.value = false
  }
}

async function runTranscribe(): Promise<void> {
  if (!pcm.value || !audioReady.value) {
    flash('请先导入音频文件或完成一段录音')
    return
  }
  if (!pro.value) {
    const q = quotaState(false)
    if (q.exhausted) {
      flash(`本月免费转写额度（60 分钟）已用完，升级专业版 ${priceText} 即可不限时长`)
      return
    }
  }
  busy.value = true
  progress.value = { phase: 'load', percent: 0, message: '正在准备模型…' }
  try {
    const t0 = performance.now()
    const res = await transcribe(pcm.value, {
      language: language.value === 'auto' ? undefined : language.value,
      onProgress: (p) => (progress.value = p)
    })
    const segments: Segment[] = toSegments(
      res.chunks.map((c) => ({ timestamp: c.timestamp as [number | null, number | null], text: c.text })),
      durationSec.value
    )
    const fullText = segments.length ? joinSegments(segments) : res.fullText
    const summary = summarize(fullText)
    const now = Date.now()
    const rec: TranscriptRecord = {
      id: newId(),
      title: baseTitle(sourceName.value),
      durationSec: durationSec.value,
      sourceName: sourceName.value,
      language: langLabel.value,
      fullText,
      segments,
      summary,
      createdAt: now,
      updatedAt: now
    }
    // 免费用户计量（音频时长）；Pro / 买断不扣额度
    if (!pro.value) addUsedSeconds(durationSec.value)
    await saveRecord(rec)
    current.value = rec
    await refreshQuota()
    await refreshHistory()
    const secs = ((performance.now() - t0) / 1000).toFixed(1)
    flash(`转写完成，用时 ${secs}s（Whisper tiny 本地推理）`)
  } catch (err) {
    flash((err as Error).message)
  } finally {
    busy.value = false
    progress.value = { phase: 'done', percent: 100, message: '' }
  }
}

function baseTitle(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 60) || '未命名转写'
}

/* ---------------- 额度 ---------------- */
const quota = ref<QuotaState>(quotaState(pro.value))
async function refreshQuota(): Promise<void> {
  quota.value = quotaState(pro.value)
}
const quotaText = computed(() => {
  if (pro.value) return '专业版：转写时长不限'
  const used = Math.round((quota.value.usedSec / 60) * 10) / 10
  const total = Math.floor(quota.value.freeSec / 60)
  return `本月免费额度已用 ${used}/${total} 分钟`
})
async function upgrade(): Promise<void> {
  try {
    await billing.buy('freemium-pro')
    await refreshQuota()
    flash('专业版已解锁，转写时长不限')
  } catch (err) {
    flash((err as Error).message)
  }
}

/* ---------------- 波形与播放 ---------------- */
const waveRef = ref<HTMLCanvasElement | null>(null)
const audioRef = ref<HTMLAudioElement | null>(null)
const playSec = ref(0)
const playRate = ref(1)
let peaks: number[] = []
let rafId = 0

function drawCurrentWave(): void {
  const canvas = waveRef.value
  if (!canvas) return
  if (!peaks.length && pcm.value) peaks = computePeaks(pcm.value, 120)
  drawWaveform(canvas, {
    peaks: peaks.length ? peaks : new Array(120).fill(0.04),
    currentSec: playSec.value,
    durationSec: durationSec.value,
    playedColor: '#3f7d5e',
    restColor: '#c9c3b4'
  })
}

function pumpPlay(): void {
  const a = audioRef.value
  if (a && !a.paused) {
    playSec.value = a.currentTime
    drawCurrentWave()
    rafId = requestAnimationFrame(pumpPlay)
  }
}
function onTimeUpdate(): void {
  const a = audioRef.value
  if (a) playSec.value = a.currentTime
  drawCurrentWave()
}
function togglePlay(): void {
  const a = audioRef.value
  if (!a) return
  if (a.paused) {
    void a.play()
    rafId = requestAnimationFrame(pumpPlay)
  } else {
    a.pause()
  }
}
function onWaveClick(e: MouseEvent): void {
  const canvas = waveRef.value
  if (!canvas || !durationSec.value) return
  const t = xToTime(canvas, e.clientX, durationSec.value)
  seekTo(t)
}
function seekTo(t: number): void {
  const a = audioRef.value
  if (a) {
    a.currentTime = t
    playSec.value = t
    drawCurrentWave()
  } else {
    playSec.value = t
    drawCurrentWave()
  }
}
watch(playRate, (v) => {
  if (audioRef.value) audioRef.value.playbackRate = v
})
watch(audioUrl, async () => {
  peaks = []
  playSec.value = 0
  await nextTick()
  drawCurrentWave()
})
// 结果区（含波形 canvas）随 tab/current 用 v-if 挂载：切回「转写」或转写完成首次出现时，
// DOM 会重建、canvas 复位为空白，需在布局完成后重绘（双 rAF 确保拿到真实 clientWidth）。
watch([current, tab], () => {
  if (tab.value !== 'transcribe' || !current.value) return
  requestAnimationFrame(() => requestAnimationFrame(drawCurrentWave))
})

/* ---------------- 分段编辑 / 导出 / 历史 ---------------- */
const editingId = ref<string | null>(null)
function editSegment(seg: Segment): void {
  editingId.value = `${seg.start}-${seg.end}`
}
function commitSegment(seg: Segment, text: string): void {
  seg.text = text.trim()
  editingId.value = null
  const rec = current.value
  if (rec) {
    rec.fullText = joinSegments(rec.segments)
    void saveRecord(rec)
  }
}
function saveTitle(): void {
  if (current.value) void saveRecord(current.value)
}
function doExport(fmt: 'txt' | 'md' | 'srt'): void {
  if (!current.value) return
  exportRecord(current.value, fmt)
}

const history = ref<TranscriptRecord[]>([])
async function refreshHistory(): Promise<void> {
  history.value = await listRecords()
}
async function goHistory(): Promise<void> {
  tab.value = 'history'
  await refreshHistory()
}
function openRecord(rec: TranscriptRecord): void {
  current.value = rec
  tab.value = 'transcribe'
  // 历史记录不含音频本体：隐藏回听，仅展示文字稿
  revokeAudio()
  audioReady.value = false
  pcm.value = null
  durationSec.value = rec.durationSec
  sourceName.value = rec.sourceName
  playSec.value = 0
  peaks = []
  flash('已打开历史转写（音频未随记录保存，回听仅当次会话可用；文字稿与导出正常）', 5000)
}
async function removeRecord(rec: TranscriptRecord): Promise<void> {
  await deleteRecord(rec.id)
  if (current.value?.id === rec.id) current.value = null
  await refreshHistory()
}
function exportHistory(rec: TranscriptRecord): void {
  exportRecord(rec, 'md')
}
function newSession(): void {
  current.value = null
  pcm.value = null
  audioReady.value = false
  durationSec.value = 0
  sourceName.value = ''
  revokeAudio()
}

onMounted(async () => {
  await refreshQuota()
  await refreshHistory()
  window.addEventListener('resize', drawCurrentWave)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', drawCurrentWave)
  cancelAnimationFrame(rafId)
  cancelMic()
  revokeAudio()
})
</script>

<template>
  <div class="lt">
    <header class="top">
      <div>
        <h1>{{ manifest.name }}</h1>
        <p class="sub">{{ manifest.tagline }}</p>
      </div>
      <div class="pro-badge" :class="{ on: pro }">
        <span v-if="pro">● 专业版已解锁</span>
        <button v-else class="btn-up" @click="upgrade">升级专业版 {{ priceText }}（买断）</button>
      </div>
    </header>

    <nav class="tabs">
      <button :class="{ active: tab === 'transcribe' }" @click="tab = 'transcribe'">转写</button>
      <button :class="{ active: tab === 'history' }" @click="goHistory">历史 <i>{{ history.length }}</i></button>
    </nav>

    <transition name="fade"><p v-if="notice" class="notice">{{ notice }}</p></transition>

    <!-- ============ 转写 ============ -->
    <section v-if="tab === 'transcribe'" class="panel">
      <p class="muted small quota">{{ quotaText }} · 模型 {{ MODEL_LABEL }}，首次使用需下载，之后离线可转写。录音请确保已取得对方同意。</p>

      <!-- 输入区 -->
      <div v-if="!current" class="card drop" :class="{ over: false }" @drop="onDrop" @dragover="onDragOver">
        <div class="drop-inner">
          <div class="mic" :class="{ rec: recording }" @click="toggleMic">
            <span class="mic-dot" :style="{ transform: `scale(${1 + micLevel * 0.6})` }"></span>
          </div>
          <p v-if="recording" class="rec-t">录音中 {{ formatClock(recSeconds) }}（点击停止，<a @click.stop="cancelMic">放弃</a>）</p>
          <p v-else class="muted">点击麦克风开始录音，或拖入 / 选择音频文件</p>
          <div class="btnrow">
            <label class="btn-primary">
              ＋ 选择音频
              <input type="file" :accept="ACCEPT" hidden @change="onFile">
            </label>
            <button class="btn-ghost" :disabled="busy" @click="prepareModel">提前下载模型（离线可用）</button>
          </div>
          <p class="faint small">支持 wav / mp3 / m4a / ogg / flac / webm；全部在本机解码与识别，音频不上传。视频提音轨将在后续版本支持。</p>
        </div>
      </div>

      <!-- 已载入、待转写 -->
      <div v-if="!current && audioReady" class="card ready">
        <div class="bar">
          <div>
            <strong>{{ sourceName }}</strong>
            <span class="muted small"> · 时长 {{ formatClock(durationSec) }}</span>
          </div>
          <div class="btnrow">
            <label class="lang">语言
              <select v-model="language">
                <option value="auto">自动检测</option>
                <option value="chinese">中文</option>
                <option value="english">英文</option>
              </select>
            </label>
            <button class="btn-primary" :disabled="busy" @click="runTranscribe">{{ busy ? '处理中…' : '开始转写' }}</button>
          </div>
        </div>
        <div v-if="busy" class="progress">
          <div class="bar-track"><div class="bar-fill" :style="{ width: (progress.percent || 8) + '%' }"></div></div>
          <p class="muted small">{{ progress.message || '准备中…' }}</p>
        </div>
        <p v-else class="faint small">提示：Whisper tiny 对英文识别较好；中文可识别但准确率有限，更大模型（base/small）将在后续版本提供。</p>
      </div>

      <div v-if="busy && !audioReady" class="progress">
        <div class="bar-track"><div class="bar-fill" :style="{ width: (progress.percent || 8) + '%' }"></div></div>
        <p class="muted small">{{ progress.message || '准备中…' }}</p>
      </div>

      <!-- 结果区 -->
      <template v-if="current">
        <div class="card result-head">
          <div class="bar">
            <input class="title-input" v-model="current.title" @change="saveTitle" />
            <div class="btnrow">
              <button class="btn-ghost" @click="newSession">＋ 新建</button>
              <button class="btn-ghost" @click="doExport('txt')">导出 TXT</button>
              <button class="btn-ghost" @click="doExport('md')">导出 MD</button>
              <button class="btn-primary" @click="doExport('srt')">导出 SRT</button>
            </div>
          </div>
          <p class="faint small">{{ current.sourceName }} · {{ formatClock(current.durationSec) }} · {{ current.language }} · {{ current.segments.length }} 段</p>

          <!-- 播放器 + 波形（仅当次会话载入音频时可回听） -->
          <div v-if="audioUrl" class="player">
            <button class="play" @click="togglePlay">▶</button>
            <canvas ref="waveRef" class="wave" @click="onWaveClick"></canvas>
            <span class="clock">{{ formatClock(playSec) }} / {{ formatClock(durationSec) }}</span>
            <select v-model.number="playRate" class="rate" title="播放速度">
              <option :value="0.75">0.75x</option>
              <option :value="1">1x</option>
              <option :value="1.25">1.25x</option>
              <option :value="1.5">1.5x</option>
              <option :value="2">2x</option>
            </select>
            <audio ref="audioRef" :src="audioUrl" preload="metadata" @timeupdate="onTimeUpdate" @ended="drawCurrentWave"></audio>
          </div>
        </div>

        <div class="cols">
          <!-- 纪要 -->
          <div class="card summary">
            <h2>会议纪要 <span class="tag muted">本地抽取</span></h2>
            <p class="muted small" v-if="!current.summary">转写后自动生成</p>
            <template v-else>
              <div class="sum-block">
                <h3>一句话摘要</h3>
                <p>{{ current.summary.headline || '（无）' }}</p>
              </div>
              <div class="sum-block">
                <h3>关键要点</h3>
                <ul><li v-for="(x, i) in current.summary.keyPoints" :key="'k'+i">{{ x }}</li><li v-if="!current.summary.keyPoints.length" class="faint">未识别到</li></ul>
              </div>
              <div class="sum-block">
                <h3>待办 / 行动项</h3>
                <ul><li v-for="(x, i) in current.summary.actionItems" :key="'a'+i">{{ x }}</li><li v-if="!current.summary.actionItems.length" class="faint">未识别到</li></ul>
              </div>
              <div class="sum-block">
                <h3>已做决定</h3>
                <ul><li v-for="(x, i) in current.summary.decisions" :key="'d'+i">{{ x }}</li><li v-if="!current.summary.decisions.length" class="faint">未识别到</li></ul>
              </div>
            </template>
          </div>

          <!-- 分段文字稿 -->
          <div class="card segs">
            <h2>文字稿（点击时间戳回听）</h2>
            <div
              v-for="(seg, i) in current.segments"
              :key="i"
              class="seg"
              :class="{ active: audioUrl && playSec >= seg.start && playSec < seg.end }"
            >
              <button v-if="audioUrl" class="ts" @click="seekTo(seg.start)">{{ formatClock(seg.start) }}</button>
              <span v-else class="ts noaudio">{{ formatClock(seg.start) }}</span>
              <input
                v-if="editingId === `${seg.start}-${seg.end}`"
                class="seg-edit"
                :value="seg.text"
                autofocus
                @blur="commitSegment(seg, ($event.target as HTMLInputElement).value)"
                @keyup.enter="commitSegment(seg, ($event.target as HTMLInputElement).value)"
              />
              <span v-else class="seg-text" @click="editSegment(seg)">{{ seg.text }}</span>
            </div>
            <p v-if="!current.segments.length" class="muted small">{{ current.fullText || '（无分段）' }}</p>
          </div>
        </div>
      </template>
    </section>

    <!-- ============ 历史 ============ -->
    <section v-if="tab === 'history'" class="panel">
      <div class="bar">
        <h2 style="margin:0">本地转写历史 <span class="muted">（{{ history.length }}）</span></h2>
        <div class="btnrow"><label class="btn-primary">＋ 新转写<input type="file" :accept="ACCEPT" hidden @change="onFile"></label></div>
      </div>
      <p class="faint small">仅保存文字稿 / 分段 / 纪要与元信息，不保存音频本体；数据存于本机 IndexedDB，不上传。</p>
      <table v-if="history.length" class="hist">
        <thead><tr><th>标题</th><th>时长</th><th>语言</th><th>时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in history" :key="r.id">
            <td class="dn">{{ r.title }}<div class="faint small">{{ r.sourceName }}</div></td>
            <td>{{ formatClock(r.durationSec) }}</td>
            <td>{{ r.language }}</td>
            <td class="muted small">{{ new Date(r.createdAt).toLocaleString() }}</td>
            <td class="ops">
              <button class="btn-ghost" @click="openRecord(r)">打开</button>
              <button class="btn-ghost" @click="exportHistory(r)">导出MD</button>
              <button class="btn-danger" @click="removeRecord(r)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty muted">还没有转写记录，去「转写」页导入第一段音频吧。</div>
    </section>
  </div>
</template>

<style scoped>
.lt { max-width: 1080px; margin: 0 auto; padding: 8px 4px 60px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin: 8px 0 12px; }
.top h1 { font-size: 22px; margin: 0 0 6px; }
.sub { color: var(--ink-soft); font-size: 13px; line-height: 1.6; margin: 0; max-width: 720px; }
.pro-badge.on { color: var(--brand-dark); font-size: 13px; white-space: nowrap; }
.btn-up { border: 1px solid var(--brand); background: var(--brand); color: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.btn-up:hover { background: var(--brand-dark); }
.tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
.tabs button { background: none; border: none; padding: 10px 14px; font-size: 15px; color: var(--ink-soft); cursor: pointer; border-bottom: 2px solid transparent; }
.tabs button.active { color: var(--brand-dark); border-bottom-color: var(--brand); font-weight: 600; }
.tabs i { font-style: normal; color: var(--ink-faint); font-size: 12px; margin-left: 2px; }
.notice { background: var(--brand-soft); color: var(--brand-dark); border: 1px solid #cfe0d6; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.small { font-size: 12px; }
.quota { margin: 0 0 12px; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
.btnrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.drop { border-style: dashed; text-align: center; padding: 28px 16px; }
.drop-inner { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.mic { width: 72px; height: 72px; border-radius: 50%; background: var(--brand-soft); border: 2px solid var(--brand); display: grid; place-items: center; cursor: pointer; }
.mic .mic-dot { width: 22px; height: 22px; border-radius: 50%; background: var(--brand); transition: transform .08s linear; }
.mic.rec { border-color: #c0473b; }
.mic.rec .mic-dot { background: #c0473b; }
.rec-t { color: #c0473b; font-weight: 600; margin: 0; }
.rec-t a { color: var(--ink-soft); text-decoration: underline; cursor: pointer; }
.lang { font-size: 13px; color: var(--ink-soft); display: flex; align-items: center; gap: 6px; }
.lang select, .rate { padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.progress { margin-top: 12px; }
.bar-track { height: 8px; background: #eeeae0; border-radius: 6px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--brand); transition: width .2s; }
.result-head .title-input { flex: 1; min-width: 200px; font-size: 16px; font-weight: 600; border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; background: transparent; }
.result-head .title-input:hover, .result-head .title-input:focus { border-color: var(--line); background: #fff; outline: none; }
.player { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.play { width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--brand); background: var(--brand); color: #fff; cursor: pointer; font-size: 14px; flex: none; }
.wave { flex: 1; height: 72px; width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #fff; cursor: pointer; min-width: 120px; }
.clock { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--ink-soft); white-space: nowrap; }
.cols { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 14px; align-items: start; }
@media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
.summary h2, .segs h2 { font-size: 15px; margin: 0 0 10px; }
.sum-block { margin-bottom: 12px; }
.sum-block h3 { font-size: 13px; color: var(--brand-dark); margin: 0 0 6px; }
.sum-block p, .sum-block li { font-size: 13px; line-height: 1.6; margin: 2px 0; }
.sum-block ul { margin: 0; padding-left: 18px; }
.segs { max-height: 560px; overflow: auto; }
.seg { display: flex; gap: 10px; padding: 7px 6px; border-bottom: 1px solid #f0ede4; font-size: 14px; line-height: 1.6; align-items: baseline; }
.seg.active { background: var(--brand-soft); border-radius: 6px; }
.ts { flex: none; background: none; border: none; color: var(--brand-dark); font-variant-numeric: tabular-nums; font-size: 12px; cursor: pointer; padding: 0; min-width: 44px; text-align: left; }
.ts.noaudio { color: var(--ink-faint); cursor: default; }
.seg-text { cursor: text; }
.seg-edit { flex: 1; border: 1px solid var(--brand); border-radius: 6px; padding: 4px 6px; font-size: 14px; }
.hist { width: 100%; border-collapse: collapse; font-size: 13px; }
.hist th, .hist td { text-align: left; padding: 9px 8px; border-bottom: 1px solid #f0ede4; vertical-align: top; }
.hist .dn { max-width: 340px; }
.hist .ops { white-space: nowrap; }
.btn-danger { border: 1px solid #e2c4c0; background: #fff; color: #b14a3e; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.btn-danger:hover { background: #fbeceb; }
.empty { text-align: center; padding: 40px 0; }
@media (max-width: 560px) {
  .top { flex-direction: column; }
  .player { flex-wrap: wrap; }
  .wave { order: 5; flex-basis: 100%; }
}
</style>
