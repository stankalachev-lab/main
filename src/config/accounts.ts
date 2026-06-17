import { z } from "zod";

export const CRMVariantSchema = z.enum(["kommo", "amo"]);
export type CRMVariant = z.infer<typeof CRMVariantSchema>;

export const FieldMappingsSchema = z.object({
  propertyType: z.string().optional(),
  propertyAddress: z.string().optional(),
  dealSide: z.string().optional(),
  areaM2: z.string().optional(),
  floorNumber: z.string().optional(),
  totalFloors: z.string().optional(),
  objectCondition: z.string().optional(),
});
export type FieldMappings = z.infer<typeof FieldMappingsSchema>;

export const StageAliasesSchema = z.record(
  z.enum(["new_lead", "viewing", "offer", "due_diligence", "contract", "won", "lost"])
);
export type StageAliases = z.infer<typeof StageAliasesSchema>;

export const CRMAccountConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  variant: CRMVariantSchema,
  subdomain: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().url(),
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenExpiresAt: z.number(),
  fieldMappings: FieldMappingsSchema.optional().default({}),
  stageAliases: StageAliasesSchema.optional().default({}),
  currency: z.string().length(3).default("RUB"),
});
export type CRMAccountConfig = z.infer<typeof CRMAccountConfigSchema>;

export function baseUrl(account: CRMAccountConfig): string {
  const domain = account.variant === "kommo" ? "kommo.com" : "amocrm.ru";
  return `https://${account.subdomain}.${domain}/api/v4`;
}

export function tokenUrl(account: CRMAccountConfig): string {
  const domain = account.variant === "kommo" ? "kommo.com" : "amocrm.ru";
  return `https://${account.subdomain}.${domain}/oauth2/access_token`;
}
