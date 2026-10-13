import { defineStore } from 'pinia'
import { readJSON, writeJSON } from '../core/storage'

const FAV_KEY = 'fangzi:favorites:v1'

/** 用户收藏的工具：添加后展示在首页快捷入口 */
export const useFavoritesStore = defineStore('favorites', {
  state: () => ({
    ids: readJSON<string[]>(FAV_KEY, [])
  }),
  getters: {
    count(state): number {
      return state.ids.length
    },
    isFavorite(state) {
      return (id: string) => state.ids.includes(id)
    }
  },
  actions: {
    toggle(id: string) {
      if (this.ids.includes(id)) {
        this.ids = this.ids.filter((x) => x !== id)
      } else {
        this.ids = [id, ...this.ids]
      }
      this.persist()
    },
    has(id: string): boolean {
      return this.ids.includes(id)
    },
    persist() {
      writeJSON(FAV_KEY, this.ids)
    }
  }
})
