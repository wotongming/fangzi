<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const now = ref(Date.now())
let timer: number | undefined
onMounted(() => {
  timer = window.setInterval(() => (now.value = Date.now()), 1000)
})
onUnmounted(() => timer && clearInterval(timer))

const tsInput = ref('1728000000')
const dateInput = ref('2026-10-01T08:00')

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function formatBJ(d: Date): string {
  // 北京时间 UTC+8
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  const bj = new Date(utc + 8 * 3600000)
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(
    bj.getMinutes()
  )}:${pad(bj.getSeconds())}`
}

function detectUnit(raw: string): { ms: number; unit: string } | null {
  const t = raw.trim()
  if (!/^\d{10,16}$/.test(t)) return null
  const n = Number(t)
  // 10 位秒 / 13 位毫秒；11-12 位按数值大小推断
  const isSeconds = t.length <= 11 || n < 1e12
  return { ms: isSeconds ? n * 1000 : n, unit: isSeconds ? '秒' : '毫秒' }
}

const tsResult = computed(() => {
  const parsed = detectUnit(tsInput.value)
  if (!parsed) return null
  const d = new Date(parsed.ms)
  if (Number.isNaN(d.getTime())) return null
  return {
    unit: parsed.unit,
    bj: formatBJ(d),
    iso: d.toISOString(),
    seconds: Math.floor(parsed.ms / 1000),
    ms: parsed.ms
  }
})

const dateResult = computed(() => {
  if (!dateInput.value) return null
  const d = new Date(dateInput.value)
  if (Number.isNaN(d.getTime())) return null
  return { ms: d.getTime(), seconds: Math.floor(d.getTime() / 1000), bj: formatBJ(d) }
})

const batchInput = ref('1728000000\n1728086400000')
const batchResult = computed(() =>
  batchInput.value
    .split('\n')
    .map((line) => {
      const p = detectUnit(line)
      if (!p) return line.trim() ? `${line}  →  无法识别` : ''
      return `${line.trim()}  →  ${formatBJ(new Date(p.ms))}（${p.unit}）`
    })
    .filter(Boolean)
    .join('\n')
)

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="tool-pad">
    <div class="now card">
      <span>当前时间戳</span>
      <code>{{ Math.floor(now / 1000) }}</code>
      <span class="faint">秒</span>
      <code>{{ now }}</code>
      <span class="faint">毫秒</span>
      <button class="btn btn-ghost" @click="copy(String(Math.floor(now / 1000)))">复制秒</button>
    </div>

    <div class="grid">
      <div class="card box">
        <h3>时间戳 → 北京时间</h3>
        <input v-model="tsInput" class="inp" placeholder="输入 10 位秒或 13 位毫秒时间戳" inputmode="numeric" />
        <div v-if="tsResult" class="out">
          <p>识别单位：<b>{{ tsResult.unit }}</b></p>
          <p>北京时间：<b>{{ tsResult.bj }}</b></p>
          <p class="faint">UTC(ISO)：{{ tsResult.iso }}</p>
        </div>
        <p v-else-if="tsInput.trim()" class="err">无法识别，请输入 10~16 位纯数字</p>
      </div>

      <div class="card box">
        <h3>日期时间 → 时间戳</h3>
        <input v-model="dateInput" class="inp" type="datetime-local" step="1" />
        <div v-if="dateResult" class="out">
          <p>秒：<code>{{ dateResult.seconds }}</code></p>
          <p>毫秒：<code>{{ dateResult.ms }}</code></p>
          <p class="faint">按本地时区解析：{{ dateResult.bj }}</p>
        </div>
      </div>
    </div>

    <div class="card box">
      <h3>批量转换（每行一个时间戳）</h3>
      <textarea v-model="batchInput" class="ta" rows="5"></textarea>
      <pre class="batchout">{{ batchResult }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.now {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-wrap: wrap;
}
.now code {
  font-family: Consolas, monospace;
  font-size: 15px;
  color: var(--brand-dark);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.box {
  padding: 16px;
}
.box h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.inp,
.ta {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fdfdfb;
}
.inp:focus,
.ta:focus {
  outline: none;
  border-color: var(--brand);
}
.ta {
  resize: vertical;
  font-family: Consolas, monospace;
}
.out p {
  margin: 8px 0;
  font-size: 14px;
}
.err {
  color: var(--danger);
}
.batchout {
  background: #f6f4ee;
  border-radius: 9px;
  padding: 10px 12px;
  margin: 10px 0 0;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
