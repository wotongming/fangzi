<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useImmersive } from './composables/useImmersive'

const route = useRoute()
const imm = useImmersive()

const isToolRoute = computed(() => route.name === 'tool')
const shellImmersive = computed(() => imm.active.value && isToolRoute.value)

// 离开工具页（返回首页/切到其它页）自动退出沉浸，避免外壳仍被隐藏
watch(
  () => route.name,
  (name) => {
    if (name !== 'tool' && imm.active.value) void imm.exit()
  }
)
</script>

<template>
  <div class="app-shell" :class="{ 'is-immersive': shellImmersive }">
    <header class="topbar">
      <div class="container topbar-inner">
        <RouterLink to="/" class="brand" aria-label="方子首页">
          <span class="brand-seal">方</span>
          <span class="brand-name">方子</span>
        </RouterLink>
        <nav class="topnav">
          <RouterLink to="/">我的方子</RouterLink>
          <RouterLink to="/browse">方子铺</RouterLink>
          <RouterLink to="/help">开方指南</RouterLink>
          <RouterLink to="/settings">设置</RouterLink>
        </nav>
      </div>
    </header>

    <main class="page">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </main>

    <footer class="footer">
      <div class="container">
        <span>方子 · 一个工具解决一个具体问题</span>
      </div>
    </footer>

    <!-- 移动端底部主导航（≤820px 显示；沉浸态隐藏） -->
    <nav class="tabbar" aria-label="主导航">
      <RouterLink to="/" class="tab" :class="{ on: route.name === 'home' }">
        <svg class="tab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 4h12v17l-6-4-6 4z" />
        </svg>
        <span class="tab-txt">我的方子</span>
      </RouterLink>
      <RouterLink to="/browse" class="tab" :class="{ on: route.name === 'browse' }">
        <svg class="tab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 10l8-6 8 6" />
          <path d="M5 10v9h14v-9" />
          <path d="M9 19v-5h6v5" />
        </svg>
        <span class="tab-txt">方子铺</span>
      </RouterLink>
      <RouterLink to="/help" class="tab" :class="{ on: route.name === 'help' }">
        <svg class="tab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5z" />
          <path d="M4 19a2 2 0 012-2h12" />
          <path d="M9 7.5h5M9 11h5" />
        </svg>
        <span class="tab-txt">开方指南</span>
      </RouterLink>
      <RouterLink to="/settings" class="tab" :class="{ on: route.name === 'settings' }">
        <svg class="tab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
        </svg>
        <span class="tab-txt">设置</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(247, 246, 242, 0.88);
  backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--line);
}
.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 58px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  text-decoration: none !important;
}
.brand-seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--brand);
  color: #fff;
  font-weight: 700;
  font-size: 18px;
  box-shadow: var(--shadow-sm);
}
.brand-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--ink);
}
.topnav {
  display: flex;
  gap: 4px;
}
.topnav a {
  padding: 7px 13px;
  border-radius: 8px;
  color: var(--ink-soft);
  font-size: 14px;
  text-decoration: none;
}
.topnav a:hover {
  background: var(--brand-soft);
  color: var(--brand-dark);
  text-decoration: none;
}
.topnav a.router-link-exact-active {
  color: var(--brand-dark);
  background: var(--brand-soft);
  font-weight: 600;
}
.page {
  flex: 1;
}
.footer {
  border-top: 1px solid var(--line);
  padding: 22px 0 30px;
  color: var(--ink-faint);
  font-size: 13px;
  text-align: center;
}

/* 底部 Tab：桌面默认隐藏 */
.tabbar {
  display: none;
}

@media (max-width: 820px) {
  /* 移动端主导航已在底部 Tab，顶部品牌栏整块隐藏，把纵向空间让给内容；
     刘海/状态栏安全区改由 .page 顶部内边距统一承担 */
  .topbar {
    display: none;
  }
  .footer {
    display: none;
  }
  .page {
    padding-top: var(--sat);
    /* 为固定底部 Tab + Home 指示条预留空间 */
    padding-bottom: calc(var(--tab-h) + var(--sab) + 8px);
  }

  .tabbar {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    height: calc(var(--tab-h) + var(--sab));
    padding: 0 var(--sar) var(--sab) var(--sal);
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: saturate(1.4) blur(10px);
    border-top: 1px solid var(--line);
  }
  .tab {
    flex: 1;
    min-height: var(--tab-h);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--ink-faint);
    text-decoration: none !important;
  }
  .tab-ico {
    width: 22px;
    height: 22px;
    display: block;
    line-height: 1;
  }
  .tab-txt {
    font-size: 11px;
    line-height: 1.2;
  }
  .tab.on {
    color: var(--brand-dark);
    font-weight: 600;
  }

  /* 沉浸态：隐藏外壳三段，内容不再为 Tab 预留空间 */
  .app-shell.is-immersive .topbar,
  .app-shell.is-immersive .tabbar,
  .app-shell.is-immersive .footer {
    display: none;
  }
  .app-shell.is-immersive .page {
    padding-top: 0;
    padding-bottom: 0;
  }
}

@media (max-width: 480px) {
  .brand-name {
    display: none;
  }
}
</style>
