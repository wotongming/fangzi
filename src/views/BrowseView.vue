<script setup lang="ts">
import { computed, ref } from 'vue'
import { allTools } from '../core/registry'
import type { ToolCategory, ToolType } from '../core/types'
import { CATEGORY_LABELS, TOOL_TYPE_LABELS } from '../core/constants'
import { useToolsStore } from '../stores/tools'
import ToolCard from '../components/ToolCard.vue'

const toolsStore = useToolsStore()
const cat = ref<ToolCategory | 'all'>('all')
const type = ref<ToolType | 'all'>('all')
const kw = ref('')

const categories = computed(() => {
  const set = new Set(allTools().map((t) => t.manifest.category))
  return ['all', ...[...set]] as Array<ToolCategory | 'all'>
})

const resultIds = ref<Set<string> | null>(null)

async function onKw() {
  const q = kw.value.trim()
  if (!q) {
    resultIds.value = null
    return
  }
  const outcome = await toolsStore.search(q)
  resultIds.value = new Set(outcome.hits.map((h) => h.doc.id))
}

const list = computed(() => {
  let arr = allTools()
  if (cat.value !== 'all') arr = arr.filter((t) => t.manifest.category === cat.value)
  if (type.value !== 'all') arr = arr.filter((t) => t.manifest.type === type.value)
  if (resultIds.value) arr = arr.filter((t) => resultIds.value!.has(t.manifest.id))
  return arr
})
</script>

<template>
  <div class="container browse">
    <h1>方子铺</h1>

    <div class="filters card">
      <div class="frow">
        <span class="flabel">分类</span>
        <button
          v-for="c in categories"
          :key="c"
          class="fchip"
          :class="{ active: cat === c }"
          @click="cat = c"
        >
          {{ c === 'all' ? '全部' : CATEGORY_LABELS[c] }}
        </button>
      </div>
      <div class="frow">
        <span class="flabel">类型</span>
        <button class="fchip" :class="{ active: type === 'all' }" @click="type = 'all'">全部</button>
        <button
          v-for="(label, key) in TOOL_TYPE_LABELS"
          :key="key"
          class="fchip"
          :class="{ active: type === key }"
          @click="type = key as ToolType"
        >
          {{ label }}
        </button>
      </div>
      <div class="frow">
        <input v-model="kw" class="kw" placeholder="在当前分类内关键词过滤…" @input="onKw" />
      </div>
    </div>

    <p class="faint count">共 {{ list.length }} 个工具</p>

    <div class="grid">
      <ToolCard v-for="t in list" :key="t.manifest.id" :tool="t" :query="kw" />
    </div>
    <p v-if="!list.length" class="muted empty">当前筛选条件下没有工具，试试放宽条件。</p>
  </div>
</template>

<style scoped>
.browse {
  padding-top: 24px;
  padding-bottom: 60px;
}
h1 {
  font-size: 22px;
  margin: 0 0 16px;
}
.filters {
  padding: 14px 18px;
  display: grid;
  gap: 10px;
}
.frow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.flabel {
  font-size: 13px;
  color: var(--ink-faint);
  width: 40px;
  flex-shrink: 0;
}
.fchip {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 13px;
  color: var(--ink-soft);
}
.fchip.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.kw {
  flex: 1;
  min-width: 200px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-size: 14px;
}
.kw:focus {
  outline: none;
  border-color: var(--brand);
}
.count {
  font-size: 13px;
  margin: 14px 2px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.empty {
  text-align: center;
  padding: 40px 0;
}
</style>
