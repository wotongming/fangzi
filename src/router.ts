import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const base = import.meta.env.BASE_URL

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/browse', name: 'browse', component: () => import('./views/BrowseView.vue') },
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
  history: createWebHistory(base),
  routes,
  scrollBehavior(_to, _from, saved) {
    return saved ?? { top: 0 }
  }
})
