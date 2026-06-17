import { DataStore, LeadFilters } from "../etl/store.js";
import {
  PipelineVelocityMetric,
  ConversionRateByStage,
  DealValueDistribution,
  AgentPerformanceMetric,
  DashboardSummary,
  UnifiedPipeline,
} from "../models/unified.js";
import {
  periodStart,
  daysBetween,
  avg,
  percentile,
  avgDaysPerStage,
} from "./metrics.js";

// ── Pipeline Velocity ────────────────────────────────────────────────────

export function computePipelineVelocity(
  store: DataStore,
  opts: { accountId?: string; pipelineId?: string; periodDays?: number }
): PipelineVelocityMetric[] {
  const days = opts.periodDays ?? 30;
  const since = periodStart(days);

  const pipelines = store.getPipelines(opts.accountId).filter(
    (p) => !p.isArchived && (!opts.pipelineId || p.id === opts.pipelineId)
  );

  return pipelines.map((pipeline) => {
    const filters: LeadFilters = {
      accountId: opts.accountId,
      pipelineId: pipeline.id,
    };
    const allLeads = store.getLeads(filters);
    const events = store.getEvents(opts.accountId);

    const recentLeads = allLeads.filter((l) => l.createdAt >= since);
    const wonLeads = recentLeads.filter((l) => l.status === "won");
    const lostLeads = recentLeads.filter((l) => l.status === "lost");
    const openLeads = allLeads.filter((l) => l.status === "open");

    const cycleTimeDays = wonLeads
      .map((l) => (l.closedAt ? daysBetween(l.createdAt, l.closedAt) : null))
      .filter((d): d is number => d !== null && d >= 0);

    const stageTimings = avgDaysPerStage(recentLeads, events);
    const totalPipelineValue = openLeads.reduce((s, l) => s + l.value, 0);
    const won = wonLeads.length;
    const lost = lostLeads.length;
    const conversionRate = won + lost > 0 ? won / (won + lost) : 0;

    return {
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      accountId: pipeline.sourceAccountId,
      periodDays: days,
      avgDaysInStage: stageTimings,
      avgDealCycleDays: avg(cycleTimeDays),
      leadsEntered: recentLeads.length,
      leadsExited: won + lost,
      dealsWon: won,
      dealsLost: lost,
      conversionRate,
      totalPipelineValue,
      currency: allLeads[0]?.currency ?? "RUB",
    };
  });
}

// ── Conversion Funnel ────────────────────────────────────────────────────

export function computeConversionFunnel(
  store: DataStore,
  opts: { accountId?: string; pipelineId?: string; periodDays?: number }
): ConversionRateByStage[] {
  const days = opts.periodDays ?? 30;
  const since = periodStart(days);

  const pipelines = store.getPipelines(opts.accountId).filter(
    (p) => !p.isArchived && (!opts.pipelineId || p.id === opts.pipelineId)
  );

  if (pipelines.length === 0) return [];

  // Aggregate stages across pipelines (merge by stageAlias if available)
  const stageData = new Map<
    string,
    { stage: UnifiedPipeline["stages"][number]; leadIds: Set<string>; advancedIds: Set<string> }
  >();

  for (const pipeline of pipelines) {
    const leads = store
      .getLeads({ accountId: opts.accountId, pipelineId: pipeline.id })
      .filter((l) => l.createdAt >= since);

    for (const stage of pipeline.stages.sort((a, b) => a.order - b.order)) {
      if (!stageData.has(stage.id)) {
        stageData.set(stage.id, { stage, leadIds: new Set(), advancedIds: new Set() });
      }
      const entry = stageData.get(stage.id)!;
      const atStage = leads.filter((l) => l.stageId === stage.id || l.stageOrder >= stage.order);
      atStage.forEach((l) => entry.leadIds.add(l.id));
      const advanced = atStage.filter((l) => l.stageOrder > stage.order || l.status === "won");
      advanced.forEach((l) => entry.advancedIds.add(l.id));
    }
  }

  const events = store.getEvents(opts.accountId);

  return [...stageData.entries()]
    .sort(([, a], [, b]) => a.stage.order - b.stage.order)
    .map(([, { stage, leadIds, advancedIds }]) => {
      const entered = leadIds.size;
      const advanced = advancedIds.size;
      const dropped = entered - advanced;

      // Compute avg time in this stage from events
      const stageEvents = events.filter(
        (e) => e.eventType === "stage_changed" && e.fromStageId === stage.id
      );
      const hoursInStage = stageEvents
        .map((e) => {
          const enterEvent = events.find(
            (ev) => ev.eventType === "stage_changed" && ev.toStageId === stage.id && ev.leadId === e.leadId
          );
          if (!enterEvent) return null;
          const h = daysBetween(enterEvent.createdAt, e.createdAt) * 24;
          return h >= 0 ? h : null;
        })
        .filter((h): h is number => h !== null);

      return {
        stageId: stage.id,
        stageName: stage.name,
        stageOrder: stage.order,
        stageAlias: null,
        leadsEntered: entered,
        leadsAdvanced: advanced,
        leadsDropped: dropped,
        conversionRate: entered > 0 ? advanced / entered : 0,
        dropRate: entered > 0 ? dropped / entered : 0,
        avgTimeInStageHours: avg(hoursInStage),
      };
    });
}

