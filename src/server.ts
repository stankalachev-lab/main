import http from "http";
import { URL } from "url";
import { initSchema } from "./db/client.js";
import { loadAccountsFromEnv } from "./config/credentials.js";
import { syncAllAccounts } from "./etl/extractor.js";
import { DataStore } from "./etl/store.js";
import {
  computePipelineVelocity,
  computeConversionFunnel,
  computeDealValueDistribution,
  computeTeamPerformance,
  computeDashboardSummary,
} from "./analytics/pipeline.js";
import { leadsToCSV, leadsToJSON } from "./export/serialiser.js";
import { loginUser, createUser, verifyToken } from "./auth/jwt.js";
import { query } from "./db/client.js";

const PORT = Number(process.env.PORT ?? 3000);
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MINUTES ?? 15) * 60_000;

const accounts = loadAccountsFromEnv();
const store = new DataStore();

// ── Helpers ───────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(payload);
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function authenticate(req: http.IncomingMessage): Record<string, unknown> | null {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return token ? verifyToken(token) : null;
}

function qs(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) ?? undefined;
}

// ── Router ────────────────────────────────────────────────────────────────

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    // ── Public ──────────────────────────────────────────────────────────
    if (path === "/health" && method === "GET") {
      return json(res, 200, { ok: true, accounts: accounts.length });
    }

    if (path === "/api/auth/login" && method === "POST") {
      const body = await parseBody(req);
      const token = await loginUser(String(body.email ?? ""), String(body.password ?? ""));
      if (!token) return json(res, 401, { error: "Invalid credentials" });
      return json(res, 200, { token });
    }

    // ── Protected ────────────────────────────────────────────────────────
    const user = authenticate(req);
    if (!user) return json(res, 401, { error: "Unauthorized" });

    // Accounts
    if (path === "/api/accounts" && method === "GET") {
      const metas = store.getSyncMeta();
      return json(res, 200, accounts.map((a) => ({
        id: a.id, label: a.label, variant: a.variant, subdomain: a.subdomain,
        lastSyncAt: metas.find((m) => m.accountId === a.id)?.lastSyncAt ?? null,
      })));
    }

    // Sync
    if (path === "/api/sync" && method === "POST") {
      const body = await parseBody(req);
      const targets = body.accountId
        ? accounts.filter((a) => a.id === body.accountId)
        : accounts;
      const mode = body.mode === "full" ? "full" : "incremental";
      const results = await syncAllAccounts(targets, store, mode);
      return json(res, 200, results);
    }

    // Leads
    if (path === "/api/leads" && method === "GET") {
      const all = store.getLeads({
        accountId: qs(url, "accountId"),
        pipelineId: qs(url, "pipelineId"),
        stageId: qs(url, "stageId"),
        stageAlias: qs(url, "stageAlias"),
        responsibleUserId: qs(url, "responsibleUserId"),
        status: qs(url, "status"),
        createdFrom: qs(url, "createdFrom"),
        createdTo: qs(url, "createdTo"),
        search: qs(url, "search"),
      });
      const page = Number(qs(url, "page") ?? 1);
      const limit = Math.min(Number(qs(url, "limit") ?? 100), 500);
      const start = (page - 1) * limit;
      return json(res, 200, { total: all.length, page, limit, items: all.slice(start, start + limit) });
    }

    const leadMatch = path.match(/^\/api\/leads\/([^/]+)$/);
    if (leadMatch && method === "GET") {
      const lead = store.getLead(leadMatch[1]);
      if (!lead) return json(res, 404, { error: "Not found" });
      return json(res, 200, lead);
    }

    // Contacts
    if (path === "/api/contacts" && method === "GET") {
      const all = store.getContacts({ accountId: qs(url, "accountId"), search: qs(url, "search") });
      const page = Number(qs(url, "page") ?? 1);
      const limit = Math.min(Number(qs(url, "limit") ?? 100), 500);
      return json(res, 200, { total: all.length, page, limit, items: all.slice((page - 1) * limit, page * limit) });
    }

    // Pipelines & agents
    if (path === "/api/pipelines" && method === "GET")
      return json(res, 200, store.getPipelines(qs(url, "accountId")));

    if (path === "/api/agents" && method === "GET")
      return json(res, 200, store.getAgents(qs(url, "accountId")));

    // Analytics
    const opts = {
      accountId: qs(url, "accountId"),
      pipelineId: qs(url, "pipelineId"),
      periodDays: Number(qs(url, "periodDays") ?? 30),
    };

    if (path === "/api/analytics/velocity" && method === "GET")
      return json(res, 200, computePipelineVelocity(store, opts));

    if (path === "/api/analytics/funnel" && method === "GET")
      return json(res, 200, computeConversionFunnel(store, opts));

    if (path === "/api/analytics/distribution" && method === "GET")
      return json(res, 200, computeDealValueDistribution(store, {
        accountId: opts.accountId,
        pipelineId: opts.pipelineId,
        bucketCount: Number(qs(url, "bucketCount") ?? 10),
      }));

    if (path === "/api/analytics/team" && method === "GET")
      return json(res, 200, computeTeamPerformance(store, opts));

    if (path === "/api/dashboard" && method === "GET")
      return json(res, 200, computeDashboardSummary(store, opts));

    // Export
    if (path === "/api/export/leads" && method === "GET") {
      const leads = store.getLeads({ accountId: qs(url, "accountId") });
      const fmt = qs(url, "format") ?? "csv";
      const data = fmt === "json" ? leadsToJSON(leads) : leadsToCSV(leads);
      const ct = fmt === "json" ? "application/json" : "text/csv";
      res.writeHead(200, { "Content-Type": ct, "Content-Disposition": `attachment; filename="leads.${fmt}"` });
      res.end(data);
      return;
    }

    // Admin: create user (admin only)
    if (path === "/api/users" && method === "POST") {
      if (user.role !== "admin") return json(res, 403, { error: "Forbidden" });
      const body = await parseBody(req);
      const created = await createUser(
        String(body.email), String(body.password), String(body.name),
        (body.role as "admin" | "manager" | "viewer") ?? "viewer"
      );
      return json(res, 201, created);
    }

    if (path === "/api/users" && method === "GET") {
      if (user.role !== "admin") return json(res, 403, { error: "Forbidden" });
      const users = await query("SELECT id, email, name, role, is_active, created_at, last_login_at FROM dashboard_users ORDER BY created_at");
      return json(res, 200, users);
    }

    return json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
  }
}

// ── Startup ───────────────────────────────────────────────────────────────

async function main() {
  await initSchema();
  console.log("[server] DB schema ready");

  // Initial sync
  if (accounts.length > 0) {
    syncAllAccounts(accounts, store, "incremental").catch(console.error);
    setInterval(() => syncAllAccounts(accounts, store, "incremental").catch(console.error), SYNC_INTERVAL_MS);
  } else {
    console.warn("[server] No CRM accounts configured. Set KOMMO_ACCOUNTS or AMO_ACCOUNTS.");
  }

  const server = http.createServer(handle);
  server.listen(PORT, () => console.log(`[server] Listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[server] Fatal:", err);
  process.exit(1);
});
