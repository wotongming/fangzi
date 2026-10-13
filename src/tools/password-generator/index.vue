<script setup lang="ts">
import { computed, ref } from 'vue'

const length = ref(20)
const useUpper = ref(true)
const useLower = ref(true)
const useDigits = ref(true)
const useSymbols = ref(true)
const avoidAmbiguous = ref(true)
const count = ref(1)
const results = ref<string[]>([])
const copied = ref('')

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?'
}
const AMBIGUOUS = new Set('O0o1lI|`\'')

function securePick(pool: string): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return pool[buf[0]! % pool.length]!
}

function shuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = buf[0]! % (i + 1)
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

function buildPool(): string {
  let pool = ''
  if (useUpper.value) pool += SETS.upper
  if (useLower.value) pool += SETS.lower
  if (useDigits.value) pool += SETS.digits
  if (useSymbols.value) pool += SETS.symbols
  if (avoidAmbiguous.value) pool = [...pool].filter((c) => !AMBIGUOUS.has(c)).join('')
  return pool
}

const error = computed(() => (buildPool().length === 0 ? '至少选择一种字符集' : ''))

function generateOne(pool: string, n: number): string {
  const chars: string[] = []
  // 保证每类至少一个字符（在该类被选中时）
  const required: string[] = []
  const pushSet = (on: boolean, set: string) => {
    if (!on) return
    const s = avoidAmbiguous.value ? [...set].filter((c) => !AMBIGUOUS.has(c)).join('') : set
    if (s) required.push(securePick(s))
  }
  pushSet(useUpper.value, SETS.upper)
  pushSet(useLower.value, SETS.lower)
  pushSet(useDigits.value, SETS.digits)
  pushSet(useSymbols.value, SETS.symbols)

  for (let i = 0; i < n; i++) chars.push(securePick(pool))
  // 用必含字符覆盖前若干位，再整体洗牌，保证随机性与覆盖
  required.forEach((c, idx) => {
    if (idx < chars.length) chars[idx] = c
  })
  return shuffle(chars).join('')
}

function generate() {
  if (error.value) {
    results.value = []
    return
  }
  const pool = buildPool()
  const n = Math.min(128, Math.max(4, length.value))
  const k = Math.min(50, Math.max(1, count.value))
  results.value = Array.from({ length: k }, () => generateOne(pool, n))
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => (copied.value = ''), 1200)
  } catch {
    /* 剪贴板权限被拒 */
  }
}

const strength = computed(() => {
  const poolSize = buildPool().length
  const bits = Math.round(length.value * Math.log2(poolSize || 1))
  if (bits < 50) return { label: '较弱', color: '#c0473b' }
  if (bits < 80) return { label: '中等', color: '#c8743a' }
  if (bits < 112) return { label: '强', color: '#3f7d5e' }
  return { label: '极强', color: '#2f6b4d' }
})

generate()
</script>

<template>
  <div class="tool-pad">
    <div class="controls card">
      <div class="row">
        <label>长度 <strong>{{ length }}</strong></label>
        <input v-model.number="length" type="range" min="4" max="128" />
      </div>
      <div class="row">
        <label>生成数量 <strong>{{ count }}</strong></label>
        <input v-model.number="count" type="range" min="1" max="50" />
      </div>
      <div class="row checks">
        <label><input v-model="useUpper" type="checkbox" /> 大写 A-Z</label>
        <label><input v-model="useLower" type="checkbox" /> 小写 a-z</label>
        <label><input v-model="useDigits" type="checkbox" /> 数字 0-9</label>
        <label><input v-model="useSymbols" type="checkbox" /> 符号</label>
        <label><input v-model="avoidAmbiguous" type="checkbox" /> 排除易混淆 (0/O 1/l)</label>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
      <div class="row between">
        <span class="strength" :style="{ color: strength.color }">
          熵约 {{ Math.round(length * Math.log2(buildPool().length || 1)) }} bit · {{ strength.label }}
        </span>
        <button class="btn btn-primary" :disabled="!!error" @click="generate">重新生成</button>
      </div>
    </div>

    <ul class="result card">
      <li v-for="(p, i) in results" :key="i">
        <code>{{ p }}</code>
        <button class="btn btn-ghost" @click="copy(p)">{{ copied === p ? '已复制' : '复制' }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.controls .row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 4px;
  flex-wrap: wrap;
}
.controls .row.between {
  justify-content: space-between;
}
.checks label {
  font-size: 14px;
  display: inline-flex;
  gap: 5px;
  align-items: center;
  margin-right: 10px;
}
input[type='range'] {
  flex: 1;
  min-width: 160px;
  accent-color: var(--brand);
}
.err {
  color: var(--danger);
  margin: 4px;
}
.strength {
  font-size: 13px;
  font-weight: 600;
}
.result {
  list-style: none;
  margin: 0;
  padding: 6px 14px;
}
.result li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--line);
}
.result li:last-child {
  border-bottom: none;
}
.result code {
  word-break: break-all;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 14px;
}
</style>