// ── Deal Value Distribution ───────────────────────────────────────────────

export function computeDealValueDistribution(
  store: DataStore,
  opts: { accountId?: string; pipelineId?: string; bucketCount?: number }
): DealValueDistribution {
  const leads = store
    .getLeads({ accountId: opts.accountId, pipelineId: opts.pipelineId })
    .filter((l) => l.status === "won" && l.value > 0);

  if (leads.length === 0) {
    return {
      buckets: [],
      currency: "RUB",
      totalDeals: 0,
      totalValue: 0,
      medianValue: 0,
      p25Value: 0,
      p75Value: 0,
    };
  }

  const values = leads.map((l) => l.value).sort((a, b) => a - b);
  const n = opts.bucketCount ?? 10;
  const min = values[0];
  const max = values[values.length - 1];
  const step = (max - min) / n || 1;

  const buckets = Array.from({ length: n }, (_, i) => {
    const lo = min + i * step;
    const hi = i === n - 1 ? max + 1 : min + (i + 1) * step;
    const inBucket = values.filter((v) => v >= lo && v < hi);
    return {
      label: `${formatValue(lo)}–${formatValue(hi)}`,
      min: lo,
      max: hi,
      count: inBucket.length,
      totalValue: inBucket.reduce((s, v) => s + v, 0),
      avgValue: avg(inBucket),
    };
  });

  return {
    buckets,
    currency: leads[0]?.currency ?? "RUB",
    totalDeals: leads.length,
    totalValue: values.reduce((s, v) => s + v, 0),
    medianValue: percentile(values, 50),
    p25Value: percentile(values, 25),
    p75Value: percentile(values, 75),
  };
}

function formatValue(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

// ── Team Performance ─────────────────────────────────────────────────────

export function computeTeamPerformance(
  store: DataStore,
  opts: { accountId?: string; pipelineId?: string; periodDays?: number }
): AgentPerformanceMetric[] {
  const days = opts.periodDays ?? 30;
  const since = periodStart(days);

  const agents = store.getAgents(opts.accountId);
  const allLeads = store.getLeads({ accountId: opts.accountId, pipelineId: opts.pipelineId });

  return agents.map((agent) => {
    const assigned = allLeads.filter((l) => l.responsibleUserId === agent.id);
    const recent = assigned.filter((l) => l.createdAt >= since);
    const won = recent.filter((l) => l.status === "won");
    const lost = recent.filter((l) => l.status === "lost");
    const active = assigned.filter((l) => l.status === "open");

    const cycleDays = won
      .map((l) => (l.closedAt ? daysBetween(l.createdAt, l.closedAt) : null))
      .filter((d): d is number => d !== null && d >= 0);

    const totalRevenue = won.reduce((s, l) => s + l.value, 0);
    const wonCount = won.length;
    const lostCount = lost.length;

    return {
      agentId: agent.id,
      agentName: agent.name,
      accountId: agent.sourceAccountId,
      periodDays: days,
      leadsAssigned: recent.length,
      dealsWon: wonCount,
      dealsLost: lostCount,
      conversionRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
      totalRevenue,
      avgDealValue: won.length > 0 ? totalRevenue / won.length : 0,
      avgCycleDays: avg(cycleDays),
      activePipelineValue: active.reduce((s, l) => s + l.value, 0),
      activePipelineCount: active.length,
    };
  });
}

// ── Dashboard Summary ─────────────────────────────────────────────────────

export function computeDashboardSummary(
  store: DataStore,
  opts: { accountId?: string; periodDays?: number }
): DashboardSummary {
  const days = opts.periodDays ?? 30;
  const since = periodStart(days);

  const accounts = opts.accountId
    ? [opts.accountId]
    : [...new Set(store.getLeads().map((l) => l.sourceAccountId))];

  const allLeads = store.getLeads({ accountId: opts.accountId });
  const recent = allLeads.filter((l) => l.createdAt >= since);
  const won = recent.filter((l) => l.status === "won");
  const lost = recent.filter((l) => l.status === "lost");
  const open = allLeads.filter((l) => l.status === "open");

  const velocity = computePipelineVelocity(store, { accountId: opts.accountId, periodDays: days });
  const funnel = computeConversionFunnel(store, { accountId: opts.accountId, periodDays: days });
  const team = computeTeamPerformance(store, { accountId: opts.accountId, periodDays: days })
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 5);

  const totalRevenue = won.reduce((s, l) => s + l.value, 0);
  const pipelineValue = open.reduce((s, l) => s + l.value, 0);
  const wonCount = won.length;
  const lostCount = lost.length;

  return {
    asOf: new Date().toISOString(),
    periodDays: days,
    accounts,
    totalLeads: recent.length,
    openLeads: open.length,
    wonLeads: wonCount,
    lostLeads: lostCount,
    overallConversionRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
    totalPipelineValue: pipelineValue,
    totalClosedRevenue: totalRevenue,
    currency: allLeads[0]?.currency ?? "RUB",
    velocity,
    topAgents: team,
    funnelSnapshot: funnel,
  };
}
