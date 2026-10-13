import { defineStore } from 'pinia'
import { allTools, getTool, toSearchDocument, LATEST_LIMIT, type RegisteredTool } from '../core/registry'
import { SearchEngine, type SearchOutcome } from '../core/search/search-engine'
import { useSettingsStore } from './settings'

export const useToolsStore = defineStore('tools', {
  state: () => ({
    engine: null as SearchEngine | null,
    lastSearch: null as SearchOutcome | null,
    searching: false
  }),
  getters: {
    tools(): RegisteredTool[] {
      return allTools()
    },
    byId() {
      return (id: string) => getTool(id)
    },
    /** 最新工具（注册中心已按 createdAt 倒序） */
    latest(): RegisteredTool[] {
      return allTools().slice(0, LATEST_LIMIT)
    },
    total(): number {
      return allTools().length
    }
  },
  actions: {
    ensureEngine(): SearchEngine {
      if (!this.engine) {
        this.engine = new SearchEngine(allTools().map((t) => toSearchDocument(t.manifest)))
      }
      return this.engine as SearchEngine
    },
    async search(query: string): Promise<SearchOutcome> {
      const settings = useSettingsStore()
      this.searching = true
      try {
        const engine = this.ensureEngine()
        const outcome = await engine.search(query, { ai: settings.effectiveAi, limit: 30 })
        this.lastSearch = outcome
        return outcome
      } finally {
        this.searching = false
      }
    },
    /** 设置页：测试 AI 连接并预建向量索引 */
    async prepareVectors() {
      const settings = useSettingsStore()
      if (!settings.effectiveAi) return { ok: false, error: 'AI 参数未配置完整' }
      return this.ensureEngine().prepareVectors(settings.effectiveAi)
    }
  }
})
