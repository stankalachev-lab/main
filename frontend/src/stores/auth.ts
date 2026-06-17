import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, getToken, setToken, clearToken } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getToken())

  async function login(email: string, password: string) {
    const res = await api.login(email, password)
    token.value = res.token
    setToken(res.token)
  }

  function logout() {
    token.value = null
    clearToken()
  }

  return { token, login, logout }
})
