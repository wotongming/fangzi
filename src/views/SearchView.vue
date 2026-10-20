<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToolSearch } from '../composables/useToolSearch'
import ToolCard from '../components/ToolCard.vue'
import FeedbackDialog from '../components/FeedbackDialog.vue'

const route = useRoute()
const router = useRouter()
const {
  toolsStore,
  settings,
  query,
  hasSearched,
  outcome,
  feedbackOpen,
  samples,
  resultTool,
  runSearch,
  useSample,
  reshuffle,
  openFeedback
} = useToolSearch()

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

onMounted(() => {
  document.title = '搜索方子 - 方子'
  const q = route.query.q
  if (typeof q === 'string' && q.trim()) void runSearch(q.trim())
})
</script>

<template>
  <div class="container search-page">
    <div class="search-top">
      <button class="back-btn" type="button" aria-label="返回我的方子" @click="goBack">←</button>
      <span class="search-top-title">搜索方子</span>
    </div>

    <section class="hero" :class="{ compact: hasSearched }">
      <h1 v-if="!hasSearched" class="hero-title">说说你遇到的问题，给你开个小方子</h1>
      <div class="search-unit">
        <form class="searchbar" @submit.prevent="runSearch()">
          <input
            v-model="query"
            class="search-input"
            type="text"
            placeholder="说说你遇到的问题，给你开个小方子"
            aria-label="描述你遇到的问题"
            autocomplete="off"
          />
          <button class="btn btn-primary prescribe" type="submit" :disabled="toolsStore.searching || !query.trim()">
            {{ toolsStore.searching ? '开方中…' : '开方子' }}
          </button>
        </form>

        <div v-if="!hasSearched" class="ask">
          <div class="ask-head">
            <span class="ask-title">大家都在问</span>
            <button class="btn btn-ghost ask-shuffle" type="button" @click="reshuffle">换一批</button>
          </div>
          <div class="chips">
            <button v-for="s in samples" :key="s.text" class="chip" type="button" @click="useSample(s.text)">
              {{ s.text }}
            </button>
          </div>
          <p v-if="!settings.aiConfigured" class="faint small ai-tip">
            提示：在「设置」中配置 AI 接口后，可启用向量语义检索，口语化描述也能更准地命中工具。
          </p>
        </div>
      </div>

      <p v-if="hasSearched && outcome" class="mode-hint">
        <template v-if="outcome.mode === 'hybrid'">● 向量 + 关键词混合检索</template>
        <template v-else>● 关键词检索（2-gram + 关键词重叠）</template>
        <span v-if="outcome.degradedReason" class="faint"> · 向量通道暂不可用已自动降级</span>
        <span class="faint"> · 用时 {{ outcome.timingMs }}ms · 命中 {{ outcome.hits.length }} 个工具</span>
      </p>
    </section>

    <!-- 搜索结果 -->
    <section v-if="hasSearched" class="results">
      <template v-if="outcome && outcome.hits.length">
        <div class="grid">
          <ToolCard
            v-for="hit in outcome.hits"
            :key="hit.doc.id"
            :tool="resultTool(hit.doc.id)!"
            :query="query"
            :snippets="hit.highlights"
          />
        </div>
      </template>

      <div v-else-if="outcome" class="empty card">
        <p class="empty-title">暂时没有对症的工具</p>
        <button class="btn btn-primary feedback-btn" @click="openFeedback()">
          没找到想要的工具？告诉我们你需要什么，我们会考虑开发
        </button>
        <p class="faint small">点击后会打开邮件并自动填好收件人与模板，按提示补充几句即可；也可改用网页表单提交。</p>
      </div>
    </section>

    <FeedbackDialog :open="feedbackOpen" :query="query" @close="feedbackOpen = false" />
  </div>
</template>

<style scoped>
.search-page {
  padding-top: 22px;
  padding-bottom: 50px;
}
.search-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.back-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 20px;
  color: var(--ink);
  cursor: pointer;
}
.search-top-title {
  font-size: 16px;
  font-weight: 600;
}
.hero {
  text-align: center;
  padding: 18px 0 16px;
}
.hero-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 18px;
  letter-spacing: 1px;
}
.search-unit {
  max-width: 680px;
  margin: 0 auto;
  padding: 14px;
  background: var(--surface);
  border: 1.5px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  text-align: left;
}
.searchbar {
  display: flex;
  gap: 10px;
}
.search-input {
  flex: 1;
  padding: 15px 18px;
  font-size: 16px;
  border: 1.5px solid var(--line);
  border-radius: 12px;
  background: var(--bg, #fff);
}
.search-input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(63, 125, 94, 0.12);
}
.prescribe {
  padding: 0 26px;
  font-size: 16px;
  border-radius: 12px;
  white-space: nowrap;
}
.ask {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}
.ask-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.ask-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-faint);
}
.ask-shuffle {
  font-size: 12.5px;
  padding: 2px 8px;
}
.mode-hint {
  font-size: 12.5px;
  color: var(--brand-dark);
  margin: 12px 0 0;
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
  .hero-title {
    font-size: 20px;
  }
  .searchbar {
    flex-direction: column;
  }
  .prescribe {
    padding: 13px;
  }
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  border: 1px solid var(--line);
  background: var(--bg, #fff);
  color: var(--ink-soft);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 13px;
  transition: all 0.15s;
}
.chip:hover {
  border-color: var(--brand);
  color: var(--brand-dark);
  background: var(--brand-soft);
}
.ai-tip {
  margin: 12px 0 0;
  font-size: 12px;
}
.empty {
  padding: 36px 24px;
  text-align: center;
}
.empty-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 14px;
}
.feedback-btn {
  padding: 12px 22px;
  font-size: 14.5px;
  line-height: 1.6;
  max-width: 560px;
}
.small {
  font-size: 12.5px;
  margin-top: 10px;
}
.results {
  margin-top: 10px;
}
</style>
