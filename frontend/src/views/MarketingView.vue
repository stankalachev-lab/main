<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { api, fmtMoney, fmtPct } from '@/api/client'
import type { UnifiedLead } from '@/api/client'
import { useDataStore } from '@/stores/data'

const dataStore = useDataStore()
const leads = ref<UnifiedLead[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    // Load all leads for UTM analysis (up to 500)
    const res = await api.leads({ limit: 500, accountId: dataStore.selectedAccount })
    leads.value = res.items
  } finally {
    loading.value = false
  }
})

// Extract UTM field from customFields using common naming conventions
function getUTM(lead: UnifiedLead, key: string): string {
  const cf = lead.customFields
  // Try multiple common field names
  const candidates = [key, key.replace('utm_', ''), 'Roistat_' + key.replace('utm_', '')]
  for (const k of candidates) {
    if (cf[k]) return String(cf[k])
  }
  return ''
}

interface UtmRow { label: string; total: number; won: number; revenue: number; conv: number }

function buildUtmReport(field: string): UtmRow[] {
  const map = new Map<string, { total: number; won: number; revenue: number }>()
  for (const lead of leads.value) {
    const val = getUTM(lead, field) || '(не задан)'
    if (!map.has(val)) map.set(val, { total: 0, won: 0, revenue: 0 })
    const row = map.get(val)!
    row.total++
    if (lead.status === 'won') { row.won++; row.revenue += lead.value }
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, ...v, conv: v.total > 0 ? v.won / v.total : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
}

const utmSource = computed(() => buildUtmReport('utm_source'))
const utmMedium = computed(() => buildUtmReport('utm_medium'))
const utmCampaign = computed(() => buildUtmReport('utm_campaign'))

// Charts
function barChart(rows: UtmRow[], key: 'revenue' | 'conv') {
  const top = rows.slice(0, 8)
  return {
    series: key === 'revenue'
      ? [{ name: 'Выручка', data: top.map(r => r.revenue) }]
      : [{ name: 'Конверсия %', data: top.map(r => +(r.conv * 100).toFixed(1)) }],
    opts: {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 600 } },
      plotOptions: { bar: { horizontal: true, barHeight: '60%', borderRadius: 3 } },
      colors: key === 'revenue' ? ['#C9A96E'] : ['#4CAF82'],
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(201,169,110,0.08)', strokeDashArray: 4 },
      xaxis: {
        categories: top.map(r => r.label.slice(0, 20)),
        labels: { style: { colors: '#b0a898', fontSize: '11px' }, formatter: key === 'revenue' ? (v: number) => fmtMoney(v) : (v: number) => v + '%' },
      },
      yaxis: { labels: { style: { colors: '#b0a898', fontSize: '11px' } } },
      tooltip: { theme: 'dark', y: { formatter: key === 'revenue' ? (v: number) => fmtMoney(v) : (v: number) => v + '%' } },
    },
  }
}

const srcRevChart = computed(() => barChart(utmSource.value, 'revenue'))
const srcConvChart = computed(() => barChart(utmSource.value, 'conv'))
const medRevChart = computed(() => barChart(utmMedium.value, 'revenue'))
const campRevChart = computed(() => barChart(utmCampaign.value, 'revenue'))

const hasUtmData = computed(() => leads.value.some(l => getUTM(l, 'utm_source')))
const currency = computed(() => leads.value[0]?.currency ?? 'RUB')
</script>

<template>
  <AppLayout>
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Маркетинговые отчёты</h1>
          <p class="page-sub">Анализ трафика по UTM-меткам — источники, каналы, кампании</p>
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
          <div style="padding:12px 0 20px">
            <div class="card-title" style="color:var(--warn)">UTM данные не обнаружены</div>
            <p style="font-size:13px;color:var(--cream-dim);line-height:1.6;max-width:600px">
              UTM-метки хранятся в дополнительных полях сделки в Kommo/AmoCRM.<br />
              Чтобы включить UTM-аналитику, добавьте маппинг полей в <code style="color:var(--gold)">KOMMO_ACCOUNTS</code>:
            </p>
            <pre class="code-block mt-16">
