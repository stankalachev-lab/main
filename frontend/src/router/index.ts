import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    { path: '/', redirect: '/dashboard' },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
    },
    {
      path: '/funnel',
      name: 'funnel',
      component: () => import('@/views/FunnelView.vue'),
    },
    {
      path: '/team',
      name: 'team',
      component: () => import('@/views/TeamView.vue'),
    },
    {
      path: '/leads',
      name: 'leads',
      component: () => import('@/views/LeadsView.vue'),
    },
    {
      path: '/marketing',
      name: 'marketing',
      component: () => import('@/views/MarketingView.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.token) return { name: 'login' }
  if (to.name === 'login' && auth.token) return { name: 'dashboard' }
})

export default router
