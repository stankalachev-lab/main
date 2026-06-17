import { PoolClient } from "pg";
import { withTransaction, query, queryOne } from "./client.js";
import {
  UnifiedLead, UnifiedContact, UnifiedPipeline,
  SalesAgent, DealEvent,
} from "../models/unified.js";

// ── Upsert helpers ────────────────────────────────────────────────────────

export async function upsertPipelines(pipelines: UnifiedPipeline[]): Promise<void> {
  await withTransaction(async (client) => {
    for (const p of pipelines) {
      await client.query(
        `INSERT INTO pipelines (id, account_id, source_pipeline_id, name, is_archived, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (id) DO UPDATE SET name=$4, is_archived=$5, updated_at=NOW()`,
        [p.id, p.sourceAccountId, p.sourcePipelineId, p.name, p.isArchived]
      );
      for (const s of p.stages) {
        await client.query(
          `INSERT INTO pipeline_stages (id, pipeline_id, source_stage_id, name, stage_order, color, is_success_stage, is_failure_stage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET name=$4, stage_order=$5, color=$6, is_success_stage=$7, is_failure_stage=$8`,
          [s.id, p.id, s.sourceStageId, s.name, s.order, s.color, s.isSuccessStage, s.isFailureStage]
        );
      }
    }
  });
}

export async function upsertAgents(agents: SalesAgent[]): Promise<void> {
  if (agents.length === 0) return;
  await withTransaction(async (client) => {
    for (const a of agents) {
      await client.query(
        `INSERT INTO agents (id, account_id, source_user_id, name, email, role, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name=$4, email=$5, role=$6, is_active=$7`,
        [a.id, a.sourceAccountId, a.sourceUserId, a.name, a.email, a.role, a.isActive]
      );
    }
  });
}

export async function upsertLeads(leads: UnifiedLead[]): Promise<void> {
  if (leads.length === 0) return;
  await withTransaction(async (client: PoolClient) => {
    for (const l of leads) {
      await client.query(
        `INSERT INTO leads (
          id, account_id, source_lead_id, name, status,
          pipeline_id, stage_id, stage_name, stage_order, stage_alias,
          responsible_user_id, responsible_user_name, company_id,
          property_type, property_address, deal_side, area_m2,
          floor_number, total_floors, object_condition,
          value, currency, created_at, updated_at, closed_at,
          expected_close_date, loss_reason_id, loss_reason_name,
          tags, custom_fields, synced_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name=$4, status=$5, pipeline_id=$6, stage_id=$7, stage_name=$8,
          stage_order=$9, stage_alias=$10, responsible_user_id=$11,
          responsible_user_name=$12, company_id=$13, property_type=$14,
          property_address=$15, deal_side=$16, area_m2=$17, floor_number=$18,
          total_floors=$19, object_condition=$20, value=$21, currency=$22,
          updated_at=$24, closed_at=$25, expected_close_date=$26,
          loss_reason_id=$27, loss_reason_name=$28, tags=$29,
          custom_fields=$30, synced_at=NOW()`,
        [
          l.id, l.sourceAccountId, l.sourceLeadId, l.name, l.status,
          l.pipelineId, l.stageId, l.stageName, l.stageOrder, l.stageAlias,
          l.responsibleUserId, l.responsibleUserName, l.companyId,
          l.propertyType, l.propertyAddress, l.dealSide, l.areaM2,
          l.floorNumber, l.totalFloors, l.objectCondition,
          l.value, l.currency, l.createdAt, l.updatedAt, l.closedAt,
          l.expectedCloseDate, l.lossReasonId, l.lossReasonName,
          l.tags, JSON.stringify(l.customFields),
        ]
      );
    }
  });
}

export async function upsertContacts(contacts: UnifiedContact[]): Promise<void> {
  if (contacts.length === 0) return;
  await withTransaction(async (client) => {
    for (const c of contacts) {
      await client.query(
        `INSERT INTO contacts (
          id, account_id, source_contact_id, first_name, last_name, full_name,
          email, phone, company_id, company_name, responsible_user_id,
          created_at, updated_at, custom_fields, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         ON CONFLICT (id) DO UPDATE SET
           first_name=$4, last_name=$5, full_name=$6, email=$7, phone=$8,
           company_id=$9, company_name=$10, responsible_user_id=$11,
           updated_at=$13, custom_fields=$14, synced_at=NOW()`,
        [
          c.id, c.sourceAccountId, c.sourceContactId,
          c.firstName, c.lastName, c.fullName,
          c.email, c.phone, c.companyId, c.companyName, c.responsibleUserId,
          c.createdAt, c.updatedAt, JSON.stringify(c.customFields),
        ]
      );
    }
  });
}

export async function upsertEvents(events: DealEvent[]): Promise<void> {
  if (events.length === 0) return;
  await withTransaction(async (client) => {
    for (const e of events) {
      await client.query(
        `INSERT INTO deal_events (id, lead_id, account_id, event_type, from_stage_id, to_stage_id, from_value, to_value, user_id, created_at, synthetic)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.leadId, e.sourceAccountId, e.eventType, e.fromStageId, e.toStageId, e.fromValue, e.toValue, e.userId, e.createdAt, e.synthetic]
      );
    }
  });
}

// ── Query helpers ─────────────────────────────────────────────────────────

export async function getLastSyncTime(accountId: string): Promise<number | null> {
  const row = await queryOne<{ unix: string }>(
    `SELECT EXTRACT(EPOCH FROM finished_at)::BIGINT AS unix
     FROM sync_log WHERE account_id=$1 AND error IS NULL
     ORDER BY finished_at DESC LIMIT 1`,
    [accountId]
  );
  return row ? Number(row.unix) : null;
}

export async function recordSyncStart(accountId: string, mode: string): Promise<number> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sync_log (account_id, mode) VALUES ($1,$2) RETURNING id`,
    [accountId, mode]
  );
  return Number(row!.id);
}

export async function recordSyncFinish(
  syncId: number,
  counts: { leads: number; contacts: number; events: number },
  error?: string
): Promise<void> {
  await query(
    `UPDATE sync_log SET finished_at=NOW(), leads_synced=$2, contacts_synced=$3, events_synced=$4, error=$5
     WHERE id=$1`,
    [syncId, counts.leads, counts.contacts, counts.events, error ?? null]
  );
}
