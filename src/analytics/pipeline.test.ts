import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "../etl/store.js";
import { UnifiedLead, UnifiedPipeline, SalesAgent } from "../models/unified.js";
import {
  computePipelineVelocity,
  computeConversionFunnel,
  computeDealValueDistribution,
  computeTeamPerformance,
} from "./pipeline.js";

function makeStore(): DataStore {
  const store = new DataStore();

  const pipeline: UnifiedPipeline = {
    id: "acc1_p1",
    sourceAccountId: "acc1",
    sourcePipelineId: "1",
    name: "Real Estate",
    isArchived: false,
    stages: [
      { id: "acc1_s1", sourcePipelineId: "1", sourceStageId: "1", name: "New Lead", order: 1, color: "#aaa", isSuccessStage: false, isFailureStage: false },
      { id: "acc1_s2", sourcePipelineId: "1", sourceStageId: "2", name: "Viewing", order: 2, color: "#bbb", isSuccessStage: false, isFailureStage: false },
      { id: "acc1_s3", sourcePipelineId: "1", sourceStageId: "142", name: "Won", order: 100, color: "#4CAF50", isSuccessStage: true, isFailureStage: false },
      { id: "acc1_s4", sourcePipelineId: "1", sourceStageId: "143", name: "Lost", order: 101, color: "#F44336", isSuccessStage: false, isFailureStage: true },
    ],
  };

  const agent: SalesAgent = {
    id: "acc1_u1",
    sourceAccountId: "acc1",
    sourceUserId: "1",
    name: "Ivanova E.",
    email: "ivanova@example.com",
    role: "agent",
    isActive: true,
  };

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  const leads: UnifiedLead[] = [
    {
      id: "acc1_l1", sourceAccountId: "acc1", sourceLeadId: "1", name: "Lead A",
      status: "won", pipelineId: "acc1_p1", stageId: "acc1_s3", stageName: "Won",
      stageOrder: 100, stageAlias: "won", responsibleUserId: "acc1_u1", responsibleUserName: "Ivanova E.",
      contactIds: [], companyId: null, propertyType: "apartment", propertyAddress: null,
      dealSide: "buy", areaM2: 60, floorNumber: 3, totalFloors: 9, objectCondition: null,
      value: 5_000_000, currency: "RUB",
      createdAt: daysAgo(20), updatedAt: daysAgo(5), closedAt: daysAgo(5),
      expectedCloseDate: null, lossReasonId: null, lossReasonName: null, tags: [], customFields: {},
    },
    {
      id: "acc1_l2", sourceAccountId: "acc1", sourceLeadId: "2", name: "Lead B",
      status: "lost", pipelineId: "acc1_p1", stageId: "acc1_s4", stageName: "Lost",
      stageOrder: 101, stageAlias: "lost", responsibleUserId: "acc1_u1", responsibleUserName: "Ivanova E.",
      contactIds: [], companyId: null, propertyType: null, propertyAddress: null,
      dealSide: null, areaM2: null, floorNumber: null, totalFloors: null, objectCondition: null,
      value: 3_000_000, currency: "RUB",
      createdAt: daysAgo(15), updatedAt: daysAgo(2), closedAt: daysAgo(2),
      expectedCloseDate: null, lossReasonId: null, lossReasonName: null, tags: [], customFields: {},
    },
    {
      id: "acc1_l3", sourceAccountId: "acc1", sourceLeadId: "3", name: "Lead C",
      status: "open", pipelineId: "acc1_p1", stageId: "acc1_s2", stageName: "Viewing",
      stageOrder: 2, stageAlias: "viewing", responsibleUserId: "acc1_u1", responsibleUserName: "Ivanova E.",
      contactIds: [], companyId: null, propertyType: "house", propertyAddress: "Moscow",
      dealSide: "sell", areaM2: 120, floorNumber: null, totalFloors: null, objectCondition: null,
      value: 12_000_000, currency: "RUB",
      createdAt: daysAgo(5), updatedAt: daysAgo(1), closedAt: null,
      expectedCloseDate: null, lossReasonId: null, lossReasonName: null, tags: ["priority"], customFields: {},
    },
  ];

  store.upsertPipelines([pipeline]);
  store.upsertAgents([agent]);
  store.upsertLeads(leads);

  return store;
}

describe("computePipelineVelocity", () => {
  it("returns correct won/lost counts and conversion rate", () => {
    const store = makeStore();
    const [m] = computePipelineVelocity(store, { accountId: "acc1", periodDays: 30 });

    expect(m.dealsWon).toBe(1);
    expect(m.dealsLost).toBe(1);
    expect(m.conversionRate).toBe(0.5);
    expect(m.totalPipelineValue).toBe(12_000_000);
  });
});

describe("computeConversionFunnel", () => {
  it("returns stages sorted by order", () => {
    const store = makeStore();
    const funnel = computeConversionFunnel(store, { accountId: "acc1", periodDays: 30 });
    const orders = funnel.map((s) => s.stageOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("computeDealValueDistribution", () => {
  it("counts only won deals and computes median", () => {
    const store = makeStore();
    const dist = computeDealValueDistribution(store, { accountId: "acc1" });
    expect(dist.totalDeals).toBe(1); // only Lead A is won
    expect(dist.medianValue).toBe(5_000_000);
  });
});

describe("computeTeamPerformance", () => {
  it("aggregates correctly for a single agent", () => {
    const store = makeStore();
    const [agent] = computeTeamPerformance(store, { accountId: "acc1", periodDays: 30 });
    expect(agent.agentName).toBe("Ivanova E.");
    expect(agent.dealsWon).toBe(1);
    expect(agent.dealsLost).toBe(1);
    expect(agent.conversionRate).toBe(0.5);
    expect(agent.totalRevenue).toBe(5_000_000);
    expect(agent.activePipelineCount).toBe(1);
  });
});
