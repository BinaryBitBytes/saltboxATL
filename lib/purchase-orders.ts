import type { PurchaseOrder } from "@/lib/inventory-schema";

export function findPurchaseOrder(
  purchaseOrders: PurchaseOrder[],
  purchaseOrderNumber: string,
): PurchaseOrder | undefined {
  return purchaseOrders.find(
    (order) => order.purchaseOrderNumber === purchaseOrderNumber,
  );
}

export function jobIdForPurchaseOrder(
  purchaseOrders: PurchaseOrder[],
  purchaseOrderNumber: string,
): string | null {
  return findPurchaseOrder(purchaseOrders, purchaseOrderNumber)?.jobIdNumber ?? null;
}

export function formatJobId(jobIdNumber: string | null | undefined): string {
  const value = jobIdNumber?.trim();
  return value ? value : "—";
}

/**
 * Attach a purchase order to a job.
 * A blank job ID leaves an existing number in place unless `replaceJobId` is set,
 * so a later receipt can omit the field without clearing project tracking.
 */
export function upsertPurchaseOrder(
  purchaseOrders: PurchaseOrder[],
  input: {
    id: string;
    purchaseOrderNumber: string;
    generatedAt: string;
    jobIdNumber?: string | null;
    createdAt?: string;
  },
  options?: { replaceJobId?: boolean },
): PurchaseOrder {
  const replaceJobId = options?.replaceJobId ?? false;
  const incoming = input.jobIdNumber ?? null;
  const existing = findPurchaseOrder(purchaseOrders, input.purchaseOrderNumber);
  if (!existing) {
    const created: PurchaseOrder = {
      id: input.id,
      purchaseOrderNumber: input.purchaseOrderNumber,
      generatedAt: input.generatedAt,
      createdAt: input.createdAt ?? input.generatedAt,
      jobIdNumber: incoming,
    };
    purchaseOrders.unshift(created);
    return created;
  }
  if (replaceJobId || incoming) {
    existing.jobIdNumber = incoming;
  }
  return existing;
}
