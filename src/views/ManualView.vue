<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { renderMarkdown } from '../core/markdown'
import { USER_MANUAL } from '../core/manual'

const html = computed(() => renderMarkdown(USER_MANUAL))
</script>

<template>
  <div class="container help-page">
    <div class="top">
      <RouterLink class="back" to="/">← 返回开方子</RouterLink>
      <h1>新手使用指南</h1>
      <p class="faint">第一次用方子？花 2 分钟读一遍，安装、搜索、计费与隐私一次讲清。</p>
    </div>
    <article class="markdown-body" v-html="html"></article>
  </div>
</template>

<style scoped>
.help-page {
  padding-top: 24px;
  padding-bottom: 60px;
}
.top h1 {
  font-size: 22px;
  margin: 12px 0 6px;
}
.back {
  font-size: 14px;
}
</style>
