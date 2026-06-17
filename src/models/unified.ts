// ── Leads ──────────────────────────────────────────────────────────────────

export type LeadStatus = "open" | "won" | "lost" | "deleted";
export type DealSide = "buy" | "sell" | "rent";
export type PropertyType = "apartment" | "house" | "commercial" | "land" | "other";

export interface UnifiedLead {
  id: string;
  sourceAccountId: string;
  sourceLeadId: string;
  name: string;
  status: LeadStatus;
  pipelineId: string;
  stageId: string;
  stageName: string;
  stageOrder: number;
  stageAlias: string | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  contactIds: string[];
  companyId: string | null;

  // Real estate specific
  propertyType: PropertyType | null;
  propertyAddress: string | null;
  dealSide: DealSide | null;
  areaM2: number | null;
  floorNumber: number | null;
  totalFloors: number | null;
  objectCondition: string | null;

  value: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  expectedCloseDate: string | null;
  lossReasonId: string | null;
  lossReasonName: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
}

// ── Contacts ───────────────────────────────────────────────────────────────

export interface UnifiedContact {
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

// ── Pipelines & Stages ─────────────────────────────────────────────────────

export interface UnifiedStage {
  id: string;
  sourcePipelineId: string;
  sourceStageId: string;
  name: string;
  order: number;
  color: string;
  isSuccessStage: boolean;
  isFailureStage: boolean;
}

export interface UnifiedPipeline {
  id: string;
  sourceAccountId: string;
  sourcePipelineId: string;
  name: string;
  isArchived: boolean;
  stages: UnifiedStage[];
}

// ── Sales Agents ───────────────────────────────────────────────────────────

export interface SalesAgent {
  id: string;
  sourceAccountId: string;
  sourceUserId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

// ── Deal Events ────────────────────────────────────────────────────────────

export type DealEventType =
  | "stage_changed"
  | "responsible_changed"
  | "value_changed"
  | "closed"
  | "created";

export interface DealEvent {
  id: string;
  leadId: string;
  sourceAccountId: string;
  eventType: DealEventType;
  fromStageId: string | null;
  toStageId: string | null;
  fromValue: number | null;
  toValue: number | null;
  userId: string;
  createdAt: string;
  synthetic: boolean;
}

// ── Analytics ──────────────────────────────────────────────────────────────

export interface PipelineVelocityMetric {
  pipelineId: string;
  pipelineName: string;
  accountId: string;
  periodDays: number;
  avgDaysInStage: Record<string, number>;
  avgDealCycleDays: number;
  leadsEntered: number;
  leadsExited: number;
  dealsWon: number;
  dealsLost: number;
  conversionRate: number;
  totalPipelineValue: number;
  currency: string;
}

export interface ConversionRateByStage {
  stageId: string;
  stageName: string;
  stageOrder: number;
  stageAlias: string | null;
  leadsEntered: number;
  leadsAdvanced: number;
  leadsDropped: number;
  conversionRate: number;
  dropRate: number;
  avgTimeInStageHours: number;
}

export interface ValueBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  totalValue: number;
  avgValue: number;
}

export interface DealValueDistribution {
  buckets: ValueBucket[];
  currency: string;
  totalDeals: number;
  totalValue: number;
  medianValue: number;
  p25Value: number;
  p75Value: number;
}

export interface AgentPerformanceMetric {
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

export interface DashboardSummary {
  asOf: string;
  periodDays: number;
  accounts: string[];
  totalLeads: number;
  openLeads: number;
  wonLeads: number;
  lostLeads: number;
  overallConversionRate: number;
  totalPipelineValue: number;
  totalClosedRevenue: number;
  currency: string;
  velocity: PipelineVelocityMetric[];
  topAgents: AgentPerformanceMetric[];
  funnelSnapshot: ConversionRateByStage[];
}
