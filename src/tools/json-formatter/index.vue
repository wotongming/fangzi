<script setup lang="ts">
import { computed, ref } from 'vue'

const input = ref('{"name":"方子","tools":[{"id":1,"free":true},{"id":2,"free":null}]}')
const output = ref('')
const error = ref<{ msg: string; line: number; col: number; snippet: string } | null>(null)
const copied = ref(false)

function locate(text: string, position: number) {
  const before = text.slice(0, position)
  const line = before.split('\n').length
  const col = position - before.lastIndexOf('\n')
  const lines = text.split('\n')
  const ln = lines[line - 1] ?? ''
  const start = Math.max(0, col - 1 - 20)
  const snippet = ln.slice(start, col - 1 + 20) + (ln.length > col + 20 ? '…' : '')
  return { line, col, snippet }
}

function parse(): unknown | null {
  error.value = null
  const raw = input.value.trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const m = msg.match(/position\s+(\d+)/i)
    if (m) {
      const pos = Number(m[1])
      const loc = locate(input.value, pos)
      error.value = { msg, ...loc }
    } else {
      error.value = { msg, line: 0, col: 0, snippet: '' }
    }
    return null
  }
}

function format() {
  const v = parse()
  if (v !== null) output.value = JSON.stringify(v, null, 2)
}
function minify() {
  const v = parse()
  if (v !== null) output.value = JSON.stringify(v)
}
function escapeStr() {
  // 把输入的 JSON 文本转成可嵌入代码的字符串字面量内容
  output.value = JSON.stringify(input.value.trim())
  error.value = null
}
function unescapeStr() {
  const raw = input.value.trim()
  try {
    const v = JSON.parse(raw.startsWith('"') ? raw : `"${raw.replace(/"/g, '\\"')}"`)
    if (typeof v === 'string') {
      output.value = v
      error.value = null
    }
  } catch {
    error.value = { msg: '不是合法的转义字符串', line: 0, col: 0, snippet: '' }
  }
}

const stats = computed(() => {
  if (!output.value) return ''
  let keys = 0
  const count = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(count)
    else if (v && typeof v === 'object') {
      keys += Object.keys(v).length
      Object.values(v).forEach(count)
    }
  }
  try {
    count(JSON.parse(output.value))
    return `${output.value.length.toLocaleString()} 字符`
  } catch {
    return `${output.value.length.toLocaleString()} 字符`
  }
})

async function copyOut() {
  try {
    await navigator.clipboard.writeText(output.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1200)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="tool-pad">
    <div class="card box">
      <div class="bar">
        <strong>输入 JSON</strong>
        <div class="actions">
          <button class="btn" @click="format">美化</button>
          <button class="btn" @click="minify">压缩</button>
          <button class="btn" @click="escapeStr">转义</button>
          <button class="btn" @click="unescapeStr">去转义</button>
        </div>
      </div>
      <textarea v-model="input" class="ta" rows="10" spellcheck="false" placeholder='{"a":1}'></textarea>
      <div v-if="error" class="errbox">
        <p><b>JSON 语法错误</b>：{{ error.msg }}</p>
        <p v-if="error.line">位置：第 {{ error.line }} 行 第 {{ error.col }} 列</p>
        <code v-if="error.snippet">…{{ error.snippet }}…</code>
      </div>
    </div>

    <div v-if="output" class="card box">
      <div class="bar">
        <strong>结果 <span class="faint">{{ stats }}</span></strong>
        <button class="btn btn-ghost" @click="copyOut">{{ copied ? '已复制' : '复制结果' }}</button>
      </div>
      <pre class="out">{{ output }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-pad {
  display: grid;
  gap: 14px;
}
.box {
  padding: 14px 16px;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 10px;
  flex-wrap: wrap;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ta {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fdfdfb;
  font-family: Consolas, 'SFMono-Regular', monospace;
  font-size: 13px;
  resize: vertical;
}
.ta:focus {
  outline: none;
  border-color: var(--brand);
}
.errbox {
  margin-top: 10px;
  border: 1px solid #e6c3bf;
  background: #fbecea;
  border-radius: 9px;
  padding: 10px 12px;
  font-size: 13px;
  color: #8f3229;
}
.errbox code {
  display: block;
  margin-top: 6px;
  white-space: pre-wrap;
  word-break: break-all;
}
.out {
  margin: 0;
  background: #f6f4ee;
  border-radius: 9px;
  padding: 12px;
  font-size: 13px;
  max-height: 460px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
