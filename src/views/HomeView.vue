<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToolsStore } from '../stores/tools'
import { useFavoritesStore } from '../stores/favorites'
import type { RegisteredTool } from '../core/registry'
import {
  canStartPull,
  pullOffset,
  pullProgress,
  decideRelease,
  pullHint
} from '../../reusable-module/use-pull-to-search/use-pull-to-search'

const router = useRouter()
const toolsStore = useToolsStore()
const favoritesStore = useFavoritesStore()

const favoriteTools = ref<RegisteredTool[]>([])
function refreshFavorites() {
  favoriteTools.value = favoritesStore.ids
    .map((id) => toolsStore.byId(id))
    .filter((t): t is RegisteredTool => Boolean(t))
}
function removeFav(id: string) {
  favoritesStore.toggle(id)
  refreshFavorites()
}

// 工具无内置图标/品牌色，按 id 稳定取一组柔和底色（米白+品牌绿为主），首字作字标
const ICON_PALETTE = [
  { bg: '#e6efe9', fg: '#3f7d5e' },
  { bg: '#e7efee', fg: '#3d7a72' },
  { bg: '#f3ecd9', fg: '#8a6d2f' },
  { bg: '#f0e7e1', fg: '#8a5f4c' }
]
function iconStyle(id: string) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const p = ICON_PALETTE[h % ICON_PALETTE.length] ?? ICON_PALETTE[0]!
  return { background: p.bg, color: p.fg }
}

// —— 紧凑搜索入口（PC 点击；移动端配合下拉手势唤起 /search）——
const PULL_HINT_KEY = 'fz-pull-hint-seen'
const showPullHint = ref(localStorage.getItem(PULL_HINT_KEY) !== '1')
function dismissPullHint() {
  showPullHint.value = false
  try {
    localStorage.setItem(PULL_HINT_KEY, '1')
  } catch {
    /* 隐私模式写入失败仅本次隐藏 */
  }
}
function goSearch() {
  router.push('/search')
}

// —— 下拉唤起搜索手势（纯函数判定，绑定在首页内容容器）——
const pullY = ref(0)
const pullText = ref('')
let startY = 0
let startX = 0
let lastDy = 0
let tracking = false

function onTouchStart(e: TouchEvent) {
  const t = e.touches[0]
  if (!t) return
  startY = t.clientY
  startX = t.clientX
  lastDy = 0
  // 仅在顶部预备跟踪；正式方向/阈值判断在 move 中由纯函数完成
  tracking = window.scrollY <= 0
}

function onTouchMove(e: TouchEvent) {
  if (!tracking) return
  const t = e.touches[0]
  if (!t) return
  const dy = t.clientY - startY
  const dx = t.clientX - startX
  if (!canStartPull({ scrollTop: window.scrollY, dy, dx })) {
    tracking = false
    pullY.value = 0
    pullText.value = ''
    return
  }
  // 仅在满足「顶部 + 垂直下拉」时拦截，正常滚动/水平滑动不卡死
  if (e.cancelable) e.preventDefault()
  lastDy = dy
  pullY.value = pullOffset(dy, window.innerHeight)
  pullText.value = pullHint(pullProgress(dy, window.innerHeight))
}

function onTouchEnd() {
  if (!tracking) return
  tracking = false
  if (decideRelease(lastDy, window.innerHeight) === 'search') {
    pullY.value = 0
    pullText.value = ''
    router.push('/search')
    return
  }
  // 未达标：平滑回弹
  pullY.value = 0
  pullText.value = ''
}

onMounted(() => {
  document.title = '我的方子 - 方子'
  refreshFavorites()
})
</script>

