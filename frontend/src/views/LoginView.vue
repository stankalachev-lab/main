<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!email.value || !password.value) return
  loading.value = true
  error.value = ''
  try {
    await auth.login(email.value, password.value)
    router.push('/dashboard')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка входа'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <div class="logo-mark-lg">N</div>
        <h1>Nature Investment Group</h1>
        <p>CRM Analytics Platform</p>
      </div>

      <form @submit.prevent="submit">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input v-model="email" type="email" class="form-input" placeholder="admin@example.com" autocomplete="email" required />
        </div>
        <div class="form-group">
          <label class="form-label">Пароль</label>
          <input v-model="password" type="password" class="form-input" placeholder="••••••••" autocomplete="current-password" required />
        </div>
        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? 'Вход...' : 'Войти' }}
        </button>
        <div v-if="error" class="error-msg">{{ error }}</div>
      </form>
    </div>
  </div>
</template>
