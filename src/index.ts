import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAccountsFromEnv } from "./config/credentials.js";
import { DataStore } from "./etl/store.js";
import { syncAccount, syncAllAccounts } from "./etl/extractor.js";
import { createConnector } from "./crm/factory.js";
import {
  computePipelineVelocity,
  computeConversionFunnel,
  computeDealValueDistribution,
  computeTeamPerformance,
  computeDashboardSummary,
} from "./analytics/pipeline.js";
import {
  leadsToCSV,
  leadsToJSON,
  velocityToCSV,
  funnelToCSV,
  teamToCSV,
} from "./export/serialiser.js";
import {
  ListAccountsArgsSchema,
  GetAccountStatusArgsSchema,
  SyncDataArgsSchema,
  GetLeadsArgsSchema,
  GetLeadArgsSchema,
  GetContactsArgsSchema,
  GetContactArgsSchema,
  GetPipelinesArgsSchema,
  GetAgentsArgsSchema,
  GetDealEventsArgsSchema,
  DiscoverCustomFieldsArgsSchema,
  GetPipelineVelocityArgsSchema,
  GetConversionFunnelArgsSchema,
  GetDealValueDistributionArgsSchema,
  GetTeamPerformanceArgsSchema,
  GetDashboardSummaryArgsSchema,
  ExportLeadsArgsSchema,
  ExportAnalyticsReportArgsSchema,
} from "./tools/definitions.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────

const accounts = loadAccountsFromEnv();
const store = new DataStore();
const server = new McpServer({
  name: "crm-analytics",
  version: "0.1.0",
});

function accountById(id: string) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc) throw new Error(`Account not found: ${id}`);
  return acc;
}

function paginate<T>(items: T[], page: number, limit: number): { items: T[]; total: number; page: number; limit: number } {
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), total: items.length, page, limit };
}

// ── Account Management ────────────────────────────────────────────────────

server.tool(
  "list_accounts",
  "List all connected CRM accounts with their variant and sync status",
  ListAccountsArgsSchema.shape,
  async () => {
    const metas = store.getSyncMeta();
    const payload = accounts.map((a) => {
      const meta = metas.find((m) => m.accountId === a.id);
      return {
        id: a.id,
        label: a.label,
        variant: a.variant,
        subdomain: a.subdomain,
        lastSyncAt: meta ? new Date(meta.lastSyncAt * 1000).toISOString() : null,
        leadCount: meta?.leadCount ?? 0,
        contactCount: meta?.contactCount ?? 0,
      };
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  }
);

server.tool(
  "get_account_status",
  "Get detailed status for a single CRM account",
  GetAccountStatusArgsSchema.shape,
  async ({ accountId }) => {
    const acc = accountById(accountId);
    const meta = store.getSyncMeta(accountId)[0] ?? null;
    const pipelines = store.getPipelines(accountId);
    const agents = store.getAgents(accountId);
    const payload = {
      id: acc.id,
      label: acc.label,
      variant: acc.variant,
      subdomain: acc.subdomain,
      currency: acc.currency,
      lastSyncAt: meta ? new Date(meta.lastSyncAt * 1000).toISOString() : null,
      leadCount: meta?.leadCount ?? 0,
      contactCount: meta?.contactCount ?? 0,
      pipelineCount: pipelines.length,
      agentCount: agents.length,
      tokenExpiresAt: new Date(acc.tokenExpiresAt * 1000).toISOString(),
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  }
);

server.tool(
  "sync_data",
  "Trigger a data sync from CRM. Use mode=full for first run, incremental for subsequent runs.",
  SyncDataArgsSchema.shape,
  async ({ accountId, mode }) => {
    const targetAccounts = accountId ? [accountById(accountId)] : accounts;
    const results = await syncAllAccounts(targetAccounts, store, mode ?? "incremental");
    return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
  }
);

// ── Data Query Tools ──────────────────────────────────────────────────────

server.tool(
  "get_leads",
  "Query leads with optional filters. Returns paginated results.",
  GetLeadsArgsSchema.shape,
  async (args) => {
    const all = store.getLeads({
      accountId: args.accountId,
      pipelineId: args.pipelineId,
      stageId: args.stageId,
      stageAlias: args.stageAlias,
      responsibleUserId: args.responsibleUserId,
      status: args.status,
      createdFrom: args.createdFrom,
      createdTo: args.createdTo,
      search: args.search,
    });
    const paged = paginate(all, args.page ?? 1, args.limit ?? 100);
    return { content: [{ type: "text" as const, text: JSON.stringify(paged, null, 2) }] };
  }
);

server.tool(
  "get_lead",
  "Get a single lead by its unified ID",
  GetLeadArgsSchema.shape,
  async ({ id }) => {
    const lead = store.getLead(id);
    if (!lead) throw new Error(`Lead not found: ${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(lead, null, 2) }] };
  }
);

server.tool(
  "get_contacts",
  "Query contacts with optional filters",
  GetContactsArgsSchema.shape,
  async (args) => {
    const all = store.getContacts({ accountId: args.accountId, search: args.search });
    const paged = paginate(all, args.page ?? 1, args.limit ?? 100);
    return { content: [{ type: "text" as const, text: JSON.stringify(paged, null, 2) }] };
  }
);

server.tool(
  "get_contact",
  "Get a single contact by its unified ID",
  GetContactArgsSchema.shape,
  async ({ id }) => {
    const contact = store.getContact(id);
    if (!contact) throw new Error(`Contact not found: ${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(contact, null, 2) }] };
  }
);

server.tool(
  "get_pipelines",
  "List all pipelines with their stages",
  GetPipelinesArgsSchema.shape,
  async ({ accountId }) => {
    const pipelines = store.getPipelines(accountId);
    return { content: [{ type: "text" as const, text: JSON.stringify(pipelines, null, 2) }] };
  }
);

server.tool(
  "get_agents",
  "List all sales agents (responsible users)",
  GetAgentsArgsSchema.shape,
  async ({ accountId }) => {
    const agents = store.getAgents(accountId);
    return { content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }] };
  }
);

