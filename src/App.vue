<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="container topbar-inner">
        <RouterLink to="/" class="brand" aria-label="方子首页">
          <span class="brand-seal">方</span>
          <span class="brand-name">方子</span>
        </RouterLink>
        <nav class="topnav">
          <RouterLink to="/">开方子</RouterLink>
          <RouterLink to="/browse">全部工具</RouterLink>
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
@media (max-width: 480px) {
  .brand-name {
    display: none;
  }
}
</style>