"fieldMappings": {
  "utm_source":   "ID_ПОЛЯ_UTM_SOURCE",
  "utm_medium":   "ID_ПОЛЯ_UTM_MEDIUM",
  "utm_campaign": "ID_ПОЛЯ_UTM_CAMPAIGN",
  "utm_content":  "ID_ПОЛЯ_UTM_CONTENT"
}</pre>
            <p style="font-size:12px;color:var(--cream-dim);margin-top:12px">
              ID полей можно узнать через <code style="color:var(--gold)">/api/sync</code> + <code style="color:var(--gold)">discover_custom_fields</code> в MCP.
            </p>
          </div>
        </div>

        <!-- Show raw stats even without UTM -->
        <div class="card mt-16" v-if="leads.length">
          <div class="card-title">Статистика по статусам сделок</div>
          <div class="charts-row">
            <div>
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
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;justify-content:center">
              <div class="kpi-card" style="padding:12px 16px">
                <div class="kpi-label">Всего сделок</div>
                <div class="kpi-value" style="font-size:22px">{{ leads.length }}</div>
              </div>
              <div class="kpi-card" style="padding:12px 16px">
                <div class="kpi-label">Общая выручка</div>
                <div class="kpi-value gold" style="font-size:20px">{{ fmtMoney(leads.filter(l=>l.status==='won').reduce((s,l)=>s+l.value,0), currency) }}</div>
              </div>
              <div class="kpi-card" style="padding:12px 16px">
                <div class="kpi-label">Конверсия</div>
                <div class="kpi-value" style="font-size:20px">{{ fmtPct(leads.filter(l=>l.status!=='open').length ? leads.filter(l=>l.status==='won').length / leads.filter(l=>l.status!=='open').length : 0) }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- UTM Source -->
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">Источники трафика (utm_source)</div>
          <div class="charts-row">
            <div>
              <div style="font-size:11px;color:var(--cream-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.07em">Выручка по источнику</div>
              <apexchart height="220" type="bar" :options="srcRevChart.opts" :series="srcRevChart.series" />
            </div>
            <div>
              <div style="font-size:11px;color:var(--cream-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.07em">Конверсия по источнику</div>
              <apexchart height="220" type="bar" :options="srcConvChart.opts" :series="srcConvChart.series" />
            </div>
          </div>
          <div class="data-table-wrap mt-16">
            <table class="data-table">
              <thead><tr><th>Источник</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th><th>Выручка</th></tr></thead>
              <tbody>
                <tr v-for="r in utmSource" :key="r.label">
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

        <!-- UTM Medium -->
        <div class="charts-row">
          <div class="card">
            <div class="card-title">Каналы трафика (utm_medium) — выручка</div>
            <apexchart height="220" type="bar" :options="medRevChart.opts" :series="medRevChart.series" />
          </div>
          <div class="card">
            <div class="card-title">Кампании (utm_campaign) — выручка</div>
            <apexchart height="220" type="bar" :options="campRevChart.opts" :series="campRevChart.series" />
          </div>
        </div>

        <!-- Medium table -->
        <div class="charts-row">
          <div class="card">
            <div class="card-title">Детально: utm_medium</div>
            <div class="data-table-wrap">
              <table class="data-table">
                <thead><tr><th>Канал</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th><th>Выручка</th></tr></thead>
                <tbody>
                  <tr v-for="r in utmMedium" :key="r.label">
                    <td style="font-weight:500">{{ r.label }}</td><td>{{ r.total }}</td>
                    <td style="color:var(--success)">{{ r.won }}</td>
                    <td style="color:var(--gold)">{{ fmtPct(r.conv) }}</td>
                    <td style="color:var(--gold)">{{ fmtMoney(r.revenue, currency) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Детально: utm_campaign</div>
            <div class="data-table-wrap">
              <table class="data-table">
                <thead><tr><th>Кампания</th><th>Лидов</th><th>Сделок</th><th>Конверсия</th><th>Выручка</th></tr></thead>
                <tbody>
                  <tr v-for="r in utmCampaign" :key="r.label">
                    <td style="font-weight:500">{{ r.label }}</td><td>{{ r.total }}</td>
                    <td style="color:var(--success)">{{ r.won }}</td>
                    <td style="color:var(--gold)">{{ fmtPct(r.conv) }}</td>
                    <td style="color:var(--gold)">{{ fmtMoney(r.revenue, currency) }}</td>
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
</style>
