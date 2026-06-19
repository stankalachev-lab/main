import { CRMAccountConfig } from "../config/accounts.js";
import { createConnector } from "../crm/factory.js";
import {
  transformLeads,
  transformContacts,
  transformPipelines,
  transformUsers,
  transformEvents,
  synthesiseCreatedEvents,
} from "./transformer.js";
import { DataStore } from "./store.js";

export type SyncMode = "full" | "incremental";

export interface SyncResult {
  accountId: string;
  mode: SyncMode;
  leadsProcessed: number;
  contactsProcessed: number;
  eventsProcessed: number;
  durationMs: number;
  error?: string;
}

export async function syncAccount(
  account: CRMAccountConfig,
  store: DataStore,
  mode: SyncMode
): Promise<SyncResult> {
  const start = Date.now();
  const connector = createConnector(account);

  try {
    const existingMeta = store.getSyncMeta(account.id)[0];
    const updatedAfter = mode === "incremental" && existingMeta ? existingMeta.lastSyncAt : undefined;

    // Fetch reference data (always full — small payloads)
    const [rawPipelines, rawUsers] = await Promise.all([
      connector.fetchPipelines(),
      connector.fetchUsers(),
    ]);

    const { pipelines, stageMap, statusKind } = transformPipelines(account, rawPipelines);
    const { agents, userMap } = transformUsers(account, rawUsers);
    store.upsertPipelines(pipelines);
    store.upsertAgents(agents);

    // Fetch transactional data
    const [rawLeads, rawContacts, rawEvents] = await Promise.all([
      connector.fetchLeads(updatedAfter),
      connector.fetchContacts(updatedAfter),
      connector.fetchEvents("leads", updatedAfter),
    ]);

    const leads = transformLeads(account, rawLeads, stageMap, statusKind, userMap);
    const contacts = transformContacts(account, rawContacts, userMap);
    const events = transformEvents(account, rawEvents);

    store.upsertLeads(leads);
    store.upsertContacts(contacts);
    store.upsertEvents(events);

    // Add synthetic created events for leads missing history
    if (mode === "full") {
      const syntheticEvents = synthesiseCreatedEvents(account, leads);
      store.upsertEvents(syntheticEvents);
    }

    store.recordSync({
      accountId: account.id,
      lastSyncAt: Math.floor(Date.now() / 1000),
      leadCount: leads.length,
      contactCount: contacts.length,
    });

    return {
      accountId: account.id,
      mode,
      leadsProcessed: leads.length,
      contactsProcessed: contacts.length,
      eventsProcessed: events.length,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      accountId: account.id,
      mode,
      leadsProcessed: 0,
      contactsProcessed: 0,
      eventsProcessed: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncAllAccounts(
  accounts: CRMAccountConfig[],
  store: DataStore,
  mode: SyncMode
): Promise<SyncResult[]> {
  return Promise.all(accounts.map((a) => syncAccount(a, store, mode)));
}
