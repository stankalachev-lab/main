import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'
import type { DashboardSummary, ConversionRateByStage, AgentPerformanceMetric, Account, PipelineVelocityMetric } from '@/api/client'

export const useDataStore = defineStore('data', () => {
  const accounts = ref<Account[]>([])
  const dashboard = ref<DashboardSummary | null>(null)
  const funnel = ref<ConversionRateByStage[]>([])
  const velocity = ref<PipelineVelocityMetric[]>([])
  const team = ref<AgentPerformanceMetric[]>([])
  const loading = ref(false)
  const syncing = ref(false)
  const periodDays = ref(30)
  const selectedAccount = ref<string | undefined>(undefined)

  function params() {
    return { periodDays: periodDays.value, accountId: selectedAccount.value }
  }

  async function fetchAccounts() {
    accounts.value = await api.accounts()
  }

  async function fetchDashboard() {
    loading.value = true
    try { dashboard.value = await api.dashboard(params()) }
    finally { loading.value = false }
  }

  async function fetchFunnel() {
    loading.value = true
    try { funnel.value = await api.funnel(params()) }
    finally { loading.value = false }
  }

  async function fetchVelocity() {
    velocity.value = await api.velocity(params())
  }

  async function fetchTeam() {
    loading.value = true
    try { team.value = await api.team(params()) }
    finally { loading.value = false }
  }

  async function triggerSync() {
    syncing.value = true
    try { await api.sync(selectedAccount.value) }
    finally { syncing.value = false }
  }

  return {
    accounts, dashboard, funnel, velocity, team,
    loading, syncing, periodDays, selectedAccount,
    fetchAccounts, fetchDashboard, fetchFunnel, fetchVelocity, fetchTeam, triggerSync,
  }
})
