export function getToken(): string | null { return localStorage.getItem('jwt') }
export function setToken(t: string) { localStorage.setItem('jwt', t) }
export function clearToken() { localStorage.removeItem('jwt') }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  }
  const res = await fetch(path, { ...options, headers })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error: string }).error ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

type QP = Record<string, string | number | undefined>
function qs(p: QP) {
  return Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
}

// ── API Types matching server response exactly ────────────────────────────

export interface Account {
  id: string; label: string; variant: 'kommo' | 'amo'; subdomain: string; lastSyncAt: string | null
}

export interface DashboardSummary {
  asOf: string; periodDays: number; accounts: string[]
  totalLeads: number; openLeads: number; wonLeads: number; lostLeads: number
  overallConversionRate: number; totalPipelineValue: number; totalClosedRevenue: number; currency: string
  velocity: PipelineVelocityMetric[]; topAgents: AgentPerformanceMetric[]; funnelSnapshot: ConversionRateByStage[]
}

export interface PipelineVelocityMetric {
  pipelineId: string; pipelineName: string; accountId: string; periodDays: number
  avgDaysInStage: Record<string, number>; avgDealCycleDays: number
  leadsEntered: number; leadsExited: number; dealsWon: number; dealsLost: number
  conversionRate: number; totalPipelineValue: number; currency: string
}

export interface ConversionRateByStage {
  stageId: string; stageName: string; stageOrder: number; stageAlias: string | null
  leadsEntered: number; leadsAdvanced: number; leadsDropped: number
  conversionRate: number; dropRate: number; avgTimeInStageHours: number
}

export interface AgentPerformanceMetric {
  agentId: string; agentName: string; accountId: string; periodDays: number
  leadsAssigned: number; dealsWon: number; dealsLost: number; conversionRate: number
  totalRevenue: number; avgDealValue: number; avgCycleDays: number
  activePipelineValue: number; activePipelineCount: number
}

export interface LeadUtm {
  source: string | null; medium: string | null; campaign: string | null
  content: string | null; term: string | null; referrer: string | null
}

export interface UnifiedLead {
  id: string; sourceAccountId: string; sourceLeadId: string; name: string
  status: 'open' | 'won' | 'lost' | 'deleted'
  pipelineId: string; stageId: string; stageName: string; stageOrder: number
  responsibleUserId: string | null; responsibleUserName: string | null
  propertyType: string | null; propertyAddress: string | null; dealSide: string | null
  areaM2: number | null; value: number; currency: string
  createdAt: string; updatedAt: string; closedAt: string | null
  tags: string[]
  utm: LeadUtm | null
  mql: boolean | null
  sql: boolean | null
  customFields: Record<string, unknown>
}

export interface LeadsResponse { total: number; page: number; limit: number; items: UnifiedLead[] }

// ── API calls ─────────────────────────────────────────────────────────────

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  accounts: () => request<Account[]>('/api/accounts'),

  dashboard: (p: QP = {}) => request<DashboardSummary>(`/api/dashboard?${qs(p)}`),

  funnel: (p: QP = {}) => request<ConversionRateByStage[]>(`/api/analytics/funnel?${qs(p)}`),

  velocity: (p: QP = {}) => request<PipelineVelocityMetric[]>(`/api/analytics/velocity?${qs(p)}`),

  team: (p: QP = {}) => request<AgentPerformanceMetric[]>(`/api/analytics/team?${qs(p)}`),

  leads: (p: QP = {}) => request<LeadsResponse>(`/api/leads?${qs(p)}`),

  sync: (accountId?: string) =>
    request<unknown>('/api/sync', { method: 'POST', body: JSON.stringify(accountId ? { accountId } : {}) }),
}

// ── Formatters ────────────────────────────────────────────────────────────

export function fmtMoney(v: number, currency = 'RUB'): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} млрд`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)} тыс`
  return v.toLocaleString('ru-RU') + ' ' + currency
}

export function fmtPct(v: number): string { return `${(v * 100).toFixed(1)}%` }
export function fmtDays(v: number): string { return `${v.toFixed(1)} дн` }
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
