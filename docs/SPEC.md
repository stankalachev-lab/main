# Multi-CRM Analytics MCP Server — Technical Specification

**Version:** 1.0  
**Date:** 2026-06-17  
**Author:** Generated via Claude Code  

---

## 1. Overview

This document specifies a **Model Context Protocol (MCP) server** that aggregates real estate sales pipeline data from multiple CRM accounts (Kommo and AmoCRM), normalises it into a unified schema, and exposes analytics tools for pipeline velocity, conversion rates, deal-value distribution, and team performance.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          MCP Client (AI / Dashboard)                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ MCP Protocol (JSON-RPC 2.0 / stdio)
┌──────────────────────────────▼──────────────────────────────────────┐
│                       MCP Server  (Node.js / TypeScript)             │
│                                                                       │
│  ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │  Tool Registry  │   │  Account Manager │   │  Credential Vault│  │
│  │  (25+ tools)    │   │  (multi-tenant)  │   │  (env / secrets) │  │
│  └────────┬────────┘   └────────┬─────────┘   └────────┬─────────┘  │
│           │                     │                       │             │
│  ┌────────▼─────────────────────▼───────────────────── ▼──────────┐  │
│  │                     ETL  Pipeline                               │  │
│  │   ┌──────────────┐      ┌──────────────┐      ┌─────────────┐  │  │
│  │   │  Extractor   │  →   │ Transformer  │  →   │  Aggregator │  │  │
│  │   │  (REST pull) │      │ (normalise)  │      │ (analytics) │  │  │
│  │   └──────────────┘      └──────────────┘      └─────────────┘  │  │
│  └──────┬────────────────────────────────────────────────┬─────────┘  │
│         │                                                │             │
│  ┌──────▼──────────┐                        ┌───────────▼──────────┐  │
│  │  CRM Connectors │                        │   In-Memory Cache    │  │
│  │  ┌────────────┐ │                        │   (TTL 15 min)       │  │
│  │  │   Kommo    │ │                        └──────────────────────┘  │
│  │  │ Connector  │ │                                                   │
│  │  └────────────┘ │                                                   │
│  │  ┌────────────┐ │                                                   │
│  │  │  AmoCRM   │ │                                                   │
│  │  │ Connector  │ │                                                   │
│  │  └────────────┘ │                                                   │
│  └─────────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
           │                             │
           ▼                             ▼
  ┌──────────────────┐        ┌──────────────────────┐
  │  Kommo REST API  │        │   AmoCRM REST API    │
  │  kommo.com/v4    │        │   amocrm.ru/v4       │
  └──────────────────┘        └──────────────────────┘
```

---

## 3. CRM Connection Interface

### 3.1 Supported CRM Variants

| Variant    | Base URL Pattern                        | Auth Method | Notes                        |
|------------|----------------------------------------|-------------|------------------------------|
| `kommo`    | `https://{subdomain}.kommo.com/api/v4` | OAuth 2.0   | International (ex-amoCRM)    |
| `amo`      | `https://{subdomain}.amocrm.ru/api/v4` | OAuth 2.0   | Russian market variant       |

Both variants share an identical REST API surface (v4). The only differences are the base domain and OAuth token endpoint.

### 3.2 Required Auth Fields (per account)

```typescript
interface CRMAccountConfig {
  id: string;               // Unique account identifier (e.g. "kommo_realty_moscow")
  label: string;            // Human-readable name
  variant: "kommo" | "amo";
  subdomain: string;        // e.g. "mycompany"
  clientId: string;         // OAuth2 client_id
  clientSecret: string;     // OAuth2 client_secret
  redirectUri: string;      // OAuth2 redirect_uri
  accessToken: string;      // Short-lived access token (2h TTL)
  refreshToken: string;     // Long-lived refresh token
  tokenExpiresAt: number;   // Unix timestamp
}
```

### 3.3 Credential Storage

Credentials are loaded from **environment variables** at server startup and never written to disk:

```
KOMMO_ACCOUNTS=<base64-encoded JSON array of CRMAccountConfig>
AMO_ACCOUNTS=<base64-encoded JSON array of CRMAccountConfig>
```

For local dev, a `.env` file (gitignored) is used. In production, inject via the process environment or a secrets manager (AWS Secrets Manager, Vault, etc.).

Token refresh happens transparently: when `tokenExpiresAt - now < 300s`, the connector calls `POST /oauth2/access_token` with `grant_type=refresh_token` before the next API call.

### 3.4 API Endpoints Used

