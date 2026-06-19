import { UnifiedLead, AgentPerformanceMetric, ConversionRateByStage, PipelineVelocityMetric } from "../models/unified.js";

// ── CSV helpers ───────────────────────────────────────────────────────────

function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values
    .map((v) => {
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

// ── Lead export ───────────────────────────────────────────────────────────

const LEAD_HEADERS = [
  "id", "name", "status", "pipeline_id", "stage_name", "stage_alias",
  "responsible_user", "property_type", "property_address", "deal_side",
  "area_m2", "value", "currency", "created_at", "closed_at", "tags",
];

export function leadsToCSV(leads: UnifiedLead[]): string {
  const rows = [csvRow(LEAD_HEADERS)];
  for (const l of leads) {
    rows.push(
      csvRow([
        l.id, l.name, l.status, l.pipelineId, l.stageName, l.stageAlias,
        l.responsibleUserName, l.propertyType, l.propertyAddress, l.dealSide,
        l.areaM2, l.value, l.currency, l.createdAt, l.closedAt, l.tags.join(";"),
      ])
    );
  }
  return rows.join("\n");
}

export function leadsToJSON(leads: UnifiedLead[]): string {
  return JSON.stringify(leads, null, 2);
}

// ── Analytics export ──────────────────────────────────────────────────────

export function velocityToCSV(metrics: PipelineVelocityMetric[]): string {
  const headers = [
    "pipeline_id", "pipeline_name", "account_id", "period_days",
    "avg_cycle_days", "leads_entered", "leads_won", "leads_lost",
    "conversion_rate", "total_pipeline_value", "currency",
  ];
  const rows = [csvRow(headers)];
  for (const m of metrics) {
    rows.push(
      csvRow([
        m.pipelineId, m.pipelineName, m.accountId, m.periodDays,
        m.avgDealCycleDays.toFixed(1), m.leadsEntered, m.dealsWon, m.dealsLost,
        (m.conversionRate * 100).toFixed(1) + "%",
        m.totalPipelineValue, m.currency,
      ])
    );
  }
  return rows.join("\n");
}

export function funnelToCSV(stages: ConversionRateByStage[]): string {
  const headers = [
    "stage_id", "stage_name", "stage_order", "stage_alias",
    "leads_entered", "leads_advanced", "leads_dropped",
    "conversion_rate", "drop_rate", "avg_time_hours",
  ];
  const rows = [csvRow(headers)];
  for (const s of stages) {
    rows.push(
      csvRow([
        s.stageId, s.stageName, s.stageOrder, s.stageAlias,
        s.leadsEntered, s.leadsAdvanced, s.leadsDropped,
        (s.conversionRate * 100).toFixed(1) + "%",
        (s.dropRate * 100).toFixed(1) + "%",
        s.avgTimeInStageHours.toFixed(1),
      ])
    );
  }
  return rows.join("\n");
}

export function teamToCSV(agents: AgentPerformanceMetric[]): string {
  const headers = [
    "agent_id", "agent_name", "account_id", "period_days",
    "leads_assigned", "deals_won", "deals_lost", "conversion_rate",
    "total_revenue", "avg_deal_value", "avg_cycle_days",
    "active_pipeline_value", "active_pipeline_count",
  ];
  const rows = [csvRow(headers)];
  for (const a of agents) {
    rows.push(
      csvRow([
        a.agentId, a.agentName, a.accountId, a.periodDays,
        a.leadsAssigned, a.dealsWon, a.dealsLost,
        (a.conversionRate * 100).toFixed(1) + "%",
        a.totalRevenue, a.avgDealValue.toFixed(0),
        a.avgCycleDays.toFixed(1),
        a.activePipelineValue, a.activePipelineCount,
      ])
    );
  }
  return rows.join("\n");
}
