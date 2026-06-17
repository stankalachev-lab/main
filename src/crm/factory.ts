import { CRMAccountConfig } from "../config/accounts.js";
import { BaseCRMConnector } from "./base.js";
import { KommoConnector } from "./kommo.js";
import { AmoCRMConnector } from "./amo.js";

export function createConnector(account: CRMAccountConfig): BaseCRMConnector {
  switch (account.variant) {
    case "kommo":
      return new KommoConnector(account);
    case "amo":
      return new AmoCRMConnector(account);
  }
}
