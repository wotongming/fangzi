<script setup lang="ts">
import { computed, ref } from 'vue'
import { escapeHtml } from '@/core/search/highlight'

const pattern = ref('1[3-9]\\d{9}')
const flags = ref({ g: true, i: false, m: false, s: false, u: false })
const text = ref('联系方式：13812345678，备用 15900001111。')
const replaceWith = ref('')

const TEMPLATES: Record<string, string> = {
  手机号: '1[3-9]\\d{9}',
  邮箱: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+',
  身份证号: '[1-9]\\d{5}(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]',
  URL: 'https?://[\\w.-]+(?:/[^\\s]*)?',
  IPv4: '(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)',
  日期YYYY_MM_DD: '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])'
}

const TEMPLATE_NAMES = Object.keys(TEMPLATES)
const FLAG_KEYS = ['g', 'i', 'm', 's', 'u'] as const

interface MatchInfo {
  index: number
  value: string
  groups: string[]
}

const result = computed(() => {
  const flagStr = Object.entries(flags.value)
    .filter(([, on]) => on)
    .map(([f]) => f)
    .join('')
  if (!pattern.value) return { error: '', matches: [], highlighted: escapeHtml(text.value), replaced: '', count: 0 }
  let re: RegExp
  try {
    re = new RegExp(pattern.value, flagStr.includes('g') ? flagStr : flagStr + 'g')
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      matches: [],
      highlighted: escapeHtml(text.value),
      replaced: '',
      count: 0
    }
  }

  const matches: MatchInfo[] = []
  const ranges: Array<[number, number]> = []
  let guard = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text.value)) !== null) {
    if (guard++ > 100000) break
    matches.push({ index: m.index, value: m[0], groups: m.slice(1) })
    ranges.push([m.index, m.index + m[0].length])
    if (m[0].length === 0) re.lastIndex++ // 防止零宽匹配死循环
    if (!flags.value.g) break
  }

  // 合并区间后高亮
  ranges.sort((a, b) => a[0] - b[0])
  let html = ''
  let cursor = 0
  for (const [s, e] of ranges) {
    if (s < cursor) continue
    html += escapeHtml(text.value.slice(cursor, s))
    html += '<mark>' + escapeHtml(text.value.slice(s, e)) + '</mark>'
    cursor = e
  }
  html += escapeHtml(text.value.slice(cursor))

  let replaced = ''
  if (replaceWith.value) {
    try {
      replaced = text.value.replace(new RegExp(pattern.value, flagStr), replaceWith.value)
    } catch {
      replaced = ''
    }
  }

  return { error: '', matches, highlighted: html, replaced, count: matches.length }
})

function useTemplate(name: string) {
  pattern.value = TEMPLATES[name]!
}
</script>

<template>
  <div class="tool-pad">
    <div class="card box">
      <div class="pat-row">
        <span class="slash">/</span>
        <input v-model="pattern" class="pat" spellcheck="false" placeholder="正则表达式" />
        <span class="slash">/</span>
        <span class="flags">
          <label v-for="f in FLAG_KEYS" :key="f">
            <input v-model="flags[f]" type="checkbox" />{{ f }}
          </label>
        </span>
      </div>
      <div class="templates">
        <span class="faint">常用模板：</span>
        <button v-for="name in TEMPLATE_NAMES" :key="name" class="tag tpl" @click="useTemplate(name)">
          {{ name }}
        </button>
      </div>
      <p v-if="result.error" class="err">正则错误：{{ result.error }}</p>
    </div>

    <div class="card box">
      <h3>测试文本（匹配 {{ result.count }} 处）</h3>
      <textarea v-model="text" class="ta" rows="6" spellcheck="false"></textarea>
      <div class="preview" v-html="result.highlighted"></div>
    </div>

    <div v-if="result.matches.length" class="card box">
      <h3>匹配与捕获分组</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>位置</th>
              <th>完整匹配</th>
              <th>捕获分组</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(mt, i) in result.matches" :key="i">
              <td>{{ i + 1 }}</td>
              <td>{{ mt.index }}</td>
              <td><code>{{ mt.value }}</code></td>
              <td>{{ mt.groups.length ? mt.groups.join(' | ') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card box">
      <h3>替换（可选）</h3>
      <input v-model="replaceWith" class="inp" placeholder="替换为，如 [已隐藏]，支持 $1" />
      <pre v-if="result.replaced" class="replaced">{{ result.replaced }}</pre>
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
.box h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
.pat-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slash {
  font-size: 20px;
  color: var(--ink-faint);
}
.pat {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-family: Consolas, monospace;
  font-size: 15px;
}
.pat:focus {
  outline: none;
  border-color: var(--brand);
}
.flags {
  display: flex;
  gap: 6px;
}
.flags label {
  font-family: Consolas, monospace;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.templates {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}
.tpl {
  cursor: pointer;
  border: 1px solid var(--line);
}
.err {
  color: var(--danger);
  margin: 10px 0 0;
}
.ta,
.inp {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-family: Consolas, monospace;
  font-size: 13px;
}
.ta {
  resize: vertical;
}
.ta:focus,
.inp:focus {
  outline: none;
  border-color: var(--brand);
}
.preview {
  margin-top: 10px;
  padding: 10px 12px;
  background: #f6f4ee;
  border-radius: 9px;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-all;
  min-height: 40px;
}
.table-wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
th,
td {
  border: 1px solid var(--line);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
th {
  background: #f6f4ee;
}
.replaced {
  margin: 10px 0 0;
  background: #f6f4ee;
  padding: 10px 12px;
  border-radius: 9px;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 13px;
}
</style>
