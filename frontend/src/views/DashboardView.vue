<script setup lang="ts">
import { onMounted, computed, watch, ref } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { useDataStore } from '@/stores/data'
import { fmtMoney, fmtPct, fmtDays } from '@/api/client'

const data = useDataStore()
const syncing = ref(false)

onMounted(async () => {
  await data.fetchDashboard()
})

watch([() => data.periodDays, () => data.selectedAccount], () => {
  data.fetchDashboard()
})

async function doSync() {
  syncing.value = true
  try {
    await data.triggerSync()
    await data.fetchDashboard()
  } finally {
    syncing.value = false
  }
}

const d = computed(() => data.dashboard)

// Revenue area chart from velocity data
const revenueChart = computed(() => {
  const vel = d.value?.velocity ?? []
  if (!vel.length) return null
  const months: string[] = []
  const revenue: number[] = []
  const won: number[] = []
  vel.forEach(v => {
    months.push(v.pipelineName)
    revenue.push(v.totalPipelineValue)
    won.push(v.dealsWon)
  })
  return {
    series: [
      { name: 'Сумма воронки', data: revenue },
      { name: 'Закрытые сделки', data: won },
    ],
    opts: chartOpts(months),
  }
})

// Funnel from funnelSnapshot
const funnelData = computed(() => {
  const snap = d.value?.funnelSnapshot ?? []
  const max = snap[0]?.leadsEntered ?? 1
  return snap.map(s => ({ ...s, pct: s.leadsEntered / max }))
})

// Top agents
const topAgents = computed(() => d.value?.topAgents ?? [])

function chartOpts(categories: string[]) {
  return {
    chart: { type: 'area', background: 'transparent', toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 800 } },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 100] } },
    colors: ['#C9A96E', '#4CAF82'],
    grid: { borderColor: 'rgba(201,169,110,0.08)', strokeDashArray: 4 },
    xaxis: { categories, labels: { style: { colors: '#b0a898', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' }, formatter: (v: number) => fmtMoney(v) } },
    tooltip: { theme: 'dark' },
    legend: { labels: { colors: '#b0a898' } },
  }
}

const funnelChartOpts = computed(() => {
  const snap = d.value?.funnelSnapshot ?? []
  return {
    series: [{ name: 'Лидов', data: snap.map(s => s.leadsEntered) }],
    opts: {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 700 } },
      plotOptions: { bar: { horizontal: true, barHeight: '60%', borderRadius: 4 } },
      colors: ['#C9A96E'],
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(201,169,110,0.08)' },
      xaxis: { categories: snap.map(s => s.stageName), labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      tooltip: { theme: 'dark' },
    },
  }
})
</script>

