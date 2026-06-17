import { CRMAccountConfig, baseUrl, tokenUrl } from "../config/accounts.js";
import { rateLimitRps } from "../config/credentials.js";

export interface RawLead {
  id: number;
  name: string;
  price: number;
  responsible_user_id: number;
  status_id: number;
  pipeline_id: number;
  loss_reason_id: number | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  closest_task_at: number | null;
  custom_fields_values: RawCustomField[] | null;
  _embedded?: {
    tags?: Array<{ id: number; name: string }>;
    contacts?: Array<{ id: number }>;
    companies?: Array<{ id: number }>;
  };
}

export interface RawContact {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  responsible_user_id: number;
  created_at: number;
  updated_at: number;
  custom_fields_values: RawCustomField[] | null;
  _embedded?: {
    leads?: Array<{ id: number }>;
    companies?: Array<{ id: number }>;
  };
}

export interface RawPipeline {
  id: number;
  name: string;
  is_archive: boolean;
  _embedded?: {
    statuses?: RawStatus[];
  };
}

export interface RawStatus {
  id: number;
  name: string;
  sort: number;
  color: string;
  type: number; // 0=regular, 142=won, 143=lost
  pipeline_id: number;
}

export interface RawUser {
  id: number;
  name: string;
  email: string;
  role: { id: number; name: string } | null;
  rights: { is_active: boolean };
}

export interface RawCustomField {
  field_id: number;
  field_name: string;
  field_code: string | null;
  values: Array<{ value: string | number | boolean }>;
}

export interface RawEvent {
  id: string;
  type: string;
  entity_id: number;
  entity_type: string;
  created_by: number;
  created_at: number;
  value_after?: Array<{ lead_status?: { id: number; pipeline_id: number }; price?: { value: number }; responsible_user?: { id: number } }>;
  value_before?: Array<{ lead_status?: { id: number; pipeline_id: number }; price?: { value: number }; responsible_user?: { id: number } }>;
}

// ── Rate limiter ─────────────────────────────────────────────────────────

class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  private readonly maxRps: number;

  constructor(rps: number) {
    this.maxRps = rps;
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxRps) {
      this.running++;
      setTimeout(() => {
        this.running--;
        if (this.queue.length > 0) this.queue.shift()!();
      }, 1000);
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    return this.acquire();
  }
}

// ── Base CRM Connector ───────────────────────────────────────────────────

export abstract class BaseCRMConnector {
  protected account: CRMAccountConfig;
  private limiter: RateLimiter;

  constructor(account: CRMAccountConfig) {
    this.account = account;
    this.limiter = new RateLimiter(rateLimitRps());
  }

  get accountId(): string {
    return this.account.id;
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    const bufferSeconds = 300;
    if (Date.now() / 1000 < this.account.tokenExpiresAt - bufferSeconds) return;

    const res = await fetch(tokenUrl(this.account), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.account.clientId,
        client_secret: this.account.clientSecret,
        grant_type: "refresh_token",
        refresh_token: this.account.refreshToken,
        redirect_uri: this.account.redirectUri,
      }),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed for account ${this.account.id}: ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.account.accessToken = data.access_token;
    this.account.refreshToken = data.refresh_token;
    this.account.tokenExpiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
  }

  protected async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    await this.refreshTokenIfNeeded();
    await this.limiter.acquire();

    const url = new URL(`${baseUrl(this.account)}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let attempt = 0;
    while (true) {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.account.accessToken}` },
      });

      if (res.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        if (attempt > 4) throw new Error(`Rate limit exceeded for ${path} on account ${this.account.id}`);
        continue;
      }

      if (!res.ok) {
        throw new Error(`API error ${res.status} at ${path} for account ${this.account.id}`);
      }

      return res.json() as Promise<T>;
    }
  }

  protected async paginate<T>(
    path: string,
    embedKey: string,
    extraParams: Record<string, string | number | undefined> = {}
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;

    while (true) {
      const data = await this.get<{ _embedded?: Record<string, T[]>; _links?: { next?: unknown } }>(path, {
        ...extraParams,
        page,
        limit: 250,
        with: "contacts,companies,tags",
      });

      const items = data._embedded?.[embedKey] ?? [];
      results.push(...items);

      if (!data._links?.next || items.length < 250) break;
      page++;
    }

    return results;
  }

  // ── Public fetch methods ──────────────────────────────────────────────

  async fetchLeads(updatedAfter?: number): Promise<RawLead[]> {
    return this.paginate<RawLead>("/leads", "leads", updatedAfter ? { "filter[updated_at][from]": updatedAfter } : {});
  }

  async fetchContacts(updatedAfter?: number): Promise<RawContact[]> {
    return this.paginate<RawContact>("/contacts", "contacts", updatedAfter ? { "filter[updated_at][from]": updatedAfter } : {});
  }

  async fetchPipelines(): Promise<RawPipeline[]> {
    return this.paginate<RawPipeline>("/leads/pipelines", "pipelines", { with: "statuses" });
  }

  async fetchUsers(): Promise<RawUser[]> {
    return this.paginate<RawUser>("/users", "users", {});
  }

  async fetchEvents(entityType: "leads", updatedAfter?: number): Promise<RawEvent[]> {
    return this.paginate<RawEvent>("/events", "events", {
      filter: "lead_status_changed,lead_responsible_user_changed,lead_price_changed",
      "filter[entity]": entityType,
      ...(updatedAfter ? { "filter[created_at][from]": updatedAfter } : {}),
    });
  }

  async fetchCustomFields(): Promise<Array<{ id: number; name: string; code: string | null; field_type: string }>> {
    type CFResponse = { _embedded?: { custom_fields?: Array<{ id: number; name: string; code: string | null; field_type: string }> } };
    const data = await this.get<CFResponse>("/leads/custom_fields");
    return data._embedded?.custom_fields ?? [];
  }
}
