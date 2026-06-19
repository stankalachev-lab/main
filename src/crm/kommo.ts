import { CRMAccountConfig } from "../config/accounts.js";
import { BaseCRMConnector } from "./base.js";

/**
 * Kommo CRM connector (international variant, base domain: kommo.com).
 * API surface is identical to AmoCRM v4; variant-specific behaviour is
 * handled by the base URL resolved in BaseCRMConnector via account.variant.
 */
export class KommoConnector extends BaseCRMConnector {
  constructor(account: CRMAccountConfig) {
    if (account.variant !== "kommo") {
      throw new Error(`KommoConnector requires variant "kommo", got "${account.variant}"`);
    }
    super(account);
  }
}
