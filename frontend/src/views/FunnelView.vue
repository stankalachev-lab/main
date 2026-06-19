<script setup lang="ts">
import { onMounted, computed, watch } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { useDataStore } from '@/stores/data'
import { fmtPct } from '@/api/client'

const data = useDataStore()

onMounted(() => { data.fetchFunnel() })
watch([() => data.periodDays, () => data.selectedAccount], () => { data.fetchFunnel() })

const funnel = computed(() => data.funnel.filter(s => s.leadsEntered > 0))
const maxLeads = computed(() => funnel.value[0]?.leadsEntered ?? 1)

// ApexCharts waterfall-style: conversion rates per stage
const conversionChart = computed(() => ({
  series: [{ name: 'Конверсия', data: funnel.value.map(s => +(s.conversionRate * 100).toFixed(1)) }],
  opts: {
    chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 700 } },
    plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 4, dataLabels: { position: 'top' } } },
    dataLabels: { enabled: true, formatter: (v: number) => v + '%', style: { colors: ['#C9A96E'], fontSize: '11px', fontWeight: 400 }, offsetY: -18 },
    colors: ['#1e3b35'],
    fill: { type: 'gradient', gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.5, gradientToColors: ['#C9A96E'], opacityFrom: 0.9, opacityTo: 0.7, stops: [0, 100] } },
    grid: { borderColor: 'rgba(201,169,110,0.08)', strokeDashArray: 4 },
    xaxis: { categories: funnel.value.map(s => s.stageName), labels: { style: { colors: '#b0a898', fontSize: '11px' }, rotate: -30 } },
    yaxis: { max: 100, labels: { style: { colors: '#b0a898', fontSize: '11px' }, formatter: (v: number) => v + '%' } },
    tooltip: { theme: 'dark', y: { formatter: (v: number) => v + '%' } },
  },
}))

// Time in stage chart (hours)
const timeChart = computed(() => ({
  series: [{ name: 'Часов на этапе', data: funnel.value.map(s => +(s.avgTimeInStageHours).toFixed(1)) }],
  opts: {
    chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 700 } },
    plotOptions: { bar: { horizontal: true, barHeight: '55%', borderRadius: 4 } },
    colors: ['#4CAF82'],
    dataLabels: { enabled: false },
    grid: { borderColor: 'rgba(201,169,110,0.08)', strokeDashArray: 4 },
    xaxis: { categories: funnel.value.map(s => s.stageName), labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
    yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
    tooltip: { theme: 'dark', y: { formatter: (v: number) => v + ' ч (' + (v/24).toFixed(1) + ' дн)' } },
  },
}))

// Drop rate radial chart
const dropRateChart = computed(() => {
  const stages = funnel.value.slice(0, 5)
  return {
    series: stages.map(s => +(s.dropRate * 100).toFixed(1)),
    opts: {
      chart: { type: 'radialBar', background: 'transparent' },
      plotOptions: { radialBar: { hollow: { size: '30%' }, dataLabels: { name: { fontSize: '11px', color: '#b0a898' }, value: { fontSize: '13px', color: '#C9A96E', formatter: (v: number) => v + '%' } } } },
      colors: ['#e05252', '#e0a752', '#C9A96E', '#4CAF82', '#254D45'],
      labels: stages.map(s => s.stageName.slice(0, 12)),
      legend: { show: false },
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
          <h1 class="page-title">Воронка продаж</h1>
          <p class="page-sub">Конверсия и время на каждом этапе</p>
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

      <template v-else-if="funnel.length">
        <!-- Visual funnel -->
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title">Воронка — поэтапный охват</div>
          <div class="funnel-viz">
            <div class="funnel-step" v-for="(stage, i) in funnel" :key="stage.stageId">
              <div class="fv-bar-wrap">
                <div class="fv-bar" :style="{ width: ((stage.leadsEntered / maxLeads) * 100).toFixed(1) + '%' }">
                  <span class="fv-label">{{ stage.stageName }}</span>
                </div>
              </div>
              <div class="fv-stats">
                <span class="fv-count">{{ stage.leadsEntered }}</span>
                <span class="fv-conv" v-if="i > 0">↑ {{ fmtPct(stage.conversionRate) }}</span>
                <span class="fv-drop" v-if="stage.leadsDropped > 0">↓ {{ stage.leadsDropped }} ушло</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Charts -->
        <div class="charts-row">
          <div class="card">
            <div class="card-title">Конверсия по этапам (%)</div>
            <apexchart height="260" type="bar" :options="conversionChart.opts" :series="conversionChart.series" />
          </div>
          <div class="card">
            <div class="card-title">Среднее время на этапе (часы)</div>
            <apexchart height="260" type="bar" :options="timeChart.opts" :series="timeChart.series" />
          </div>
        </div>

        <!-- Drop rate radial + table -->
        <div class="charts-row">
          <div class="card">
            <div class="card-title">Процент потерь на этапах</div>
            <apexchart height="280" type="radialBar" :options="dropRateChart.opts" :series="dropRateChart.series" />
          </div>
          <div class="card">
            <div class="card-title">Детальная таблица</div>
            <div class="data-table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>#</th><th>Этап</th><th>Вошло</th><th>Прошло</th><th>Вышло</th><th>Конверсия</th><th>Потери</th><th>Ср. время</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(s, i) in funnel" :key="s.stageId">
                    <td style="color:var(--cream-dim);">{{ i+1 }}</td>
                    <td>{{ s.stageName }}</td>
                    <td>{{ s.leadsEntered }}</td>
                    <td style="color:var(--success)">{{ s.leadsAdvanced }}</td>
                    <td style="color:var(--danger)">{{ s.leadsDropped }}</td>
                    <td style="color:var(--gold)">{{ fmtPct(s.conversionRate) }}</td>
                    <td style="color:var(--danger)">{{ fmtPct(s.dropRate) }}</td>
                    <td style="color:var(--cream-dim)">{{ s.avgTimeInStageHours > 0 ? (s.avgTimeInStageHours / 24).toFixed(1) + ' дн' : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="!data.loading" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6l18-4v4l-9 2-9-2z"/><path d="M3 10l9 2 9-2v4l-9 2-9-2z"/><path d="M3 18l9 2 9-2"/></svg>
        <h3>Данные воронки недоступны</h3>
        <p>Синхронизируйте CRM и убедитесь, что в аккаунте есть этапы воронки.</p>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.funnel-viz { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
.funnel-step { display: flex; align-items: center; gap: 16px; }
.fv-bar-wrap { flex: 1; height: 32px; position: relative; }
.fv-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--forest-light), rgba(201,169,110,0.3));
  border-radius: 4px;
  display: flex; align-items: center; padding: 0 12px;
  transition: width 0.8s cubic-bezier(0.4,0,0.2,1);
  min-width: 80px;
}
.fv-label { font-size: 12px; color: var(--cream); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fv-stats { display: flex; gap: 10px; min-width: 180px; font-size: 12px; }
.fv-count { color: var(--cream); font-weight: 500; min-width: 32px; }
.fv-conv { color: var(--success); }
.fv-drop { color: var(--danger); }
</style>
