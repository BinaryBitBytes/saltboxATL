import type {
  BuyerPoLine,
  ExpectationStatus,
  PurchaseOrder,
} from "@/lib/inventory-schema";

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

export function isCoordinatorPurchaseOrder(order: PurchaseOrder): boolean {
  return (
    order.source === "coordinator" ||
    (order.lines?.length ?? 0) > 0 ||
    Boolean(order.vendor?.trim())
  );
}

/**
 * Attach a purchase order to a job.
 * A blank job ID leaves an existing number in place unless `replaceJobId` is set,
 * so a later receipt can omit the field without clearing project tracking.
 * Buyer expectation fields already stored on the order are left in place.
 */
export function upsertPurchaseOrder(
  purchaseOrders: PurchaseOrder[],
  input: {
    id: string;
    purchaseOrderNumber: string;
    generatedAt: string;
    jobIdNumber?: string | null;
    createdAt?: string;
    source?: PurchaseOrder["source"];
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
      source: input.source ?? "receipt",
    };
    purchaseOrders.unshift(created);
    return created;
  }
  if (replaceJobId || incoming) {
    existing.jobIdNumber = incoming;
  }
  return existing;
}

export function saveBuyerPurchaseOrder(
  purchaseOrders: PurchaseOrder[],
  input: {
    id: string;
    purchaseOrderNumber: string;
    generatedAt: string;
    createdAt?: string;
    projectId: string | null;
    vendor: string;
    carrier: string;
    expectedArrivalAt: string;
    buyerName?: string;
    notes?: string;
    expectationStatus: ExpectationStatus;
    expectedPalletCount: number;
    lines: BuyerPoLine[];
    uploadedBy?: string;
    jobIdNumber?: string | null;
  },
): PurchaseOrder {
  const existing = findPurchaseOrder(purchaseOrders, input.purchaseOrderNumber);
  if (!existing) {
    const created: PurchaseOrder = {
      id: input.id,
      purchaseOrderNumber: input.purchaseOrderNumber,
      generatedAt: input.generatedAt,
      createdAt: input.createdAt ?? input.generatedAt,
      jobIdNumber: input.jobIdNumber ?? null,
      projectId: input.projectId,
      vendor: input.vendor,
      carrier: input.carrier,
      expectedArrivalAt: input.expectedArrivalAt,
      buyerName: input.buyerName ?? null,
      expectationNotes: input.notes,
      expectationStatus: input.expectationStatus,
      expectedPalletCount: input.expectedPalletCount,
      lines: input.lines,
      uploadedBy: input.uploadedBy,
      source: "coordinator",
    };
    purchaseOrders.unshift(created);
    return created;
  }

  existing.projectId = input.projectId;
  existing.vendor = input.vendor;
  existing.carrier = input.carrier;
  existing.expectedArrivalAt = input.expectedArrivalAt;
  existing.buyerName = input.buyerName ?? null;
  existing.expectationNotes = input.notes;
  existing.expectationStatus = input.expectationStatus;
  existing.expectedPalletCount = input.expectedPalletCount;
  existing.lines = input.lines;
  existing.uploadedBy = input.uploadedBy ?? existing.uploadedBy;
  existing.source = "coordinator";
  if (!existing.jobIdNumber && input.jobIdNumber) {
    existing.jobIdNumber = input.jobIdNumber;
  }
  return existing;
}

/**
 * Assign an internal job ID to a purchase order that already exists.
 * Returns null when the coordinator has not uploaded that PO and receipt
 * has not created it yet.
 */
export function assignPurchaseOrderJobId(
  purchaseOrders: PurchaseOrder[],
  purchaseOrderNumber: string,
  jobIdNumber: string | null,
): PurchaseOrder | null {
  const existing = findPurchaseOrder(purchaseOrders, purchaseOrderNumber);
  if (!existing) return null;
  existing.jobIdNumber = jobIdNumber;
  return existing;
}