server.tool(
  "get_deal_events",
  "Get the full stage-transition history for a lead",
  GetDealEventsArgsSchema.shape,
  async ({ leadId }) => {
    const events = store.getEventsForLead(leadId);
    return { content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }] };
  }
);

server.tool(
  "discover_custom_fields",
  "Introspect an account's custom fields to help configure fieldMappings",
  DiscoverCustomFieldsArgsSchema.shape,
  async ({ accountId }) => {
    const acc = accountById(accountId);
    const connector = createConnector(acc);
    const fields = await connector.fetchCustomFields();
    return { content: [{ type: "text" as const, text: JSON.stringify(fields, null, 2) }] };
  }
);

// ── Analytics Tools ───────────────────────────────────────────────────────

server.tool(
  "get_pipeline_velocity",
  "Compute pipeline velocity metrics: avg deal cycle time, leads entered/won/lost, conversion rate",
  GetPipelineVelocityArgsSchema.shape,
  async (args) => {
    const metrics = computePipelineVelocity(store, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(metrics, null, 2) }] };
  }
);

server.tool(
  "get_conversion_funnel",
  "Compute stage-by-stage conversion funnel showing drop rates and avg time in each stage",
  GetConversionFunnelArgsSchema.shape,
  async (args) => {
    const funnel = computeConversionFunnel(store, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(funnel, null, 2) }] };
  }
);

server.tool(
  "get_deal_value_distribution",
  "Analyse the distribution of won deal values across configurable buckets",
  GetDealValueDistributionArgsSchema.shape,
  async (args) => {
    const distribution = computeDealValueDistribution(store, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(distribution, null, 2) }] };
  }
);

server.tool(
  "get_team_performance",
  "Compute per-agent performance metrics: deals won, conversion rate, revenue, avg cycle time",
  GetTeamPerformanceArgsSchema.shape,
  async (args) => {
    const metrics = computeTeamPerformance(store, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(metrics, null, 2) }] };
  }
);

server.tool(
  "get_dashboard_summary",
  "Return a full dashboard snapshot: totals, velocity, top agents, and funnel",
  GetDashboardSummaryArgsSchema.shape,
  async (args) => {
    const summary = computeDashboardSummary(store, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
  }
);

// ── Export Tools ──────────────────────────────────────────────────────────

server.tool(
  "export_leads",
  "Export filtered leads as CSV or JSON",
  ExportLeadsArgsSchema.shape,
  async (args) => {
    const leads = store.getLeads({
      accountId: args.accountId,
      pipelineId: args.pipelineId,
      stageId: args.stageId,
      stageAlias: args.stageAlias,
      responsibleUserId: args.responsibleUserId,
      status: args.status,
      createdFrom: args.createdFrom,
      createdTo: args.createdTo,
      search: args.search,
    });
    const format = args.format ?? "csv";
    const data = format === "csv" ? leadsToCSV(leads) : leadsToJSON(leads);
    const filename = `leads_export_${new Date().toISOString().slice(0, 10)}.${format}`;
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ filename, recordCount: leads.length, data }, null, 2) }],
    };
  }
);

server.tool(
  "export_analytics_report",
  "Export an analytics report (velocity, funnel, team, or distribution) as CSV or JSON",
  ExportAnalyticsReportArgsSchema.shape,
  async (args) => {
    const format = args.format ?? "csv";
    let data: string;
    let filename: string;

    const base = args.type + "_" + new Date().toISOString().slice(0, 10) + "." + format;

    switch (args.type) {
      case "velocity": {
        const metrics = computePipelineVelocity(store, args);
        data = format === "csv" ? velocityToCSV(metrics) : JSON.stringify(metrics, null, 2);
        filename = base;
        break;
      }
      case "funnel": {
        const funnel = computeConversionFunnel(store, args);
        data = format === "csv" ? funnelToCSV(funnel) : JSON.stringify(funnel, null, 2);
        filename = base;
        break;
      }
      case "team": {
        const team = computeTeamPerformance(store, args);
        data = format === "csv" ? teamToCSV(team) : JSON.stringify(team, null, 2);
        filename = base;
        break;
      }
      case "distribution": {
        const dist = computeDealValueDistribution(store, args);
        data = format === "json" ? JSON.stringify(dist, null, 2) : bucketsToCsv(dist);
        filename = base;
        break;
      }
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ filename, data }, null, 2) }],
    };
  }
);

function bucketsToCsv(dist: ReturnType<typeof computeDealValueDistribution>): string {
  const header = "label,min,max,count,total_value,avg_value";
  const rows = dist.buckets.map((b) =>
    `${b.label},${b.min},${b.max},${b.count},${b.totalValue},${b.avgValue.toFixed(0)}`
  );
  return [header, ...rows].join("\n");
}

// ── Start ─────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (accounts.length === 0) {
    process.stderr.write(
      "[crm-analytics] Warning: no accounts configured. Set KOMMO_ACCOUNTS or AMO_ACCOUNTS env vars.\n"
    );
  } else {
    process.stderr.write(
      `[crm-analytics] Server started with ${accounts.length} account(s): ${accounts.map((a) => a.id).join(", ")}\n`
    );
  }
}

main().catch((err) => {
  process.stderr.write(`[crm-analytics] Fatal: ${err}\n`);
  process.exit(1);
});
