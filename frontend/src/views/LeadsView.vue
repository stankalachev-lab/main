<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { api, fmtMoney, fmtDate } from '@/api/client'
import type { UnifiedLead } from '@/api/client'
import { useDataStore } from '@/stores/data'

const dataStore = useDataStore()
const leads = ref<UnifiedLead[]>([])
const total = ref(0)
const page = ref(1)
const limit = 50
const loading = ref(false)
const search = ref('')
const statusFilter = ref('')
const selectedLead = ref<UnifiedLead | null>(null)

async function fetchLeads() {
  loading.value = true
  try {
    const res = await api.leads({
      page: page.value,
      limit,
      accountId: dataStore.selectedAccount,
      status: statusFilter.value || undefined,
      search: search.value || undefined,
    })
    leads.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}

onMounted(fetchLeads)
watch([page, statusFilter, () => dataStore.selectedAccount], fetchLeads)

let searchTimer: ReturnType<typeof setTimeout>
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchLeads() }, 400)
}

const totalPages = computed(() => Math.ceil(total.value / limit))

function statusLabel(s: string) {
  const map: Record<string, string> = { open: 'Открыта', won: 'Выиграна', lost: 'Проиграна', deleted: 'Удалена' }
  return map[s] ?? s
}

function propTypeLabel(t: string | null) {
  if (!t) return '—'
  const map: Record<string, string> = { apartment: 'Квартира', house: 'Дом/Вилла', commercial: 'Коммерция', land: 'Участок', other: 'Другое' }
  return map[t] ?? t
}

function dealSideLabel(s: string | null) {
  if (!s) return '—'
  return { buy: 'Покупка', sell: 'Продажа', rent: 'Аренда' }[s] ?? s
}

function utmFrom(lead: UnifiedLead): string[] {
  const cf = lead.customFields
  const tags: string[] = []
  const fields: [string, string][] = [
    ['utm_source', 'src'], ['utm_medium', 'med'], ['utm_campaign', 'cmp'], ['utm_content', 'cnt']
  ]
  for (const [key, short] of fields) {
    if (cf[key]) tags.push(`${short}: ${cf[key]}`)
  }
  return tags
}
</script>

