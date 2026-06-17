-- Multi-CRM Analytics Platform — PostgreSQL Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Accounts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_accounts (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  variant           TEXT NOT NULL CHECK (variant IN ('kommo', 'amo')),
  subdomain         TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  client_secret     TEXT NOT NULL,
  redirect_uri      TEXT NOT NULL,
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  token_expires_at  BIGINT NOT NULL,
  field_mappings    JSONB NOT NULL DEFAULT '{}',
  stage_aliases     JSONB NOT NULL DEFAULT '{}',
  currency          CHAR(3) NOT NULL DEFAULT 'RUB',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sync metadata ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_log (
  id              BIGSERIAL PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('full', 'incremental')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  leads_synced    INT,
  contacts_synced INT,
  events_synced   INT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS sync_log_account_id ON sync_log(account_id);

-- ── Pipelines ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipelines (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
  source_pipeline_id  TEXT NOT NULL,
  name                TEXT NOT NULL,
  is_archived         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, source_pipeline_id)
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id                  TEXT PRIMARY KEY,
  pipeline_id         TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  source_stage_id     TEXT NOT NULL,
  name                TEXT NOT NULL,
  stage_order         INT NOT NULL,
  color               TEXT,
  is_success_stage    BOOLEAN NOT NULL DEFAULT FALSE,
  is_failure_stage    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(pipeline_id, source_stage_id)
);

-- ── Agents ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
  source_user_id  TEXT NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT,
  role            TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(account_id, source_user_id)
);

-- ── Leads ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
  source_lead_id        TEXT NOT NULL,
  name                  TEXT,
  status                TEXT NOT NULL CHECK (status IN ('open', 'won', 'lost', 'deleted')),
  pipeline_id           TEXT REFERENCES pipelines(id),
  stage_id              TEXT REFERENCES pipeline_stages(id),
  stage_name            TEXT,
  stage_order           INT,
  stage_alias           TEXT,
  responsible_user_id   TEXT REFERENCES agents(id),
  responsible_user_name TEXT,
  company_id            TEXT,

  -- Real estate fields
  property_type         TEXT,
  property_address      TEXT,
  deal_side             TEXT CHECK (deal_side IN ('buy', 'sell', 'rent', NULL)),
  area_m2               NUMERIC,
  floor_number          INT,
  total_floors          INT,
  object_condition      TEXT,

  value                 BIGINT NOT NULL DEFAULT 0,
  currency              CHAR(3) NOT NULL DEFAULT 'RUB',
  created_at            TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL,
  closed_at             TIMESTAMPTZ,
  expected_close_date   TIMESTAMPTZ,
  loss_reason_id        TEXT,
  loss_reason_name      TEXT,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  custom_fields         JSONB NOT NULL DEFAULT '{}',

  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, source_lead_id)
);

CREATE INDEX IF NOT EXISTS leads_account_id         ON leads(account_id);
CREATE INDEX IF NOT EXISTS leads_pipeline_id        ON leads(pipeline_id);
CREATE INDEX IF NOT EXISTS leads_status             ON leads(status);
CREATE INDEX IF NOT EXISTS leads_created_at         ON leads(created_at);
CREATE INDEX IF NOT EXISTS leads_responsible_user   ON leads(responsible_user_id);
CREATE INDEX IF NOT EXISTS leads_stage_alias        ON leads(stage_alias);

-- ── Contacts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
  source_contact_id TEXT NOT NULL,
  first_name        TEXT,
  last_name         TEXT,
  full_name         TEXT,
  email             TEXT[],
  phone             TEXT[],
  company_id        TEXT,
  company_name      TEXT,
  responsible_user_id TEXT REFERENCES agents(id),
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,
  custom_fields     JSONB NOT NULL DEFAULT '{}',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, source_contact_id)
);

CREATE INDEX IF NOT EXISTS contacts_account_id ON contacts(account_id);

-- ── Deal events ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deal_events (
  id              TEXT PRIMARY KEY,
  lead_id         TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  account_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  from_stage_id   TEXT,
  to_stage_id     TEXT,
  from_value      BIGINT,
  to_value        BIGINT,
  user_id         TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  synthetic       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS deal_events_lead_id    ON deal_events(lead_id);
CREATE INDEX IF NOT EXISTS deal_events_account_id ON deal_events(account_id);
CREATE INDEX IF NOT EXISTS deal_events_created_at ON deal_events(created_at);

-- ── Dashboard users (auth) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dashboard_users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- ── Pre-aggregated analytics cache ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_cache (
  cache_key   TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_cache_expires ON analytics_cache(expires_at);