<template>
  <div
    class="container home"
    :class="{ settling: pullY === 0 }"
    :style="pullY > 0 ? { transform: `translateY(${pullY}px)` } : {}"
    @touchstart.passive="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <!-- 紧凑搜索入口（PC 点击；移动端下拉手势唤起） -->
    <button class="search-entry" type="button" @click="goSearch">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" />
      </svg>
      <span>想找方子？点这里，或在顶部下拉搜索</span>
    </button>
    <p v-if="showPullHint" class="pull-hint">
      小提示：在页面顶部垂直下拉也能打开搜索
      <button class="pull-hint-x" type="button" aria-label="知道了" @click="dismissPullHint">×</button>
    </p>

    <!-- 下拉进度提示（跟手位移由 transform 实现） -->
    <div v-if="pullY > 0" class="pull-indicator" :style="{ transform: `translateY(${pullY}px)` }">
      <span class="pull-dot">⌄</span>{{ pullText }}
    </div>

    <!-- 收藏小卡网格：整卡进工具页，右上角 × 移除 -->
    <section v-if="favoriteTools.length" class="block fav-block">
      <div class="block-head">
        <h2>我收藏的方子</h2>
      </div>
      <div class="fav-grid">
        <RouterLink
          v-for="t in favoriteTools"
          :key="t.manifest.id"
          class="fav-card"
          :to="`/t/${t.manifest.id}`"
        >
          <div class="fc-top">
            <span class="fc-ico" :style="iconStyle(t.manifest.id)">{{ t.manifest.name.slice(0, 1) }}</span>
            <button
              class="fc-x"
              type="button"
              title="从我的方子移除"
              @click.prevent.stop="removeFav(t.manifest.id)"
            >×</button>
          </div>
          <span class="fc-name">{{ t.manifest.name }}</span>
          <span class="fc-tag">{{ t.manifest.tagline }}</span>
        </RouterLink>
      </div>
    </section>

    <!-- 空收藏态 -->
    <section v-else class="empty-state card">
      <div class="es-seal" aria-hidden="true">方</div>
      <p class="es-title">这里是你的私人方子柜</p>
      <p class="faint es-desc">还没有收藏工具。逛一逛方子铺，把常用的工具收进来，下次一键直达。</p>
      <RouterLink class="btn btn-primary es-cta" to="/browse">去方子铺逛逛 →</RouterLink>
    </section>
  </div>
</template>

<style scoped>
.home {
  padding-top: 22px;
  padding-bottom: 50px;
  will-change: transform;
}
.home.settling {
  transition: transform 0.18s ease;
}
.search-entry {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  max-width: 680px;
  margin: 0 auto;
  padding: 12px 16px;
  border: 1.5px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink-soft);
  font-size: 14px;
  cursor: pointer;
}
.search-entry svg {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--ink-faint);
}
.search-entry:hover {
  border-color: var(--brand);
  color: var(--brand-dark);
  background: var(--brand-soft);
}
.pull-hint {
  max-width: 680px;
  margin: 8px auto 0;
  font-size: 12.5px;
  color: var(--ink-faint);
  display: flex;
  align-items: center;
  gap: 8px;
}
.pull-hint-x {
  border: none;
  background: transparent;
  color: var(--ink-faint);
  font-size: 16px;
  cursor: pointer;
}
.pull-indicator {
  max-width: 680px;
  margin: 10px auto 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--brand-dark);
}
.pull-dot {
  display: inline-block;
  margin-right: 6px;
}
.block {
  margin-top: 30px;
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
.fav-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
@media (min-width: 640px) {
  .fav-grid {
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  }
}
.fav-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  min-height: 118px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  text-decoration: none !important;
  color: inherit;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.fav-card:hover {
  transform: translateY(-2px);
  border-color: var(--brand);
  box-shadow: var(--shadow-sm);
}
.fc-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.fc-ico {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
  flex: none;
}
.fc-x {
  border: none;
  background: transparent;
  color: var(--ink-faint);
  font-size: 17px;
  line-height: 1;
  padding: 2px 6px;
  cursor: pointer;
  opacity: 0.7;
}
.fc-x:hover {
  color: #c0473c;
  opacity: 1;
}
.fc-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}
.fc-tag {
  font-size: 12.5px;
  color: var(--ink-soft);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.empty-state {
  max-width: 560px;
  margin: 48px auto 0;
  padding: 40px 24px;
  text-align: center;
}
.es-seal {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: var(--brand);
  color: #fff;
  font-size: 28px;
  font-weight: 700;
}
.es-title {
  font-size: 19px;
  font-weight: 700;
  margin: 0 0 8px;
}
.es-desc {
  margin: 0 0 20px;
  font-size: 14px;
}
.es-cta {
  padding: 11px 24px;
  font-size: 15px;
}
</style>
