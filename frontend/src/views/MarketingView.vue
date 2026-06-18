<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { api, fmtMoney, fmtPct } from '@/api/client'
import type { UnifiedLead } from '@/api/client'
import { useDataStore } from '@/stores/data'

const dataStore = useDataStore()
const leads = ref<UnifiedLead[]>([])
const loading = ref(false)

async function loadLeads() {
  loading.value = true
  try {
    const res = await api.leads({ limit: 500, accountId: dataStore.selectedAccount })
    leads.value = res.items
  } finally {
    loading.value = false
  }
}

onMounted(loadLeads)
watch(() => dataStore.selectedAccount, loadLeads)

interface UtmRow { label: string; total: number; won: number; revenue: number; conv: number }

function buildReport(getter: (l: UnifiedLead) => string): UtmRow[] {
  const map = new Map<string, { total: number; won: number; revenue: number }>()
  for (const lead of leads.value) {
    const val = getter(lead) || '(не задан)'
    if (!map.has(val)) map.set(val, { total: 0, won: 0, revenue: 0 })
    const row = map.get(val)!
    row.total++
    if (lead.status === 'won') { row.won++; row.revenue += lead.value }
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, ...v, conv: v.total > 0 ? v.won / v.total : 0 }))
    .sort((a, b) => b.total - a.total)
}

const byReferrer  = computed(() => buildReport(l => l.utm?.referrer  ?? ''))
const byCampaign  = computed(() => buildReport(l => l.utm?.campaign  ?? ''))
const byTerm      = computed(() => buildReport(l => l.utm?.term      ?? ''))
const bySource    = computed(() => buildReport(l => l.utm?.source    ?? ''))
const byMedium    = computed(() => buildReport(l => l.utm?.medium    ?? ''))

const hasUtmData = computed(() => leads.value.some(l => l.utm !== null))
const currency = computed(() => leads.value[0]?.currency ?? 'USD')

// ── Charts ─────────────────────────────────────────────────────────────────

function hBarChart(rows: UtmRow[], key: 'total' | 'conv', color: string) {
  const top = rows.slice(0, 8)
  return {
    series: key === 'conv'
      ? [{ name: 'Конверсия %', data: top.map(r => +(r.conv * 100).toFixed(1)) }]
      : [{ name: 'Лидов', data: top.map(r => r.total) }],
    opts: {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 600 } },
      plotOptions: { bar: { horizontal: true, barHeight: '60%', borderRadius: 3 } },
      colors: [color],
      dataLabels: { enabled: true, style: { colors: ['#F5F0E8'], fontSize: '11px', fontWeight: 400 } },
      grid: { borderColor: 'rgba(201,169,110,0.08)', strokeDashArray: 4 },
      xaxis: {
        categories: top.map(r => r.label.length > 22 ? r.label.slice(0, 22) + '…' : r.label),
        labels: { style: { colors: '#b0a898', fontSize: '11px' } },
      },
      yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      tooltip: { theme: 'dark' },
    },
  }
}

const refLeadsChart = computed(() => hBarChart(byReferrer.value, 'total', '#C9A96E'))
const refConvChart  = computed(() => hBarChart(byReferrer.value, 'conv', '#4CAF82'))
const campChart     = computed(() => hBarChart(byCampaign.value, 'total', '#254D45'))
const termChart     = computed(() => hBarChart(byTerm.value, 'total', '#e0a752'))

const mqlCount = computed(() => leads.value.filter(l => l.mql).length)
const sqlCount = computed(() => leads.value.filter(l => l.sql).length)
const wonCount = computed(() => leads.value.filter(l => l.status === 'won').length)
</script>