<template>
  <AppLayout>
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Сделки</h1>
          <p class="page-sub">{{ total.toLocaleString('ru') }} сделок · стр. {{ page }} / {{ totalPages }}</p>
        </div>
        <div class="controls">
          <div class="search-wrap">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input v-model="search" @input="onSearch" class="search-input" placeholder="Поиск..." />
          </div>
          <select v-model="statusFilter" class="ctrl-select">
            <option value="">Все статусы</option>
            <option value="open">Открытые</option>
            <option value="won">Выигранные</option>
            <option value="lost">Проигранные</option>
          </select>
          <select v-if="dataStore.accounts.length" v-model="dataStore.selectedAccount" class="ctrl-select">
            <option :value="undefined">Все аккаунты</option>
            <option v-for="a in dataStore.accounts" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="loading" class="loading-overlay"><div class="spinner"></div></div>

      <template v-else>
        <div class="card">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Название сделки</th>
                  <th>Статус</th>
                  <th>Этап</th>
                  <th>Тип объекта</th>
                  <th>Вид сделки</th>
                  <th>Ответственный</th>
                  <th>Сумма</th>
                  <th>Создана</th>
                  <th>Закрыта</th>
                  <th>UTM</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="lead in leads"
                  :key="lead.id"
                  @click="selectedLead = lead"
                  style="cursor:pointer"
                  :class="{ selected: selectedLead?.id === lead.id }"
                >
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;font-weight:500">{{ lead.name }}</td>
                  <td>
                    <span class="badge" :class="lead.status">
                      <span class="badge-dot"></span>{{ statusLabel(lead.status) }}
                    </span>
                  </td>
                  <td style="color:var(--cream-dim)">{{ lead.stageName }}</td>
                  <td>{{ propTypeLabel(lead.propertyType) }}</td>
                  <td>{{ dealSideLabel(lead.dealSide) }}</td>
                  <td style="color:var(--cream-dim)">{{ lead.responsibleUserName ?? '—' }}</td>
                  <td style="color:var(--gold);font-weight:500">{{ lead.value ? fmtMoney(lead.value, lead.currency) : '—' }}</td>
                  <td style="color:var(--cream-dim)">{{ fmtDate(lead.createdAt) }}</td>
                  <td style="color:var(--cream-dim)">{{ lead.closedAt ? fmtDate(lead.closedAt) : '—' }}</td>
                  <td>
                    <div style="display:flex;gap:4px;flex-wrap:wrap">
                      <span v-for="tag in utmFrom(lead)" :key="tag" class="utm-chip">{{ tag }}</span>
                      <span v-if="!utmFrom(lead).length" style="color:var(--cream-dim);font-size:11px">—</span>
                    </div>
                  </td>
                </tr>
                <tr v-if="!leads.length">
                  <td colspan="10" style="text-align:center;padding:40px;color:var(--cream-dim)">Сделок не найдено</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pagination">
            <span class="pagination-info">Показано {{ leads.length }} из {{ total }}</span>
            <div class="pagination-btns">
              <button class="page-btn" :disabled="page <= 1" @click="page--">‹</button>
              <button
                v-for="p in Math.min(totalPages, 7)"
                :key="p"
                class="page-btn"
                :class="{ active: p === page }"
                @click="page = p"
              >{{ p }}</button>
              <button class="page-btn" :disabled="page >= totalPages" @click="page++">›</button>
            </div>
          </div>
        </div>

        <!-- Lead detail panel -->
        <div v-if="selectedLead" class="card mt-16">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <h2 style="font-size:16px;color:var(--cream)">{{ selectedLead.name }}</h2>
            <button class="btn-outline" style="font-size:12px;padding:5px 10px" @click="selectedLead = null">✕</button>
          </div>
          <div class="detail-grid">
            <div class="detail-item"><span class="detail-key">Статус</span><span class="badge" :class="selectedLead.status"><span class="badge-dot"></span>{{ statusLabel(selectedLead.status) }}</span></div>
            <div class="detail-item"><span class="detail-key">Этап</span><span>{{ selectedLead.stageName }}</span></div>
            <div class="detail-item"><span class="detail-key">Ответственный</span><span>{{ selectedLead.responsibleUserName ?? '—' }}</span></div>
            <div class="detail-item"><span class="detail-key">Сумма</span><span style="color:var(--gold);font-weight:500">{{ selectedLead.value ? fmtMoney(selectedLead.value, selectedLead.currency) : '—' }}</span></div>
            <div class="detail-item"><span class="detail-key">Тип объекта</span><span>{{ propTypeLabel(selectedLead.propertyType) }}</span></div>
            <div class="detail-item"><span class="detail-key">Вид сделки</span><span>{{ dealSideLabel(selectedLead.dealSide) }}</span></div>
            <div class="detail-item" v-if="selectedLead.areaM2"><span class="detail-key">Площадь</span><span>{{ selectedLead.areaM2 }} м²</span></div>
            <div class="detail-item" v-if="selectedLead.propertyAddress"><span class="detail-key">Адрес</span><span>{{ selectedLead.propertyAddress }}</span></div>
            <div class="detail-item"><span class="detail-key">Создана</span><span>{{ fmtDate(selectedLead.createdAt) }}</span></div>
            <div class="detail-item"><span class="detail-key">Закрыта</span><span>{{ selectedLead.closedAt ? fmtDate(selectedLead.closedAt) : '—' }}</span></div>
          </div>
          <div v-if="selectedLead.tags.length" style="margin-top:12px">
            <span class="detail-key">Теги: </span>
            <span v-for="tag in selectedLead.tags" :key="tag" class="utm-chip" style="margin-right:4px">{{ tag }}</span>
          </div>
          <div v-if="Object.keys(selectedLead.customFields).length" style="margin-top:12px">
            <div class="detail-key" style="margin-bottom:6px">Дополнительные поля (включая UTM)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span v-for="[k,v] in Object.entries(selectedLead.customFields).filter(([,v]) => v)" :key="k" class="utm-chip">
                <span class="k">{{ k }}:</span> {{ String(v).slice(0, 40) }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.selected td { background: rgba(201,169,110,0.04) !important; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.detail-item { display: flex; flex-direction: column; gap: 4px; }
.detail-key { font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--cream-dim); }
</style>
