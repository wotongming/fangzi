<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useToolsStore } from '../stores/tools'
import { useFavoritesStore } from '../stores/favorites'
import { useSettingsStore } from '../stores/settings'
import { pickRandomSamples } from '../core/sample-queries'
import type { SearchOutcome } from '../core/search/search-engine'
import type { RegisteredTool } from '../core/registry'
import ToolCard from '../components/ToolCard.vue'
import FeedbackDialog from '../components/FeedbackDialog.vue'

const toolsStore = useToolsStore()
const favoritesStore = useFavoritesStore()
const settings = useSettingsStore()
const route = useRoute()

const query = ref('')
const hasSearched = ref(false)
const outcome = ref<SearchOutcome | null>(null)
const feedbackOpen = ref(false)
const samples = ref(pickRandomSamples(8))

const favoriteTools = ref<RegisteredTool[]>([])
function refreshFavorites() {
  favoriteTools.value = favoritesStore.ids
    .map((id) => toolsStore.byId(id))
    .filter((t): t is RegisteredTool => Boolean(t))
}

function resultTool(id: string): RegisteredTool | undefined {
  return toolsStore.byId(id)
}

async function runSearch(q?: string) {
  const text = (q ?? query.value).trim()
  if (!text) return
  query.value = text
  const res = await toolsStore.search(text)
  outcome.value = res
  hasSearched.value = true
}

function useSample(text: string) {
  void runSearch(text)
}

function reshuffle() {
  samples.value = pickRandomSamples(8)
}

onMounted(() => {
  refreshFavorites()
  const q = route.query.q
  if (typeof q === 'string' && q.trim()) {
    void runSearch(q.trim())
  }
})
</script>

<template>
  <div class="container home">
    <!-- 搜索主区 -->
    <section class="hero" :class="{ compact: hasSearched }">
      <h1 v-if="!hasSearched" class="hero-title">说说你遇到的问题，给你开个小方子</h1>
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
        <button class="btn btn-primary feedback-btn" @click="feedbackOpen = true">
          没找到想要的工具？告诉我们你需要什么，我们会考虑开发
        </button>
        <p class="faint small">无需填写邮箱，一句话描述问题即可。</p>
      </div>
    </section>

    <!-- 未搜索时的发现页 -->
    <template v-else>
      <section v-if="favoriteTools.length" class="block">
        <div class="block-head">
          <h2>我收藏的工具</h2>
        </div>
        <div class="grid">
          <ToolCard v-for="t in favoriteTools" :key="t.manifest.id" :tool="t" />
        </div>
      </section>

      <section class="block">
        <div class="block-head">
          <h2>大家都在问</h2>
          <button class="btn btn-ghost" @click="reshuffle">换一批</button>
        </div>
        <div class="chips">
          <button
            v-for="(s, i) in samples"
            :key="s.text"
            class="chip"
            :style="{ animationDelay: i * 0.4 + 's' }"
            @click="useSample(s.text)"
          >
            {{ s.text }}
          </button>
        </div>
        <p v-if="!settings.aiConfigured" class="faint small ai-tip">
          提示：在「设置」中配置 AI 接口后，可启用向量语义检索，口语化描述也能更准地命中工具。
        </p>
      </section>

      <section class="block">
        <div class="block-head">
          <h2>最新工具</h2>
          <RouterLink class="more" to="/browse">查看全部 {{ toolsStore.total }} 个 →</RouterLink>
        </div>
        <div class="grid">
          <ToolCard v-for="t in toolsStore.latest" :key="t.manifest.id" :tool="t" />
        </div>
      </section>
    </template>

    <FeedbackDialog :open="feedbackOpen" :query="query" @close="feedbackOpen = false" />
  </div>
</template>

<style scoped>
.home {
  padding-top: 26px;
  padding-bottom: 50px;
}
.hero {
  text-align: center;
  padding: 34px 0 20px;
}
.hero.compact {
  padding: 18px 0 8px;
}
.hero-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 22px;
  letter-spacing: 1px;
}
.searchbar {
  display: flex;
  gap: 10px;
  max-width: 680px;
  margin: 0 auto;
}
.search-input {
  flex: 1;
  padding: 15px 18px;
  font-size: 16px;
  border: 1.5px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
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
.mode-hint {
  font-size: 12.5px;
  color: var(--brand-dark);
  margin: 12px 0 0;
}
.block {
  margin-top: 34px;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.block-head h2 {
  font-size: 17px;
  margin: 0;
}
.more {
  font-size: 13px;
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
    font-size: 21px;
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
  gap: 10px;
}
.chip {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-soft);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13.5px;
  box-shadow: var(--shadow-sm);
  transition: all 0.15s;
  animation: floaty 5s ease-in-out infinite;
}
.chip:hover {
  border-color: var(--brand);
  color: var(--brand-dark);
  background: var(--brand-soft);
  transform: translateY(-2px);
}
@keyframes floaty {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}
.ai-tip {
  margin-top: 12px;
  font-size: 12.5px;
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