<template>
  <AppLayout>
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Маркетинговые отчёты</h1>
          <p class="page-sub">Анализ рекламного трафика по площадкам, кампаниям и объявлениям</p>
        </div>
        <div class="controls">
          <select v-if="dataStore.accounts.length" v-model="dataStore.selectedAccount" class="ctrl-select">
            <option :value="undefined">Все аккаунты</option>
            <option v-for="a in dataStore.accounts" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="loading" class="loading-overlay"><div class="spinner"></div></div>

      <template v-else-if="!hasUtmData">
        <div class="card">
          <div style="padding:8px 0 20px">
            <div class="card-title" style="color:var(--warn)">UTM данные не обнаружены</div>
            <p style="font-size:13px;color:var(--cream-dim);line-height:1.7;max-width:640px;margin-bottom:16px">
              UTM-метки хранятся в дополнительных полях сделки в Kommo/AmoCRM.<br/>
              Добавьте <code style="color:var(--gold)">fieldMappings</code> в конфигурацию аккаунта в <code style="color:var(--gold)">KOMMO_ACCOUNTS</code>:
            </p>
            <pre class="code-block">"fieldMappings": {
  "utmSource":   "371573",
  "utmMedium":   "371569",
  "utmCampaign": "371571",
  "utmContent":  "371567",
  "utmTerm":     "371575",
  "utmReferrer": "371577",
  "mql":         "1635869",
  "sql":         "1635871"
}</pre>
            <p style="font-size:12px;color:var(--cream-dim);margin-top:12px">
              После добавления ID полей выполните синхронизацию: <code style="color:var(--gold)">POST /api/sync</code>
            </p>
          </div>
        </div>

        <div class="card mt-16" v-if="leads.length">
          <div class="card-title">Общая статистика по сделкам</div>
          <div class="charts-row">
            <apexchart height="220" type="donut" :options="{
              chart: { background: 'transparent' },
              colors: ['#e0a752','#4CAF82','#e05252'],
              labels: ['Открытые','Выигранные','Проигранные'],
              legend: { labels: { colors: '#b0a898' } },
              dataLabels: { style: { colors: ['#F5F0E8'] } },
              tooltip: { theme: 'dark' },
              plotOptions: { pie: { donut: { size: '55%' } } }
            }" :series="[
              leads.filter(l => l.status==='open').length,
              leads.filter(l => l.status==='won').length,
              leads.filter(l => l.status==='lost').length
            ]" />
            <div style="display:flex;flex-direction:column;gap:10px;justify-content:center">
              <div class="kpi-card" style="padding:12px 16px">
                <div class="kpi-label">Всего сделок</div>
                <div class="kpi-value" style="font-size:22px">{{ leads.length }}</div>
              </div>
              <div class="kpi-card" style="padding:12px 16px">
                <div class="kpi-label">Выручка</div>
                <div class="kpi-value gold" style="font-size:20px">{{ fmtMoney(leads.filter(l=>l.status==='won').reduce((s,l)=>s+l.value,0), currency) }}</div>
              </div>
              <div class="kpi-card" style="padding:12px 16px">
                <div class="kpi-label">Конверсия</div>
                <div class="kpi-value" style="font-size:20px">{{ fmtPct(leads.filter(l=>l.status!=='open').length ? wonCount / leads.filter(l=>l.status!=='open').length : 0) }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- KPI row -->
        <div class="kpi-row" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
          <div class="kpi-card">
            <div class="kpi-label">Лидов всего</div>
            <div class="kpi-value" style="font-size:26px">{{ leads.length }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">MQL</div>
            <div class="kpi-value gold" style="font-size:26px">{{ mqlCount }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">SQL</div>
            <div class="kpi-value" style="font-size:26px;color:var(--success)">{{ sqlCount }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Сделок закрыто</div>
            <div class="kpi-value" style="font-size:26px;color:var(--success)">{{ wonCount }}</div>
          </div>
        </div>

        <!-- Placement (utm_referrer) — primary dimension -->
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">Площадки (utm_referrer) — Facebook / Instagram</div>
          <div class="charts-row">
            <div>
              <div class="chart-label">Лидов по площадке</div>
              <apexchart height="240" type="bar" :options="refLeadsChart.opts" :series="refLeadsChart.series" />
            </div>
            <div>
              <div class="chart-label">Конверсия по площадке</div>
              <apexchart height="240" type="bar" :options="refConvChart.opts" :series="refConvChart.series" />
            </div>
          </div>
          <div class="data-table-wrap mt-16">
            <table class="data-table">
              <thead><tr><th>Площадка</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th><th>Выручка</th></tr></thead>
              <tbody>
                <tr v-for="r in byReferrer" :key="r.label">
                  <td style="font-weight:500">{{ r.label }}</td>
                  <td>{{ r.total }}</td>
                  <td style="color:var(--success)">{{ r.won }}</td>
                  <td style="color:var(--gold)">{{ fmtPct(r.conv) }}</td>
                  <td style="color:var(--gold)">{{ fmtMoney(r.revenue, currency) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Campaign + Ad variant -->
        <div class="charts-row" style="margin-bottom:16px">
          <div class="card">
            <div class="card-title">Кампании (utm_campaign)</div>
            <apexchart height="220" type="bar" :options="campChart.opts" :series="campChart.series" />
            <div class="data-table-wrap mt-16">
              <table class="data-table">
                <thead><tr><th>Кампания</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th></tr></thead>
                <tbody>
                  <tr v-for="r in byCampaign" :key="r.label">
                    <td style="font-weight:500;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.label }}</td>
                    <td>{{ r.total }}</td>
                    <td style="color:var(--success)">{{ r.won }}</td>
                    <td style="color:var(--gold)">{{ fmtPct(r.conv) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Варианты объявлений (utm_term)</div>
            <apexchart height="220" type="bar" :options="termChart.opts" :series="termChart.series" />
            <div class="data-table-wrap mt-16">
              <table class="data-table">
                <thead><tr><th>Вариант</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th></tr></thead>
                <tbody>
                  <tr v-for="r in byTerm" :key="r.label">
                    <td style="font-weight:500">{{ r.label }}</td>
                    <td>{{ r.total }}</td>
                    <td style="color:var(--success)">{{ r.won }}</td>
                    <td style="color:var(--gold)">{{ fmtPct(r.conv) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Source / Medium (secondary, often blank) -->
        <div class="charts-row" v-if="bySource.some(r => r.label !== '(не задан)') || byMedium.some(r => r.label !== '(не задан)')">
          <div class="card" v-if="bySource.some(r => r.label !== '(не задан)')">
            <div class="card-title">Источники (utm_source)</div>
            <div class="data-table-wrap">
              <table class="data-table">
                <thead><tr><th>Источник</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th></tr></thead>
                <tbody>
                  <tr v-for="r in bySource" :key="r.label">
                    <td style="font-weight:500">{{ r.label }}</td><td>{{ r.total }}</td>
                    <td style="color:var(--success)">{{ r.won }}</td><td style="color:var(--gold)">{{ fmtPct(r.conv) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card" v-if="byMedium.some(r => r.label !== '(не задан)')">
            <div class="card-title">Каналы (utm_medium)</div>
            <div class="data-table-wrap">
              <table class="data-table">
                <thead><tr><th>Канал</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th></tr></thead>
                <tbody>
                  <tr v-for="r in byMedium" :key="r.label">
                    <td style="font-weight:500">{{ r.label }}</td><td>{{ r.total }}</td>
                    <td style="color:var(--success)">{{ r.won }}</td><td style="color:var(--gold)">{{ fmtPct(r.conv) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.code-block { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; font-size: 12px; color: var(--cream-dim); font-family: 'Courier New', monospace; line-height: 1.7; overflow-x: auto; }
code { font-family: 'Courier New', monospace; }
.chart-label { font-size: 11px; color: var(--cream-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .07em; }
.mt-16 { margin-top: 16px; }
</style>
