import type { InventorySystem, PublicUser } from "@/lib/inventory-schema";
import { isDomPrivateKey } from "@/lib/validation/schema-privacy";
import { sanitizeDomText } from "@/lib/validation/sanitize";

const BLOCKED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Copy a server record into a payload that can be passed to a Client Component
 * or JSON response. Private schema keys are dropped and every string is
 * sanitized, so credential material and markup do not land in the DOM.
 * The input object is not mutated.
 */
export function hydrateForDom<T>(value: T): T {
  return project(value, true) as T;
}

/** Sanitize strings and keep every key. Use this for form-error maps. */
export function sanitizeDomStrings<T>(value: T): T {
  return project(value, false) as T;
}

export type DomSafeInventorySystem = Omit<InventorySystem, "users"> & {
  users: PublicUser[];
};

/** Page data: same warehouse records, without credential fields. */
export function hydrateInventoryForDom(system: InventorySystem): DomSafeInventorySystem {
  return hydrateForDom(system) as DomSafeInventorySystem;
}

function project(value: unknown, stripPrivateKeys: boolean): unknown {
  if (typeof value === "string") return sanitizeDomText(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => project(entry, stripPrivateKeys));
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (BLOCKED_OBJECT_KEYS.has(key)) continue;
    if (stripPrivateKeys && isDomPrivateKey(key)) continue;
    output[key] = project(entry, stripPrivateKeys);
  }
  return output;
}
