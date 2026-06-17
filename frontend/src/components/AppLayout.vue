<script setup lang="ts">
import AppSidebar from './AppSidebar.vue'
import { useDataStore } from '@/stores/data'
import { onMounted } from 'vue'

const data = useDataStore()
onMounted(() => { data.fetchAccounts().catch(() => {}) })
</script>

<template>
  <div class="app-layout">
    <AppSidebar />
    <main class="app-main">
      <slot />
    </main>
  </div>
</template>
