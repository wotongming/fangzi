<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { getTool } from '../core/registry'
import { CATEGORY_LABELS, PLATFORM_LABELS, TOOL_TYPE_LABELS } from '../core/constants'
import { useFavoritesStore } from '../stores/favorites'
import { renderMarkdown } from '../core/markdown'
import { useImmersive } from '../composables/useImmersive'

const props = defineProps<{ id: string }>()
const favorites = useFavoritesStore()
const imm = useImmersive()
const immersive = computed(() => imm.active.value)

const tool = computed(() => getTool(props.id))
const m = computed(() => tool.value?.manifest)

const asyncComp = shallowRef(
  tool.value?.loadComponent
    ? defineAsyncComponent({
        loader: tool.value.loadComponent,
        loadingComponent: { template: '<p class="muted" style="padding:30px">工具加载中…</p>' },
        errorComponent: { template: '<p style="padding:30px;color:var(--danger)">工具加载失败，请刷新重试。</p>' }
      })
    : null
)

const manualHtml = computed(() => (tool.value?.guide ? renderMarkdown(tool.value.guide) : ''))

function humanSize(n?: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(2)} MB`
}

// —— 插件下载与完整性校验 ——
const verifyState = ref<'idle' | 'hashing' | 'match' | 'mismatch' | 'error'>('idle')
const verifyMsg = ref('')
const downloadUrl = ref('')

async function verifiedDownload(url: string, expectSha?: string) {
  verifyState.value = 'hashing'
  verifyMsg.value = '正在下载并计算 SHA256…'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败：${res.status}`)
    const buf = await res.arrayBuffer()
    if (expectSha) {
      const digest = await crypto.subtle.digest('SHA-256', buf)
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
      if (hex.toLowerCase() !== expectSha.toLowerCase()) {
        verifyState.value = 'mismatch'
        verifyMsg.value = `校验不一致！实际 ${hex}，请勿安装。`
        return
      }
    }
    // 校验通过，生成本地下载
    const blob = new Blob([buf])
    const objectUrl = URL.createObjectURL(blob)
    if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = objectUrl
    verifyState.value = 'match'
    verifyMsg.value = 'SHA256 校验一致，点击下方按钮保存文件。'
  } catch (e) {
    verifyState.value = 'error'
    verifyMsg.value = e instanceof Error ? e.message : String(e)
  }
}

// 离开工具时兜底退出沉浸（App 的路由 watcher 也会处理，双保险）
onBeforeUnmount(() => {
  if (imm.active.value) void imm.exit()
})
</script>