| Resource             | Kommo/Amo Endpoint              | Method   |
|----------------------|--------------------------------|----------|
| Leads list           | `/api/v4/leads`                | GET      |
| Lead detail          | `/api/v4/leads/{id}`           | GET      |
| Contacts list        | `/api/v4/contacts`             | GET      |
| Contact detail       | `/api/v4/contacts/{id}`        | GET      |
| Companies            | `/api/v4/companies`            | GET      |
| Pipelines            | `/api/v4/leads/pipelines`      | GET      |
| Pipeline stages      | `/api/v4/leads/pipelines/{id}/statuses` | GET |
| Users (agents)       | `/api/v4/users`                | GET      |
| Custom fields        | `/api/v4/leads/custom_fields`  | GET      |
| Events (changelog)   | `/api/v4/events`               | GET      |
| Tasks                | `/api/v4/tasks`                | GET      |
| Token refresh        | `/oauth2/access_token`         | POST     |

All list endpoints support `page`, `limit` (max 250), `filter[*]`, and `order[*]` query parameters.

---

## 4. Unified Data Models

### 4.1 Lead

```typescript
interface UnifiedLead {
  id: string;                    // "<accountId>_<crmLeadId>"
  sourceAccountId: string;
  sourceLeadId: string;
  name: string;
  status: "open" | "won" | "lost" | "deleted";
  pipelineId: string;
  stageId: string;
  stageName: string;
  stageOrder: number;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  contactIds: string[];
  companyId: string | null;

  // Real estate specific (from custom fields)
  propertyType: string | null;   // "apartment" | "house" | "commercial" | "land"
  propertyAddress: string | null;
  dealSide: "buy" | "sell" | "rent" | null;
  areaM2: number | null;
  floorNumber: number | null;
  totalFloors: number | null;
  objectCondition: string | null;

  value: number;                 // Deal value in base currency
  currency: string;              // ISO 4217
  createdAt: string;             // ISO 8601
  updatedAt: string;
  closedAt: string | null;
  expectedCloseDate: string | null;
  lossReasonId: string | null;
  lossReasonName: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
}
```

### 4.2 Contact

```typescript
interface UnifiedContact {
  id: string;
  sourceAccountId: string;
  sourceContactId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string[];
  phone: string[];
  companyId: string | null;
  companyName: string | null;
  responsibleUserId: string | null;
  leadIds: string[];
  createdAt: string;
  updatedAt: string;
  customFields: Record<string, unknown>;
}
```

### 4.3 Pipeline

```typescript
interface UnifiedPipeline {
  id: string;
  sourceAccountId: string;
  sourcePipelineId: string;
  name: string;
  isArchived: boolean;
  stages: UnifiedStage[];
}

interface UnifiedStage {
  id: string;
  sourcePipelineId: string;
  sourceStageId: string;
  name: string;
  order: number;
  color: string;
  isSuccessStage: boolean;  // "won"
  isFailureStage: boolean;  // "lost"
}
```

### 4.4 SalesAgent

```typescript
interface SalesAgent {
  id: string;
  sourceAccountId: string;
  sourceUserId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}
```

### 4.5 DealEvent (stage transitions)

```typescript
interface DealEvent {
  leadId: string;
  sourceAccountId: string;
  eventType: "stage_changed" | "responsible_changed" | "value_changed" | "closed";
  fromStageId: string | null;
  toStageId: string | null;
  userId: string;
  createdAt: string;
}
```

### 4.6 Analytics Models

```typescript
interface PipelineVelocityMetric {
  pipelineId: string;
  pipelineName: string;
  accountId: string;
  periodDays: number;
  avgDaysInStage: Record<string, number>;  // stageId → avg days
  avgDealCycledays: number;
  leadsEntered: number;
  leadsExited: number;
  dealsWon: number;
  dealsLost: number;
  conversionRate: number;                  // won / (won + lost)
}

interface ConversionRateByStage {
  stageId: string;
  stageName: string;
  stageOrder: number;
  leadsEntered: number;
  leadsAdvanced: number;
  leadsDropped: number;
  conversionRate: number;
  dropRate: number;
  avgTimeInStageHours: number;
}

interface DealValueDistribution {
  buckets: Array<{
    label: string;    // e.g. "0–5M", "5–10M"
    min: number;
    max: number;
    count: number;
    totalValue: number;
    avgValue: number;
  }>;
  currency: string;
  totalDeals: number;
  totalValue: number;
  medianValue: number;
  p25Value: number;
  p75Value: number;
}

interface AgentPerformanceMetric {
  agentId: string;
  agentName: string;
  accountId: string;
  periodDays: number;
  leadsAssigned: number;
  dealsWon: number;
  dealsLost: number;
  conversionRate: number;
  totalRevenue: number;
  avgDealValue: number;
  avgCycleDays: number;
  activePipelineValue: number;
  activePipelineCount: number;
}
```

---

## 5. ETL Layer

### 5.1 Extraction

