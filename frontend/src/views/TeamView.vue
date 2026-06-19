<script setup lang="ts">
import { onMounted, computed, watch, ref } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { useDataStore } from '@/stores/data'
import { fmtMoney, fmtPct, fmtDays } from '@/api/client'
import type { AgentPerformanceMetric } from '@/api/client'

const data = useDataStore()
const selectedAgent = ref<AgentPerformanceMetric | null>(null)
const sortKey = ref<keyof AgentPerformanceMetric>('totalRevenue')
const sortAsc = ref(false)

onMounted(() => { data.fetchTeam() })
watch([() => data.periodDays, () => data.selectedAccount], () => { data.fetchTeam() })

const sorted = computed(() => {
  const arr = [...data.team]
  arr.sort((a, b) => {
    const va = a[sortKey.value] as number
    const vb = b[sortKey.value] as number
    return sortAsc.value ? va - vb : vb - va
  })
  return arr
})

function setSort(key: keyof AgentPerformanceMetric) {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value
  else { sortKey.value = key; sortAsc.value = false }
}

// Revenue by agent bar chart
const revenueChart = computed(() => {
  const top = sorted.value.slice(0, 10)
  return {
    series: [
      { name: 'Выручка', data: top.map(a => a.totalRevenue) },
      { name: 'В воронке', data: top.map(a => a.activePipelineValue) },
    ],
    opts: {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, stacked: false, animations: { speed: 700 } },
      plotOptions: { bar: { horizontal: false, columnWidth: '60%', borderRadius: 3 } },
      colors: ['#C9A96E', '#254D45'],
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(201,169,110,0.08)', strokeDashArray: 4 },
      xaxis: { categories: top.map(a => a.agentName.split(' ')[0]), labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' }, formatter: (v: number) => fmtMoney(v) } },
      legend: { labels: { colors: '#b0a898' } },
      tooltip: { theme: 'dark', y: { formatter: (v: number) => fmtMoney(v) } },
    },
  }
})

// Conversion rate chart
const convChart = computed(() => {
  const top = sorted.value.slice(0, 10)
  return {
    series: [{ name: 'Конверсия', data: top.map(a => +(a.conversionRate * 100).toFixed(1)) }],
    opts: {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 700 } },
      plotOptions: { bar: { horizontal: true, barHeight: '55%', borderRadius: 3 } },
      colors: ['#4CAF82'],
      dataLabels: { enabled: true, formatter: (v: number) => v + '%', style: { colors: ['#4CAF82'], fontSize: '11px', fontWeight: 400 } },
      grid: { borderColor: 'rgba(201,169,110,0.08)', strokeDashArray: 4 },
      xaxis: { categories: top.map(a => a.agentName.split(' ')[0]), max: 100, labels: { style: { colors: '#b0a898', fontSize: '11px' }, formatter: (v: number) => v + '%' } },
      yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      tooltip: { theme: 'dark', y: { formatter: (v: number) => v + '%' } },
    },
  }
})

// Agent detail spark
const agentDetailChart = computed(() => {
  const a = selectedAgent.value
  if (!a) return null
  return {
    series: [{ name: 'Сделки', data: [a.leadsAssigned, a.dealsWon, a.dealsLost, a.activePipelineCount] }],
    opts: {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, sparkline: { enabled: false } },
      plotOptions: { bar: { horizontal: false, columnWidth: '60%', borderRadius: 4 } },
      colors: ['#C9A96E', '#4CAF82', '#e05252', '#254D45'],
      fill: { colors: ['#C9A96E', '#4CAF82', '#e05252', '#254D45'] },
      dataLabels: { enabled: true, style: { colors: ['#F5F0E8'], fontSize: '12px' } },
      xaxis: { categories: ['Назначено', 'Выиграно', 'Проиграно', 'Активных'], labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      tooltip: { theme: 'dark' },
      grid: { borderColor: 'rgba(201,169,110,0.08)' },
    },
  }
})

function sortIcon(key: string) {
  if (sortKey.value !== key) return '↕'
  return sortAsc.value ? '↑' : '↓'
}

</script>

