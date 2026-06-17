import { z } from "zod";

// ── Reusable argument schemas ─────────────────────────────────────────────

export const AccountFilterSchema = z.object({
  accountId: z.string().optional().describe("Filter to a specific account ID"),
});

export const PeriodSchema = z.object({
  periodDays: z.number().int().min(1).max(365).default(30).describe("Look-back window in days"),
});

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(100),
});

// ── Tool argument schemas ─────────────────────────────────────────────────

export const ListAccountsArgsSchema = z.object({});

export const GetAccountStatusArgsSchema = z.object({
  accountId: z.string().describe("Account ID to inspect"),
});

export const SyncDataArgsSchema = z.object({
  accountId: z.string().optional().describe("Sync a specific account; omit to sync all"),
  mode: z.enum(["full", "incremental"]).default("incremental"),
});

export const GetLeadsArgsSchema = z
  .object({
    accountId: z.string().optional(),
    pipelineId: z.string().optional(),
    stageId: z.string().optional(),
    stageAlias: z
      .enum(["new_lead", "viewing", "offer", "due_diligence", "contract", "won", "lost"])
      .optional(),
    responsibleUserId: z.string().optional(),
    status: z.enum(["open", "won", "lost", "deleted"]).optional(),
    createdFrom: z.string().datetime().optional().describe("ISO 8601 date-time"),
    createdTo: z.string().datetime().optional().describe("ISO 8601 date-time"),
    search: z.string().optional().describe("Full-text search on name, address, tags"),
  })
  .merge(PaginationSchema);

export const GetLeadArgsSchema = z.object({
  id: z.string().describe("Unified lead ID"),
});

export const GetContactsArgsSchema = z
  .object({
    accountId: z.string().optional(),
    search: z.string().optional(),
  })
  .merge(PaginationSchema);

export const GetContactArgsSchema = z.object({
  id: z.string().describe("Unified contact ID"),
});

export const GetPipelinesArgsSchema = AccountFilterSchema;

export const GetAgentsArgsSchema = AccountFilterSchema;

export const GetDealEventsArgsSchema = z.object({
  leadId: z.string().describe("Unified lead ID"),
});

export const DiscoverCustomFieldsArgsSchema = z.object({
  accountId: z.string().describe("Account ID to introspect"),
});

export const GetPipelineVelocityArgsSchema = AccountFilterSchema.merge(PeriodSchema).extend({
  pipelineId: z.string().optional(),
});

export const GetConversionFunnelArgsSchema = AccountFilterSchema.merge(PeriodSchema).extend({
  pipelineId: z.string().optional(),
});

export const GetDealValueDistributionArgsSchema = AccountFilterSchema.extend({
  pipelineId: z.string().optional(),
  bucketCount: z.number().int().min(2).max(50).default(10),
});

export const GetTeamPerformanceArgsSchema = AccountFilterSchema.merge(PeriodSchema).extend({
  pipelineId: z.string().optional(),
});

export const GetDashboardSummaryArgsSchema = AccountFilterSchema.merge(PeriodSchema);

export const ExportLeadsArgsSchema = GetLeadsArgsSchema.extend({
  format: z.enum(["csv", "json"]).default("csv"),
});

export const ExportAnalyticsReportArgsSchema = AccountFilterSchema.merge(PeriodSchema).extend({
  type: z.enum(["velocity", "funnel", "team", "distribution"]),
  format: z.enum(["csv", "json"]).default("csv"),
  pipelineId: z.string().optional(),
});

// Exported types
export type GetLeadsArgs = z.infer<typeof GetLeadsArgsSchema>;
export type GetContactsArgs = z.infer<typeof GetContactsArgsSchema>;
export type SyncDataArgs = z.infer<typeof SyncDataArgsSchema>;
export type GetPipelineVelocityArgs = z.infer<typeof GetPipelineVelocityArgsSchema>;
export type GetConversionFunnelArgs = z.infer<typeof GetConversionFunnelArgsSchema>;
export type GetDealValueDistributionArgs = z.infer<typeof GetDealValueDistributionArgsSchema>;
export type GetTeamPerformanceArgs = z.infer<typeof GetTeamPerformanceArgsSchema>;
export type GetDashboardSummaryArgs = z.infer<typeof GetDashboardSummaryArgsSchema>;
export type ExportLeadsArgs = z.infer<typeof ExportLeadsArgsSchema>;
export type ExportAnalyticsReportArgs = z.infer<typeof ExportAnalyticsReportArgsSchema>;
