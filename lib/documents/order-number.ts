import { LIMITS } from "@/lib/validation/limits";

export function expectedOrderNumber(purchaseOrderNumber: string): string {
  const compact = purchaseOrderNumber.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
  return `EXP-${compact || "PO"}`.slice(0, LIMITS.text);
}

export function uniqueOrderNumber(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`.slice(0, LIMITS.text);
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}-${existing.length}`.slice(0, LIMITS.text);
}