<template>
  <AppLayout>
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Эффективность менеджеров</h1>
          <p class="page-sub">Конверсии, выручка и активная воронка по каждому сотруднику</p>
        </div>
        <div class="controls">
          <select v-model="data.periodDays" class="ctrl-select">
            <option :value="7">7 дней</option><option :value="14">14 дней</option>
            <option :value="30">30 дней</option><option :value="60">60 дней</option><option :value="90">90 дней</option>
          </select>
          <select v-if="data.accounts.length" v-model="data.selectedAccount" class="ctrl-select">
            <option :value="undefined">Все аккаунты</option>
            <option v-for="a in data.accounts" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="data.loading" class="loading-overlay"><div class="spinner"></div></div>

      <template v-else-if="sorted.length">
        <!-- Charts -->
        <div class="charts-row">
          <div class="card">
            <div class="card-title">Выручка и воронка по менеджерам</div>
            <apexchart height="240" type="bar" :options="revenueChart.opts" :series="revenueChart.series" />
          </div>
          <div class="card">
            <div class="card-title">Конверсия в продажу (%)</div>
            <apexchart height="240" type="bar" :options="convChart.opts" :series="convChart.series" />
          </div>
        </div>

        <!-- Agent detail card -->
        <div class="charts-row" v-if="selectedAgent">
          <div class="card" style="grid-column: 1 / -1">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div class="card-title" style="margin:0">Детальный разбор: {{ selectedAgent.agentName }}</div>
              <button class="btn-outline" style="font-size:12px;padding:5px 10px;" @click="selectedAgent = null">✕ Закрыть</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
              <apexchart height="220" type="bar" :options="agentDetailChart!.opts" :series="agentDetailChart!.series" />
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start;padding-top:8px;">
                <div class="kpi-card" style="padding:14px 16px;">
                  <div class="kpi-label">Выручка</div>
                  <div class="kpi-value gold" style="font-size:20px">{{ fmtMoney(selectedAgent.totalRevenue) }}</div>
                </div>
                <div class="kpi-card" style="padding:14px 16px;">
                  <div class="kpi-label">Ср. сумма сделки</div>
                  <div class="kpi-value" style="font-size:20px">{{ fmtMoney(selectedAgent.avgDealValue) }}</div>
                </div>
                <div class="kpi-card" style="padding:14px 16px;">
                  <div class="kpi-label">Ср. цикл сделки</div>
                  <div class="kpi-value" style="font-size:20px">{{ selectedAgent.avgCycleDays ? fmtDays(selectedAgent.avgCycleDays) : '—' }}</div>
                </div>
                <div class="kpi-card" style="padding:14px 16px;">
                  <div class="kpi-label">Активная воронка</div>
                  <div class="kpi-value" style="font-size:20px">{{ fmtMoney(selectedAgent.activePipelineValue) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="card">
          <div class="card-title">Все менеджеры</div>
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Менеджер</th>
                  <th class="sortable" @click="setSort('leadsAssigned')">Назначено {{ sortIcon('leadsAssigned') }}</th>
                  <th class="sortable" @click="setSort('dealsWon')">Сделок {{ sortIcon('dealsWon') }}</th>
                  <th class="sortable" @click="setSort('conversionRate')">Конверсия {{ sortIcon('conversionRate') }}</th>
                  <th class="sortable" @click="setSort('totalRevenue')">Выручка {{ sortIcon('totalRevenue') }}</th>
                  <th class="sortable" @click="setSort('avgDealValue')">Ср. сделка {{ sortIcon('avgDealValue') }}</th>
                  <th class="sortable" @click="setSort('avgCycleDays')">Цикл {{ sortIcon('avgCycleDays') }}</th>
                  <th class="sortable" @click="setSort('activePipelineValue')">Воронка {{ sortIcon('activePipelineValue') }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(a, i) in sorted"
                  :key="a.agentId"
                  :class="{ selected: selectedAgent?.agentId === a.agentId }"
                  style="cursor:pointer"
                  @click="selectedAgent = a"
                >
                  <td style="color:var(--gold-dim);font-family:'Playfair Display',serif;">{{ i+1 }}</td>
                  <td style="font-weight:500">{{ a.agentName }}</td>
                  <td>{{ a.leadsAssigned }}</td>
                  <td style="color:var(--success)">{{ a.dealsWon }}</td>
                  <td>
                    <div class="conv-bar-wrap">
                      <div class="conv-bar-bg"><div class="conv-bar-fill" :style="{ width: (a.conversionRate * 100).toFixed(0) + '%' }"></div></div>
                      <span class="conv-pct">{{ fmtPct(a.conversionRate) }}</span>
                    </div>
                  </td>
                  <td style="color:var(--gold)">{{ fmtMoney(a.totalRevenue) }}</td>
                  <td style="color:var(--cream-dim)">{{ fmtMoney(a.avgDealValue) }}</td>
                  <td style="color:var(--cream-dim)">{{ a.avgCycleDays ? fmtDays(a.avgCycleDays) : '—' }}</td>
                  <td style="color:var(--warn)">{{ fmtMoney(a.activePipelineValue) }}</td>
                  <td><button class="btn-outline" style="font-size:11px;padding:4px 8px" @click.stop="selectedAgent = a">▼</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <div v-else-if="!data.loading" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.87"/></svg>
        <h3>Менеджеры не найдены</h3>
        <p>Синхронизируйте данные из CRM. Менеджеры появятся после импорта сделок.</p>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.sortable { cursor: pointer; user-select: none; }
.sortable:hover { color: var(--gold); }
.selected td { background: rgba(201,169,110,0.04) !important; }
</style>