The extractor pulls data page-by-page from each connected account using cursor-based pagination (`page` + `limit=250`). A full sync fetches all resources; incremental sync uses `filter[updated_at][from]` with the last-sync timestamp stored per account.

```
Extractor.syncAccount(accountId, mode: "full" | "incremental")
  → fetches: leads, contacts, companies, pipelines, users, events
  → emits raw records into the TransformQueue
```

### 5.2 Transformation

The transformer maps CRM-specific field names and custom field IDs to the unified schema:

| CRM field              | Unified field          | Notes                              |
|------------------------|------------------------|------------------------------------|
| `lead.name`            | `lead.name`            | Direct                             |
| `lead.status_id`       | `lead.stageId`         | Resolved against pipeline statuses |
| `lead.price`           | `lead.value`           | Integer (kopecks or cents)         |
| `lead.responsible_user_id` | `lead.responsibleUserId` | Joined with users list        |
| Custom field `cf_XXX`  | Real estate fields     | Mapped via `fieldMappings` config  |
| `lead.closed_at`       | `lead.closedAt`        | Unix → ISO 8601                    |
| `lead.loss_reason_id`  | `lead.lossReasonId`    | Optional                           |

**Field mapping config** (per account, in `KOMMO_ACCOUNTS` / `AMO_ACCOUNTS` JSON):

```json
{
  "fieldMappings": {
    "propertyType": "cf_12345",
    "propertyAddress": "cf_12346",
    "dealSide": "cf_12347",
    "areaM2": "cf_12348"
  }
}
```

### 5.3 Aggregation & Caching

Transformed records are held in an in-memory `DataStore` (a simple Map keyed by entity type + id). Analytics queries run over the store in real-time. The store is invalidated and rebuilt on a configurable TTL (default 15 minutes) or on explicit `sync_data` tool call.

---

## 6. MCP Server Tool Endpoints

### 6.1 Account Management

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_accounts` | — | `AccountSummary[]` |
| `get_account_status` | `accountId: string` | `AccountStatus` (last sync, record counts) |
| `sync_data` | `accountId?: string, mode?: "full"\|"incremental"` | `SyncResult` |

### 6.2 Data Query Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `get_leads` | `accountId?, pipelineId?, stageId?, responsibleUserId?, status?, createdFrom?, createdTo?, search?, page?, limit?` | `{ leads: UnifiedLead[], total: number }` |
| `get_lead` | `id: string` | `UnifiedLead` |
| `get_contacts` | `accountId?, search?, page?, limit?` | `{ contacts: UnifiedContact[], total: number }` |
| `get_contact` | `id: string` | `UnifiedContact` |
| `get_pipelines` | `accountId?` | `UnifiedPipeline[]` |
| `get_agents` | `accountId?` | `SalesAgent[]` |
| `get_deal_events` | `leadId: string` | `DealEvent[]` |

### 6.3 Analytics Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `get_pipeline_velocity` | `accountId?, pipelineId?, periodDays? (default 30)` | `PipelineVelocityMetric[]` |
| `get_conversion_funnel` | `accountId?, pipelineId?, periodDays?` | `ConversionRateByStage[]` |
| `get_deal_value_distribution` | `accountId?, pipelineId?, bucketCount? (default 10)` | `DealValueDistribution` |
| `get_team_performance` | `accountId?, periodDays?, pipelineId?` | `AgentPerformanceMetric[]` |
| `get_dashboard_summary` | `accountId?, periodDays?` | Full dashboard snapshot |

### 6.4 Export Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `export_leads` | `format: "csv"\|"json", filters: GetLeadsArgs` | `{ data: string, filename: string }` |
| `export_analytics_report` | `format: "csv"\|"json", type: "velocity"\|"funnel"\|"team"\|"distribution", ...args` | `{ data: string, filename: string }` |

---

## 7. Dashboard Templates

### 7.1 Pipeline Velocity Dashboard

```
Period: [Last 30d ▼]   Account: [All ▼]   Pipeline: [All ▼]

┌─────────────────────────┬────────────────────────────────────────────────┐
│  VELOCITY OVERVIEW       │  AVG DAYS PER STAGE                           │
│                          │                                                │
│  Avg Cycle Time:  42d    │  New Lead        ████░░░░  3.2d               │
│  Leads Won:       87     │  Viewing         ██████░░  6.8d               │
│  Leads Lost:      34     │  Offer           ████████  8.1d               │
│  Conversion:      71.9%  │  Due Diligence   ██████████████  14.3d        │
│                          │  Contract        █████  5.5d                  │
│  Pipeline Value:         │  Closed          -                            │
│  ₽ 284,500,000           │                                                │
└─────────────────────────┴────────────────────────────────────────────────┘
```

### 7.2 Conversion Funnel

```
 New Lead    Viewing    Offer    Due Diligence    Contract    Won
   100%  →   68%   →  54%   →     41%        →   38%    →  35%
  (310)    (211)    (167)         (127)           (118)    (108)