<template>
  <AppLayout>
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Обзор продаж</h1>
          <p class="page-sub">Ключевые показатели и динамика воронки</p>
        </div>
        <div class="controls">
          <select v-model="data.periodDays" class="ctrl-select">
            <option :value="7">7 дней</option>
            <option :value="14">14 дней</option>
            <option :value="30">30 дней</option>
            <option :value="60">60 дней</option>
            <option :value="90">90 дней</option>
          </select>
          <select v-if="data.accounts.length" v-model="data.selectedAccount" class="ctrl-select">
            <option :value="undefined">Все аккаунты</option>
            <option v-for="a in data.accounts" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
          <button class="btn-gold" @click="doSync" :disabled="syncing">
            {{ syncing ? 'Синхронизация...' : 'Синхронизировать' }}
          </button>
        </div>
      </div>

      <div v-if="data.loading" class="loading-overlay"><div class="spinner"></div></div>

      <template v-else-if="d">
        <!-- KPI Row -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Лидов (период)</div>
            <div class="kpi-value">{{ d.totalLeads.toLocaleString('ru') }}</div>
            <div class="kpi-sub">Открыто: {{ d.openLeads }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Закрыто сделок</div>
            <div class="kpi-value gold">{{ d.wonLeads }}</div>
            <div class="kpi-sub">Проиграно: {{ d.lostLeads }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Конверсия</div>
            <div class="kpi-value" :class="d.overallConversionRate >= 0.2 ? 'gold' : ''">
              {{ fmtPct(d.overallConversionRate) }}
            </div>
            <div class="kpi-sub">Из закрытых</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Закрытая выручка</div>
            <div class="kpi-value gold">{{ fmtMoney(d.totalClosedRevenue, d.currency) }}</div>
            <div class="kpi-sub">Воронка: {{ fmtMoney(d.totalPipelineValue, d.currency) }}</div>
          </div>
          <div class="kpi-card" v-if="d.velocity[0]">
            <div class="kpi-label">Ср. цикл сделки</div>
            <div class="kpi-value">{{ fmtDays(d.velocity[0].avgDealCycleDays) }}</div>
            <div class="kpi-sub">{{ d.velocity[0].pipelineName }}</div>
          </div>
        </div>

        <!-- Charts row: revenue area + funnel -->
        <div class="charts-grid" v-if="revenueChart || funnelChartOpts.series[0].data.length">
          <div class="card" v-if="revenueChart">
            <div class="card-title">Воронка по пайплайнам</div>
            <apexchart height="240" :type="'area'" :options="revenueChart.opts" :series="revenueChart.series" />
          </div>
          <div class="card" v-if="funnelChartOpts.series[0].data.length">
            <div class="card-title">Распределение по этапам</div>
            <apexchart height="240" type="bar" :options="funnelChartOpts.opts" :series="funnelChartOpts.series" />
          </div>
        </div>

        <!-- Funnel snapshot -->
        <div class="card mt-16" v-if="funnelData.length">
          <div class="card-title">Воронка конверсии</div>
          <div class="funnel-stage" v-for="stage in funnelData" :key="stage.stageId">
            <div class="funnel-stage__name">{{ stage.stageName }}</div>
            <div class="funnel-stage__bar-wrap">
              <div class="funnel-stage__bar" :style="{ width: (stage.pct * 100).toFixed(1) + '%' }"></div>
            </div>
            <div class="funnel-stage__nums">
              <span class="funnel-stage__count">{{ stage.leadsEntered }}</span>
              <span class="funnel-stage__rate">{{ fmtPct(stage.conversionRate) }}</span>
            </div>
          </div>
        </div>

        <!-- Top agents -->
        <div class="card mt-16" v-if="topAgents.length">
          <div class="card-title">Топ менеджеры</div>
          <div class="agent-row" style="opacity:0.5;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--cream-dim);padding-bottom:6px;">
            <div></div><div>Менеджер</div><div class="text-right">Лиды</div><div class="text-right">Сделки</div><div>Конверсия</div><div class="text-right">Выручка</div><div class="text-right">Ср. сумма</div>
          </div>
          <div class="agent-row" v-for="(a, i) in topAgents" :key="a.agentId">
            <div class="agent-rank" :class="{ top: i < 3 }">{{ i + 1 }}</div>
            <div class="agent-name">{{ a.agentName }}</div>
            <div class="agent-stat">{{ a.leadsAssigned }}</div>
            <div class="agent-stat highlight">{{ a.dealsWon }}</div>
            <div class="conv-bar-wrap">
              <div class="conv-bar-bg"><div class="conv-bar-fill" :style="{ width: (a.conversionRate * 100).toFixed(0) + '%' }"></div></div>
              <span class="conv-pct">{{ fmtPct(a.conversionRate) }}</span>
            </div>
            <div class="agent-stat highlight">{{ fmtMoney(a.totalRevenue, d.currency) }}</div>
            <div class="agent-stat">{{ fmtMoney(a.avgDealValue, d.currency) }}</div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="!d.totalLeads && !d.velocity.length" class="empty-state mt-24">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          <h3>Данные ещё не загружены</h3>
          <p>Настройте CRM аккаунт в .env и нажмите «Синхронизировать», чтобы загрузить данные из Kommo или AmoCRM.</p>
        </div>
      </template>
    </div>
  </AppLayout>
</template>
