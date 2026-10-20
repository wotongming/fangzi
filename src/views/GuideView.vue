<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { getTool } from '../core/registry'
import { renderMarkdown } from '../core/markdown'

const props = defineProps<{ id: string }>()
const tool = computed(() => getTool(props.id))
const html = computed(() => (tool.value?.guide ? renderMarkdown(tool.value.guide) : ''))
</script>

<template>
  <div class="container guide-page" v-if="tool">
    <div class="top">
      <RouterLink class="back" :to="`/t/${tool.manifest.id}`">← 返回{{ tool.manifest.name }}</RouterLink>
      <h1>{{ tool.manifest.type === 'plugin' ? '插件使用手册' : '用户指导' }} · {{ tool.manifest.name }}</h1>
      <p class="faint">版本 {{ tool.manifest.version }} · 更新于 {{ tool.manifest.updatedAt }}</p>
    </div>
    <article v-if="html" class="markdown-body" v-html="html"></article>
    <div v-else class="card empty">该工具暂未提供使用指导。</div>
  </div>
  <div v-else class="container notfound">
    <p>没有找到这个工具。</p>
    <RouterLink class="btn btn-primary" to="/">回我的方子</RouterLink>
  </div>
</template>

<style scoped>
.guide-page {
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
.empty {
  padding: 30px;
  text-align: center;
}
.notfound {
  padding: 80px 20px;
  text-align: center;
  display: grid;
  gap: 16px;
  justify-items: center;
}
/* Markdown 内嵌长图：铺满容器宽、按比例缩放，手机端不产生横向滚动 */
:deep(.markdown-body img.md-img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 12px auto;
  border-radius: 12px;
}
</style>
