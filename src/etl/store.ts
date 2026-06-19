import { UnifiedLead, UnifiedContact, UnifiedPipeline, SalesAgent, DealEvent } from "../models/unified.js";
import { cacheTtlSeconds } from "../config/credentials.js";

export interface SyncMeta {
  accountId: string;
  lastSyncAt: number; // unix seconds
  leadCount: number;
  contactCount: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class DataStore {
  private leads = new Map<string, UnifiedLead>();
  private contacts = new Map<string, UnifiedContact>();
  private pipelines = new Map<string, UnifiedPipeline>();
  private agents = new Map<string, SalesAgent>();
  private events = new Map<string, DealEvent>();
  private syncMeta = new Map<string, SyncMeta>();

  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly ttl = cacheTtlSeconds() * 1000;

  // ── Upsert methods ────────────────────────────────────────────────────

  upsertLeads(items: UnifiedLead[]): void {
    for (const item of items) this.leads.set(item.id, item);
    this.invalidateCache();
  }

  upsertContacts(items: UnifiedContact[]): void {
    for (const item of items) this.contacts.set(item.id, item);
    this.invalidateCache();
  }

  upsertPipelines(items: UnifiedPipeline[]): void {
    for (const item of items) this.pipelines.set(item.id, item);
    this.invalidateCache();
  }

  upsertAgents(items: SalesAgent[]): void {
    for (const item of items) this.agents.set(item.id, item);
    this.invalidateCache();
  }

  upsertEvents(items: DealEvent[]): void {
    for (const item of items) this.events.set(item.id, item);
    this.invalidateCache();
  }

  recordSync(meta: SyncMeta): void {
    this.syncMeta.set(meta.accountId, meta);
  }

  // ── Query methods ─────────────────────────────────────────────────────

  getLeads(filters: LeadFilters = {}): UnifiedLead[] {
    const cacheKey = `leads:${JSON.stringify(filters)}`;
    const cached = this.getCache<UnifiedLead[]>(cacheKey);
    if (cached) return cached;

    let results = [...this.leads.values()];

    if (filters.accountId) results = results.filter((l) => l.sourceAccountId === filters.accountId);
    if (filters.pipelineId) results = results.filter((l) => l.pipelineId === filters.pipelineId);
    if (filters.stageId) results = results.filter((l) => l.stageId === filters.stageId);
    if (filters.responsibleUserId) results = results.filter((l) => l.responsibleUserId === filters.responsibleUserId);
    if (filters.status) results = results.filter((l) => l.status === filters.status);
    if (filters.createdFrom) results = results.filter((l) => l.createdAt >= filters.createdFrom!);
    if (filters.createdTo) results = results.filter((l) => l.createdAt <= filters.createdTo!);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.propertyAddress?.toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (filters.stageAlias) results = results.filter((l) => l.stageAlias === filters.stageAlias);

    this.setCache(cacheKey, results);
    return results;
  }

  getLead(id: string): UnifiedLead | undefined {
    return this.leads.get(id);
  }

  getContacts(filters: ContactFilters = {}): UnifiedContact[] {
    let results = [...this.contacts.values()];
    if (filters.accountId) results = results.filter((c) => c.sourceAccountId === filters.accountId);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(
        (c) => c.fullName.toLowerCase().includes(q) || c.email.some((e) => e.toLowerCase().includes(q))
      );
    }
    return results;
  }

  getContact(id: string): UnifiedContact | undefined {
    return this.contacts.get(id);
  }

  getPipelines(accountId?: string): UnifiedPipeline[] {
    const results = [...this.pipelines.values()];
    return accountId ? results.filter((p) => p.sourceAccountId === accountId) : results;
  }

  getAgents(accountId?: string): SalesAgent[] {
    const results = [...this.agents.values()];
    return accountId ? results.filter((a) => a.sourceAccountId === accountId) : results;
  }

  getEventsForLead(leadId: string): DealEvent[] {
    return [...this.events.values()]
      .filter((e) => e.leadId === leadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getEvents(accountId?: string): DealEvent[] {
    const results = [...this.events.values()];
    return accountId ? results.filter((e) => e.sourceAccountId === accountId) : results;
  }

  getSyncMeta(accountId?: string): SyncMeta[] {
    const all = [...this.syncMeta.values()];
    return accountId ? all.filter((m) => m.accountId === accountId) : all;
  }

  // ── Cache helpers ─────────────────────────────────────────────────────

  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, expiresAt: Date.now() + this.ttl });
  }

  private invalidateCache(): void {
    this.cache.clear();
  }
}

export interface LeadFilters {
  accountId?: string;
  pipelineId?: string;
  stageId?: string;
  responsibleUserId?: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  stageAlias?: string;
  page?: number;
  limit?: number;
}

export interface ContactFilters {
  accountId?: string;
  search?: string;
  page?: number;
  limit?: number;
}
