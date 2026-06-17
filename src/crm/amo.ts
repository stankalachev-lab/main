import { CRMAccountConfig } from "../config/accounts.js";
import { BaseCRMConnector } from "./base.js";

/**
 * AmoCRM connector (Russian market variant, base domain: amocrm.ru).
 * Functionally identical to KommoConnector at the API level;
 * separated for future feature-flag gating as APIs diverge.
 */
export class AmoCRMConnector extends BaseCRMConnector {
  constructor(account: CRMAccountConfig) {
    if (account.variant !== "amo") {
      throw new Error(`AmoCRMConnector requires variant "amo", got "${account.variant}"`);
    }
    super(account);
  }
}
