<script setup lang="ts">
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const data = useDataStore()

const nav = [
  { path: '/dashboard', label: 'Обзор', icon: 'grid' },
  { path: '/funnel', label: 'Воронка', icon: 'funnel' },
  { path: '/team', label: 'Менеджеры', icon: 'team' },
  { path: '/leads', label: 'Сделки', icon: 'list' },
  { path: '/marketing', label: 'Маркетинг', icon: 'utm' },
]

function logout() { auth.logout(); router.push('/login') }
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__logo">
      <div class="logo-mark">N</div>
      <div class="logo-text">
        <span class="logo-main">Nature</span>
        <span class="logo-sub">Investment Group</span>
      </div>
    </div>

    <div class="section-label">Аналитика</div>
    <nav class="sidebar__nav">
      <RouterLink
        v-for="item in nav"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        :class="{ active: route.path === item.path }"
      >
        <svg class="nav-icon" viewBox="0 0 16 16" fill="currentColor">
          <!-- grid -->
          <template v-if="item.icon === 'grid'">
            <rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/>
          </template>
          <!-- funnel -->
          <template v-else-if="item.icon === 'funnel'">
            <path d="M2 3h12l-4.5 5v5l-3-1.5V8L2 3z"/>
          </template>
          <!-- team -->
          <template v-else-if="item.icon === 'team'">
            <circle cx="6" cy="5" r="2.5"/><path d="M1 12c0-2.5 2-4 5-4s5 1.5 5 4"/>
            <circle cx="11.5" cy="5" r="2"/><path d="M13 12c1 0 2-.8 2-2.5 0-1.3-.8-2.5-2-2.5"/>
          </template>
          <!-- list -->
          <template v-else-if="item.icon === 'list'">
            <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </template>
          <!-- utm -->
          <template v-else>
            <path d="M8 2L14 5v4c0 3-2.5 5.5-6 6-3.5-.5-6-3-6-6V5l6-3z"/>
          </template>
        </svg>
        <span class="nav-label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar__bottom">
      <div class="accounts-info" v-if="data.accounts.length > 0">
        <div class="section-label" style="padding: 0; margin-bottom: 6px;">CRM аккаунты</div>
        <div v-for="acc in data.accounts" :key="acc.id" class="acc-item">
          <span class="acc-dot" :class="acc.variant"></span>
          <span class="acc-name">{{ acc.label }}</span>
        </div>
      </div>
      <button class="nav-item logout-btn" @click="logout" style="width:100%;margin-top:8px;">
        <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6"/>
        </svg>
        <span class="nav-label">Выйти</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.accounts-info { padding: 8px 10px; }
.acc-item { display: flex; align-items: center; gap: 7px; padding: 3px 0; }
.acc-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.acc-dot.kommo { background: #7c5cbf; }
.acc-dot.amo { background: #2d8cf0; }
.acc-name { font-size: 12px; color: var(--cream-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.logout-btn { display: flex; align-items: center; gap: 10px; border-radius: var(--radius); color: var(--cream-dim); padding: 9px 12px; transition: var(--transition); }
.logout-btn:hover { background: var(--danger-dim); color: var(--danger); }
</style>