<template>
  <div
    class="container runner"
    :class="{ 'runner-immersive': immersive }"
    v-if="tool && m"
  >
    <!-- 固定位置的工具条：名称 + 用户指导入口 + 收藏 -->
    <div class="sticky-bar">
      <div class="sb-left">
        <RouterLink to="/" class="back" title="返回">←</RouterLink>
        <div class="sb-titles">
          <strong>{{ m.name }}</strong>
          <span class="faint">{{ CATEGORY_LABELS[m.category] }} · {{ TOOL_TYPE_LABELS[m.type] }}</span>
        </div>
      </div>
      <div class="sb-actions">
        <button
          v-if="m.type === 'web' && m.immersive"
          class="btn"
          :class="{ 'btn-primary': !immersive }"
          @click="imm.toggle()"
        >
          {{ immersive ? '✕ 退出全屏' : '⛶ 全屏' }}
        </button>
        <button
          class="fav"
          :class="{ on: favorites.isFavorite(m.id) }"
          @click="favorites.toggle(m.id)"
        >
          {{ favorites.isFavorite(m.id) ? '★ 已收藏到我的方子' : '☆ 收藏到我的方子' }}
        </button>
        <RouterLink class="btn" :to="`/t/${m.id}/guide`">
          {{ m.type === 'plugin' ? '使用手册' : '用户指导' }}
        </RouterLink>
      </div>
    </div>

    <!-- 网页工具：直接使用 -->
    <template v-if="m.type === 'web' && asyncComp">
      <component :is="asyncComp" />
    </template>

    <!-- 插件工具：使用手册 + 压缩包下载 -->
    <template v-else-if="m.type === 'plugin'">
      <div class="card download-card">
        <h2>下载插件</h2>
        <div v-for="(p, idx) in m.plugins" :key="idx" class="pkg">
          <div class="pkg-meta">
            <span class="tag">{{ PLATFORM_LABELS[p.platform] }}</span>
            <span class="faint">版本 {{ p.version }}</span>
            <span class="faint" v-if="p.sizeBytes">{{ humanSize(p.sizeBytes) }}</span>
            <span class="faint" v-if="p.minHostVersion">{{ p.minHostVersion }}</span>
          </div>
          <div class="pkg-actions">
            <a class="btn btn-primary" :href="p.packageUrl" download>直接下载 zip</a>
            <button class="btn" @click="verifiedDownload(p.packageUrl, p.sha256)">
              {{ verifyState === 'hashing' ? '校验中…' : '校验 SHA256 后下载' }}
            </button>
          </div>
          <p class="faint sha">SHA256：<code>{{ p.sha256 }}</code></p>
          <p v-if="verifyState !== 'idle'" :class="{ ok: verifyState === 'match', bad: verifyState === 'mismatch' || verifyState === 'error' }">
            {{ verifyMsg }}
          </p>
          <a v-if="downloadUrl && verifyState === 'match'" class="btn btn-primary" :href="downloadUrl"
            :download="p.packageUrl.split('/').pop()">保存已校验文件</a>
        </div>
      </div>

      <article class="manual markdown-body" v-html="manualHtml"></article>
    </template>
  </div>

  <div v-else class="container notfound">
    <p>没有找到这个工具。</p>
    <RouterLink class="btn btn-primary" to="/">回我的方子 · 重新开方子</RouterLink>
  </div>
</template>

<style scoped>
.runner {
  padding-top: 18px;
  padding-bottom: 60px;
}
.sticky-bar {
  position: sticky;
  top: 58px;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: rgba(247, 246, 242, 0.92);
  backdrop-filter: blur(8px);
  padding: 10px 0;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sb-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.back {
  font-size: 20px;
  color: var(--ink-soft);
  text-decoration: none;
  padding: 2px 8px;
}
.sb-titles {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.sb-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.fav {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ink-soft);
}
.fav.on {
  border-color: #e0a526;
  color: #b8860b;
  background: #fdf7e6;
}
.download-card {
  padding: 18px 20px;
  margin-bottom: 16px;
}
.download-card h2 {
  margin: 0 0 12px;
  font-size: 17px;
}
.pkg {
  border-top: 1px dashed var(--line);
  padding-top: 14px;
}
.pkg:first-of-type {
  border-top: none;
  padding-top: 0;
}
.pkg-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  margin-bottom: 10px;
}
.pkg-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.sha {
  font-size: 12px;
  word-break: break-all;
  margin: 10px 0 0;
}
.ok {
  color: var(--brand-dark);
  font-weight: 600;
}
.bad {
  color: var(--danger);
  font-weight: 600;
}
.manual {
  margin-top: 16px;
}
.notfound {
  padding: 80px 20px;
  text-align: center;
  display: grid;
  gap: 16px;
  justify-items: center;
}

/* 移动端：外壳品牌顶栏已隐藏，工具条吸附到状态栏安全区下沿；
   沉浸态工具内容铺满安全区 */
@media (max-width: 820px) {
  .sticky-bar {
    top: var(--sat);
  }
  .runner-immersive {
    max-width: none;
    margin: 0;
    min-height: 100dvh;
    padding: calc(var(--sat) + 8px) calc(var(--sar) + 10px)
      calc(var(--sab) + 12px) calc(var(--sal) + 10px);
  }
  .runner-immersive .sticky-bar {
    top: var(--sat);
  }
}
</style>
