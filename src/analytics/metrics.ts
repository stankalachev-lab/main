import { UnifiedLead, DealEvent } from "../models/unified.js";

const MS_PER_DAY = 86_400_000;

export function periodStart(periodDays: number): string {
  return new Date(Date.now() - periodDays * MS_PER_DAY).toISOString();
}

export function daysBetween(isoA: string, isoB: string): number {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / MS_PER_DAY;
}

/** Compute the average of an array of numbers, or 0 if empty. */
export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Compute a percentile (0–100) from a sorted numeric array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Build a map of leadId → sorted stage events for computing time-in-stage.
 */
export function buildStageTimelineMap(
  events: DealEvent[]
): Map<string, Array<{ stageId: string; enteredAt: string; exitedAt: string | null }>> {
  const stageEvents = events.filter((e) => e.eventType === "stage_changed" || e.eventType === "created");
  const byLead = new Map<string, DealEvent[]>();

  for (const ev of stageEvents) {
    if (!byLead.has(ev.leadId)) byLead.set(ev.leadId, []);
    byLead.get(ev.leadId)!.push(ev);
  }

  const result = new Map<string, Array<{ stageId: string; enteredAt: string; exitedAt: string | null }>>();

  for (const [leadId, evs] of byLead) {
    const sorted = evs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const timeline: Array<{ stageId: string; enteredAt: string; exitedAt: string | null }> = [];

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      const stageId = ev.toStageId ?? ev.fromStageId;
      if (!stageId) continue;
      timeline.push({
        stageId,
        enteredAt: ev.createdAt,
        exitedAt: sorted[i + 1]?.createdAt ?? null,
      });
    }

    result.set(leadId, timeline);
  }

  return result;
}

/**
 * Compute average days spent per stage across given leads.
 */
export function avgDaysPerStage(
  leads: UnifiedLead[],
  events: DealEvent[]
): Record<string, number> {
  const timelineMap = buildStageTimelineMap(events);
  const stageHours = new Map<string, number[]>();

  for (const lead of leads) {
    const timeline = timelineMap.get(lead.id);
    if (!timeline) continue;

    for (const segment of timeline) {
      const exitedAt = segment.exitedAt ?? lead.closedAt ?? lead.updatedAt;
      const hours = daysBetween(segment.enteredAt, exitedAt) * 24;
      if (hours < 0) continue;
      if (!stageHours.has(segment.stageId)) stageHours.set(segment.stageId, []);
      stageHours.get(segment.stageId)!.push(hours);
    }
  }

  const result: Record<string, number> = {};
  for (const [stageId, hours] of stageHours) {
    result[stageId] = avg(hours) / 24; // convert to days
  }
  return result;
}
