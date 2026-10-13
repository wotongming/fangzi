import { defineStore } from 'pinia'
import { readJSON, writeJSON } from '../core/storage'
import type { AiSearchConfig } from '../core/types'
import { isAiConfigured } from '../core/types'

const SETTINGS_KEY = 'fangzi:settings:v1'

interface SettingsState {
  ai: AiSearchConfig
}

const EMPTY_AI: AiSearchConfig = { baseUrl: '', model: '', apiKey: '' }

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    ai: readJSON<{ ai: AiSearchConfig }>(SETTINGS_KEY, { ai: EMPTY_AI }).ai ?? { ...EMPTY_AI }
  }),
  getters: {
    aiConfigured(state): boolean {
      return isAiConfigured(state.ai)
    },
    /** 传给检索引擎：未配置完整时传 null 自动降级 */
    effectiveAi(state): AiSearchConfig | null {
      return isAiConfigured(state.ai) ? state.ai : null
    }
  },
  actions: {
    updateAi(patch: Partial<AiSearchConfig>) {
      this.ai = { ...this.ai, ...patch }
      writeJSON(SETTINGS_KEY, { ai: this.ai })
    },
    clearAi() {
      this.ai = { ...EMPTY_AI }
      writeJSON(SETTINGS_KEY, { ai: this.ai })
    }
  }
})
