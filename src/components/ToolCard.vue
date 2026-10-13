<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { RegisteredTool } from '../core/registry'
import type { SearchHighlight } from '../core/types'
import { CATEGORY_LABELS, TOOL_TYPE_LABELS, formatPrice } from '../core/constants'
import { highlightSnippet } from '../core/search/highlight'
import { useFavoritesStore } from '../stores/favorites'

const props = defineProps<{
  tool: RegisteredTool
  query?: string
  snippets?: SearchHighlight[]
}>()

const favorites = useFavoritesStore()
const m = computed(() => props.tool.manifest)

const billingText = computed(() => {
  const b = m.value.billing
  switch (b.mode) {
    case 'free':
      return '免费'
    case 'buyout':
      return `买断 ${formatPrice(b.priceCents, b.currency)}`
    case 'freemium':
      return `免费增值${b.priceCents ? ' · 高级 ' + formatPrice(b.priceCents, b.currency) : ''}`
    case 'usage':
      return `按${b.unit ?? '次'} ${formatPrice(b.pricePerUnitCents, b.currency)}/${b.unit ?? '次'}`
  }
})

const nameHtml = computed(() => highlightSnippet(m.value.name, props.query ?? ''))
const taglineHtml = computed(() => highlightSnippet(m.value.tagline, props.query ?? ''))
const snippetHtml = computed(() => {
  const s = props.snippets?.find((x) => x.field === 'scenarios' || x.field === 'painPoints' || x.field === 'keywords')
  return s ? highlightSnippet(s.snippet, props.query ?? '') : ''
})
</script>

<template>
  <RouterLink :to="`/t/${m.id}`" class="tool-card card">
    <div class="tc-head">
      <h3 class="tc-name" v-html="nameHtml"></h3>
      <button
        class="fav"
        :class="{ on: favorites.isFavorite(m.id) }"
        :title="favorites.isFavorite(m.id) ? '从首页移除' : '添加到首页'"
        @click.prevent.stop="favorites.toggle(m.id)"
      >
        {{ favorites.isFavorite(m.id) ? '★' : '☆' }}
      </button>
    </div>
    <p class="tc-tagline" v-html="taglineHtml"></p>
    <p v-if="snippetHtml" class="tc-snippet" v-html="snippetHtml"></p>
    <div class="tc-tags">
      <span class="tag">{{ CATEGORY_LABELS[m.category] }}</span>
      <span class="tag muted">{{ TOOL_TYPE_LABELS[m.type] }}</span>
      <span class="tag" :class="{ accent: m.billing.mode !== 'free' }">{{ billingText }}</span>
      <span v-if="m.status === 'beta'" class="tag muted">Beta</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
  text-decoration: none !important;
  color: inherit;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.tool-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
  border-color: var(--brand);
}
.tc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.tc-name {
  margin: 0;
  font-size: 16px;
  color: var(--ink);
}
.fav {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: var(--ink-faint);
  padding: 0 2px;
  flex-shrink: 0;
}
.fav.on {
  color: #e0a526;
}
.tc-tagline {
  margin: 0;
  font-size: 13.5px;
  color: var(--ink-soft);
}
.tc-snippet {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  background: #f6f4ee;
  border-radius: 8px;
  padding: 6px 10px;
}
.tc-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
</style>
