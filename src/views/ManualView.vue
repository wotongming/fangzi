<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { renderMarkdown, handleMarkdownAnchorClick } from '../core/markdown'
import { USER_MANUAL } from '../core/manual'

const html = computed(() => renderMarkdown(USER_MANUAL))

function onClick(e: MouseEvent) {
  // hash 路由下必须拦截页内 # 锚点，否则会改 location.hash 被路由当新地址跳回首页
  handleMarkdownAnchorClick(e)
}
</script>

<template>
  <div class="container help-page">
    <div class="top">
      <RouterLink class="back" to="/">← 返回我的方子</RouterLink>
      <h1>新手使用指南</h1>
      <p class="faint">第一次用方子？花 2 分钟读一遍，安装、搜索、计费与隐私一次讲清。</p>
    </div>
    <article class="markdown-body" v-html="html" @click="onClick"></article>
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
/* 吸顶导航高约 58px，页内锚点跳转时留出间距，避免标题被遮住 */
.markdown-body :deep(h1[id]),
.markdown-body :deep(h2[id]),
.markdown-body :deep(h3[id]),
.markdown-body :deep(h4[id]) {
  scroll-margin-top: 72px;
}
.markdown-body :deep(a.md-anchor) {
  cursor: pointer;
}
</style>
