import { CRMAccountConfig, FieldMappings } from "../config/accounts.js";
import {
  RawLead,
  RawContact,
  RawPipeline,
  RawUser,
  RawEvent,
  RawCustomField,
} from "../crm/base.js";
import {
  UnifiedLead,
  UnifiedContact,
  UnifiedPipeline,
  UnifiedStage,
  SalesAgent,
  DealEvent,
  DealEventType,
  LeadStatus,
  PropertyType,
  DealSide,
} from "../models/unified.js";

type StageMap = Map<number, UnifiedStage & { pipelineId: string }>;
type UserMap = Map<number, SalesAgent>;
type LeadStatusMap = Map<number, LeadStatus>; // statusId → "open"|"won"|"lost"

function unixToIso(ts: number | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts * 1000).toISOString();
}

function pickCustomFieldValue(
  fields: RawCustomField[] | null,
  fieldId: string | undefined
): string | null {
  if (!fieldId || !fields) return null;
  const id = Number(fieldId.replace(/^cf_/, ""));
  const field = fields.find((f) => f.field_id === id);
  return field?.values[0]?.value != null ? String(field.values[0].value) : null;
}

function resolvePropertyType(raw: string | null): PropertyType | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("apart") || v.includes("квартир")) return "apartment";
  if (v.includes("house") || v.includes("дом")) return "house";
  if (v.includes("comm") || v.includes("коммерч")) return "commercial";
  if (v.includes("land") || v.includes("участ")) return "land";
  return "other";
}

function resolveDealSide(raw: string | null): DealSide | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("buy") || v.includes("покупка")) return "buy";
  if (v.includes("sell") || v.includes("продажа")) return "sell";
  if (v.includes("rent") || v.includes("аренда")) return "rent";
  return null;
}

// ── Public transform functions ────────────────────────────────────────────

export function transformPipelines(
  account: CRMAccountConfig,
  raws: RawPipeline[]
): { pipelines: UnifiedPipeline[]; stageMap: StageMap; statusKind: LeadStatusMap } {
  const pipelines: UnifiedPipeline[] = [];
  const stageMap: StageMap = new Map();
  const statusKind: LeadStatusMap = new Map();

  for (const rp of raws) {
    const stages: UnifiedStage[] = (rp._embedded?.statuses ?? []).map((rs) => {
      const isSuccess = rs.type === 142;
      const isFailure = rs.type === 143;
      const alias = account.stageAliases?.[String(rs.id)] ?? null;
      const stage: UnifiedStage & { pipelineId: string } = {
        id: `${account.id}_${rs.id}`,
        sourcePipelineId: String(rp.id),
        sourceStageId: String(rs.id),
        name: rs.name,
        order: rs.sort,
        color: rs.color,
        isSuccessStage: isSuccess,
        isFailureStage: isFailure,
        pipelineId: `${account.id}_${rp.id}`,
      };
      stageMap.set(rs.id, stage);
      statusKind.set(rs.id, isSuccess ? "won" : isFailure ? "lost" : "open");
      return stage;
    });

    pipelines.push({
      id: `${account.id}_${rp.id}`,
      sourceAccountId: account.id,
      sourcePipelineId: String(rp.id),
      name: rp.name,
      isArchived: rp.is_archive,
      stages,
    });
  }

  return { pipelines, stageMap, statusKind };
}

export function transformUsers(account: CRMAccountConfig, raws: RawUser[]): { agents: SalesAgent[]; userMap: UserMap } {
  const agents: SalesAgent[] = [];
  const userMap: UserMap = new Map();

  for (const ru of raws) {
    const agent: SalesAgent = {
      id: `${account.id}_${ru.id}`,
      sourceAccountId: account.id,
      sourceUserId: String(ru.id),
      name: ru.name,
      email: ru.email,
      role: ru.role?.name ?? "agent",
      isActive: ru.rights?.is_active ?? true,
    };
    agents.push(agent);
    userMap.set(ru.id, agent);
  }

  return { agents, userMap };
}

