import {
  PurchaseDocumentLineSchema,
  UserSchema,
} from "@/lib/inventory-schema";

/**
 * Credential keys rejected on user create/update input.
 * `password` is intentionally absent: sign-in and registration submit it,
 * and the auth schemas are what keep that value in scope.
 */
const INPUT_SECRET_KEYS = new Set([
  "passwordhash",
  "hash",
  "session",
  "token",
  "secret",
  "sessionsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "credential",
  "credentials",
]);

/**
 * Keys removed before a record is serialized to the browser.
 * Includes plaintext `password`, which input validation still accepts.
 */
const DOM_PRIVATE_KEYS = new Set([...INPUT_SECRET_KEYS, "password"]);

export function normalizeSchemaKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

export function isInputSecretKey(key: string): boolean {
  return INPUT_SECRET_KEYS.has(normalizeSchemaKey(key));
}

export function isDomPrivateKey(key: string): boolean {
  return DOM_PRIVATE_KEYS.has(normalizeSchemaKey(key));
}

/** Private fields that stay on the canonical Zod models. */
export const PRIVATE_SCHEMA_FIELDS = {
  user: ["passwordHash"] as const,
  purchaseDocumentLine: ["unitPrice", "extendedPrice"] as const,
};

export function schemaRetainsPrivateFields(): boolean {
  const userShape = UserSchema.shape as Record<string, { meta?: () => { scope?: string } | undefined }>;
  const lineShape = PurchaseDocumentLineSchema.shape as Record<
    string,
    { meta?: () => { scope?: string } | undefined }
  >;
  const userMarked = PRIVATE_SCHEMA_FIELDS.user.every((key) => {
    const field = userShape[key];
    return Boolean(field) && field.meta?.()?.scope === "private";
  });
  const pricesMarked = PRIVATE_SCHEMA_FIELDS.purchaseDocumentLine.every((key) => {
    const field = lineShape[key];
    return Boolean(field) && field.meta?.()?.scope === "private";
  });
  return userMarked && pricesMarked;
}
