import { ref } from 'vue'
import { useToolsStore } from '../stores/tools'
import { useSettingsStore } from '../stores/settings'
import { pickRandomSamples } from '../core/sample-queries'
import type { SearchOutcome } from '../core/search/search-engine'
import type { RegisteredTool } from '../core/registry'

/**
 * 共用工具搜索逻辑：搜索框 / 开方子提交 / 大家都在问换一批 / 结果列表 / 反馈弹窗。
 * Home（我的方子）不再展示搜索 UI，仅独立搜索页 /search 使用；抽出为 composable 避免复制两份。
 */
export function useToolSearch() {
  const toolsStore = useToolsStore()
  const settings = useSettingsStore()

  const query = ref('')
  const hasSearched = ref(false)
  const outcome = ref<SearchOutcome | null>(null)
  const feedbackOpen = ref(false)
  const samples = ref(pickRandomSamples(8))

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

  function openFeedback() {
    feedbackOpen.value = true
  }

  return {
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
  }
}