export function transformLeads(
  account: CRMAccountConfig,
  raws: RawLead[],
  stageMap: StageMap,
  statusKind: LeadStatusMap,
  userMap: UserMap
): UnifiedLead[] {
  const fm: FieldMappings = account.fieldMappings ?? {};

  return raws.map((rl) => {
    const stage = stageMap.get(rl.status_id);
    const agent = userMap.get(rl.responsible_user_id) ?? null;
    const cf = rl.custom_fields_values;

    const rawPropertyType = pickCustomFieldValue(cf, fm.propertyType);
    const rawDealSide = pickCustomFieldValue(cf, fm.dealSide);
    const rawArea = pickCustomFieldValue(cf, fm.areaM2);
    const rawFloor = pickCustomFieldValue(cf, fm.floorNumber);
    const rawTotalFloors = pickCustomFieldValue(cf, fm.totalFloors);

    return {
      id: `${account.id}_${rl.id}`,
      sourceAccountId: account.id,
      sourceLeadId: String(rl.id),
      name: rl.name,
      status: statusKind.get(rl.status_id) ?? "open",
      pipelineId: `${account.id}_${rl.pipeline_id}`,
      stageId: stage?.id ?? `${account.id}_${rl.status_id}`,
      stageName: stage?.name ?? String(rl.status_id),
      stageOrder: stage?.order ?? 0,
      stageAlias: stage ? (account.stageAliases?.[stage.sourceStageId] ?? null) : null,
      responsibleUserId: agent?.id ?? null,
      responsibleUserName: agent?.name ?? null,
      contactIds: (rl._embedded?.contacts ?? []).map((c) => `${account.id}_${c.id}`),
      companyId: rl._embedded?.companies?.[0] ? `${account.id}_${rl._embedded.companies[0].id}` : null,

      propertyType: resolvePropertyType(rawPropertyType),
      propertyAddress: pickCustomFieldValue(cf, fm.propertyAddress),
      dealSide: resolveDealSide(rawDealSide),
      areaM2: rawArea ? Number(rawArea) : null,
      floorNumber: rawFloor ? Number(rawFloor) : null,
      totalFloors: rawTotalFloors ? Number(rawTotalFloors) : null,
      objectCondition: pickCustomFieldValue(cf, fm.objectCondition),

      value: rl.price,
      currency: account.currency,
      createdAt: unixToIso(rl.created_at) ?? new Date(0).toISOString(),
      updatedAt: unixToIso(rl.updated_at) ?? new Date(0).toISOString(),
      closedAt: unixToIso(rl.closed_at),
      expectedCloseDate: null,
      lossReasonId: rl.loss_reason_id ? String(rl.loss_reason_id) : null,
      lossReasonName: null,
      tags: (rl._embedded?.tags ?? []).map((t) => t.name),
      customFields: Object.fromEntries(
        (cf ?? []).map((f) => [String(f.field_id), f.values[0]?.value])
      ),
    };
  });
}

export function transformContacts(
  account: CRMAccountConfig,
  raws: RawContact[],
  userMap: UserMap
): UnifiedContact[] {
  return raws.map((rc) => {
    const nameParts = rc.name?.split(" ") ?? [];
    const firstName = rc.first_name || nameParts[0] || "";
    const lastName = rc.last_name || nameParts.slice(1).join(" ") || "";

    const cf = rc.custom_fields_values ?? [];
    const emails = cf
      .filter((f) => f.field_code === "EMAIL")
      .flatMap((f) => f.values.map((v) => String(v.value)));
    const phones = cf
      .filter((f) => f.field_code === "PHONE")
      .flatMap((f) => f.values.map((v) => String(v.value)));

    return {
      id: `${account.id}_${rc.id}`,
      sourceAccountId: account.id,
      sourceContactId: String(rc.id),
      firstName,
      lastName,
      fullName: rc.name,
      email: emails,
      phone: phones,
      companyId: rc._embedded?.companies?.[0] ? `${account.id}_${rc._embedded.companies[0].id}` : null,
      companyName: null,
      responsibleUserId: userMap.get(rc.responsible_user_id)?.id ?? null,
      leadIds: (rc._embedded?.leads ?? []).map((l) => `${account.id}_${l.id}`),
      createdAt: unixToIso(rc.created_at) ?? new Date(0).toISOString(),
      updatedAt: unixToIso(rc.updated_at) ?? new Date(0).toISOString(),
      customFields: Object.fromEntries(
        cf.map((f) => [String(f.field_id), f.values[0]?.value])
      ),
    };
  });
}

export function transformEvents(account: CRMAccountConfig, raws: RawEvent[]): DealEvent[] {
  const events: DealEvent[] = [];

  for (const re of raws) {
    if (re.entity_type !== "leads") continue;

    let eventType: DealEventType | null = null;
    let fromStageId: string | null = null;
    let toStageId: string | null = null;
    let fromValue: number | null = null;
    let toValue: number | null = null;

    if (re.type === "lead_status_changed") {
      eventType = "stage_changed";
      fromStageId = re.value_before?.[0]?.lead_status
        ? `${account.id}_${re.value_before[0].lead_status.id}`
        : null;
      toStageId = re.value_after?.[0]?.lead_status
        ? `${account.id}_${re.value_after[0].lead_status.id}`
        : null;
    } else if (re.type === "lead_price_changed") {
      eventType = "value_changed";
      fromValue = re.value_before?.[0]?.price?.value ?? null;
      toValue = re.value_after?.[0]?.price?.value ?? null;
    } else if (re.type === "lead_responsible_user_changed") {
      eventType = "responsible_changed";
    }

    if (!eventType) continue;

    events.push({
      id: re.id,
      leadId: `${account.id}_${re.entity_id}`,
      sourceAccountId: account.id,
      eventType,
      fromStageId,
      toStageId,
      fromValue,
      toValue,
      userId: `${account.id}_${re.created_by}`,
      createdAt: unixToIso(re.created_at) ?? new Date(0).toISOString(),
      synthetic: false,
    });
  }

  return events;
}

/** Synthesise a "created" event for leads that predate the event horizon (6 months). */
export function synthesiseCreatedEvents(
  account: CRMAccountConfig,
  leads: UnifiedLead[]
): DealEvent[] {
  return leads.map((lead) => ({
    id: `synthetic_created_${lead.id}`,
    leadId: lead.id,
    sourceAccountId: account.id,
    eventType: "created" as DealEventType,
    fromStageId: null,
    toStageId: lead.stageId,
    fromValue: null,
    toValue: lead.value,
    userId: lead.responsibleUserId ?? `${account.id}_system`,
    createdAt: lead.createdAt,
    synthetic: true,
  }));
}