```

### 7.3 Deal Value Distribution

```
Deal Value Distribution (₽)
Count
 60 │    ██
 50 │   ████
 40 │  ██████ ██
 30 │  ████████████
 20 │ ████████████████ ██
 10 │ ████████████████████████ ██  ██
    └─────────────────────────────────────
      0-2M  2-5M  5-10M  10-20M  20-50M  50M+
```

### 7.4 Team Performance Table

```
Agent              Assigned  Won   Lost  Rate    Revenue (₽)    Avg Cycle
─────────────────────────────────────────────────────────────────────────
Ivanova E.         45        32    8     80.0%   96,000,000     38d
Petrov A.          38        24    10    70.6%   72,000,000     45d
Sidorova M.        52        31    15    67.4%   93,000,000     42d
Kozlov D.          29        14    9     60.9%   42,000,000     58d
─────────────────────────────────────────────────────────────────────────
TOTAL              164       101   42    70.6%   303,000,000    45d avg
```

---

## 8. Integration Gaps & Standardisation Challenges

### 8.1 Custom Field Mapping (HIGH PRIORITY)

**Problem:** Real estate fields (property type, address, area, deal side) are stored as custom fields with numeric IDs that differ per account. There is no cross-account convention.

**Mitigation:** Require `fieldMappings` in each account config at connection time. Provide a `discover_custom_fields` tool to list all custom fields with their IDs, allowing administrators to map them before first sync.

### 8.2 Currency Normalisation (MEDIUM)

**Problem:** AmoCRM stores price as integer kopecks; Kommo (international) can use various currencies with float values. Mixing accounts means mixing currencies.

**Mitigation:** Store raw value + currency per lead. Analytics tools accept an optional `targetCurrency` and a static exchange rate table (`EXCHANGE_RATES` env var) for cross-account aggregation. Flag mixed-currency aggregations in responses.

### 8.3 Pipeline Structure Divergence (MEDIUM)

**Problem:** Different accounts (and CRM variants) may have different pipeline names and stage counts. Funnel analysis is meaningless if stages don't map to a shared concept.

**Mitigation:** Introduce an optional `stageAliases` config block per account that maps local stage IDs to canonical stage names (`new_lead`, `viewing`, `offer`, `due_diligence`, `contract`, `won`, `lost`). Cross-account funnel reports use the canonical names.

### 8.4 Rate Limiting (MEDIUM)

**Problem:** Both APIs enforce rate limits (≈ 7 req/s per token). Parallel sync of many accounts may hit limits.

**Mitigation:** Per-account request queues with a configurable rate limiter (default 5 req/s, configurable via `RATE_LIMIT_RPS` env var). Exponential back-off on 429 responses.

### 8.5 Event History Depth (LOW)

**Problem:** The `/api/v4/events` endpoint only returns events for the last 6 months. Long sales cycles may have older stage transitions unavailable.

**Mitigation:** On first full sync, compute a synthetic event log from current `lead.status_id` and `lead.created_at`. Mark derived events with `synthetic: true` so analytics can distinguish them.

### 8.6 AmoCRM vs Kommo API Parity (LOW)

Both APIs are currently identical at v4. However, Kommo continues to diverge with new features (AI scoring, property modules) not yet back-ported to AmoCRM. Document version-gating behind feature flags in the connector config.

---

## 9. Implementation Roadmap

| Phase | Scope | Duration |
|-------|-------|----------|
| **P1 — Foundation** | Repo scaffold, CRM connectors, OAuth token refresh, raw data extraction | Week 1 |
| **P2 — ETL** | Transformer, unified schema, in-memory store, incremental sync | Week 2 |
| **P3 — Analytics** | Velocity, funnel, distribution, team performance calculations | Week 3 |
| **P4 — MCP Tools** | All 15+ MCP tool implementations, input validation, error handling | Week 4 |
| **P5 — Export** | CSV/JSON export, dashboard summary tool | Week 5 |
| **P6 — Hardening** | Rate limiting, retry logic, credential rotation, tests, CI | Week 6 |

---

## 10. Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `KOMMO_ACCOUNTS` | No | Base64 JSON array of Kommo account configs |
| `AMO_ACCOUNTS` | No | Base64 JSON array of AmoCRM account configs |
| `EXCHANGE_RATES` | No | JSON object `{"USD":90.5,"EUR":98.2}` (RUB base) |
| `CACHE_TTL_SECONDS` | No | In-memory cache TTL (default: 900) |
| `RATE_LIMIT_RPS` | No | API requests per second per account (default: 5) |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` (default: info) |
