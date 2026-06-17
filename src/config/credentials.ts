import { CRMAccountConfig, CRMAccountConfigSchema } from "./accounts.js";

/**
 * Loads CRM account configs from environment variables.
 * KOMMO_ACCOUNTS and AMO_ACCOUNTS are base64-encoded JSON arrays.
 */
export function loadAccountsFromEnv(): CRMAccountConfig[] {
  const accounts: CRMAccountConfig[] = [];

  for (const envVar of ["KOMMO_ACCOUNTS", "AMO_ACCOUNTS"]) {
    const raw = process.env[envVar];
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {
      throw new Error(`${envVar}: invalid base64-JSON`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`${envVar}: expected JSON array`);
    }

    for (const item of parsed) {
      const result = CRMAccountConfigSchema.safeParse(item);
      if (!result.success) {
        throw new Error(`${envVar}: invalid account config — ${result.error.message}`);
      }
      accounts.push(result.data);
    }
  }

  return accounts;
}

export function loadExchangeRates(): Record<string, number> {
  const raw = process.env.EXCHANGE_RATES;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    throw new Error("EXCHANGE_RATES: invalid JSON");
  }
}

export function cacheTtlSeconds(): number {
  return Number(process.env.CACHE_TTL_SECONDS ?? 900);
}

export function rateLimitRps(): number {
  return Number(process.env.RATE_LIMIT_RPS ?? 5);
}
