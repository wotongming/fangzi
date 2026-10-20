// 使用 hash 路由：深层地址（如 /t/xxx）不会向服务器发起额外路径请求，
// 任意 EdgeOne 子路径部署、离线与 PWA 安装校验都自洽（与已验证可安装的静态项目对齐）。
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const base = import.meta.env.BASE_URL

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/search', name: 'search', component: () => import('./views/SearchView.vue') },
  { path: '/browse', name: 'browse', component: () => import('./views/BrowseView.vue') },
  { path: '/help', name: 'help', component: () => import('./views/ManualView.vue') },
  {
    path: '/t/:id',
    name: 'tool',
    component: () => import('./views/ToolRunnerView.vue'),
    props: true
  },
  {
    path: '/t/:id/guide',
    name: 'tool-guide',
    component: () => import('./views/GuideView.vue'),
    props: true
  },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

export const router = createRouter({
  history: createWebHashHistory(base),
  routes,
  scrollBehavior(_to, _from, saved) {
    return saved ?? { top: 0 }
  }
})
