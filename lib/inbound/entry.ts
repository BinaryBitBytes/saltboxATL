import type {
  BuyerPoLine,
  ExpectationStatus,
  InventorySystem,
  PurchaseOrder,
} from "@/lib/inventory-schema";
import {
  buildExpectedInboundLoad,
  receivableInvoiceLines,
  stageExpectedReceivingOrder,
} from "@/lib/documents/inbound-load";

export function isUncheckedExpectedLoad(order: {
  intake?: string | null;
  status: string;
}): boolean {
  return order.intake === "expected" && order.status === "draft";
}

/** A receiving order the dock has opened, finished, or cancelled. */
export function inboundReceivingHasStarted(
  receivingOrders: ReadonlyArray<{ poNumber: string; intake?: string | null; status: string }>,
  purchaseOrderNumber: string,
): boolean {
  return receivingOrders.some(
    (order) =>
      order.poNumber === purchaseOrderNumber && !isUncheckedExpectedLoad(order),
  );
}

export type InboundEntryUpdate = {
  id: string;
  purchaseOrderNumber: string;
  projectId: string | null;
  jobIdNumber: string | null;
  vendor: string;
  carrier: string;
  expectedArrivalAt: string;
  buyerName?: string;
  notes?: string;
  expectationStatus: ExpectationStatus;
  expectedPalletCount: number;
  lines: BuyerPoLine[];
  now: string;
  nextId: () => string;
};

export function updateInboundEntry(
  system: InventorySystem,
  input: InboundEntryUpdate,
): { ok: true; purchaseOrder: PurchaseOrder } | { ok: false; error: string } {
  const existing = system.purchaseOrders.find((order) => order.id === input.id);
  if (!existing) {
    return { ok: false, error: "That inbound purchase order was not found." };
  }
  const nextNumber = input.purchaseOrderNumber;
  const duplicate = system.purchaseOrders.find(
    (order) => order.id !== existing.id && order.purchaseOrderNumber === nextNumber,
  );
  if (duplicate) {
    return { ok: false, error: "Another inbound entry already uses that PO number." };
  }

  const previousNumber = existing.purchaseOrderNumber;
  existing.purchaseOrderNumber = nextNumber;
  existing.projectId = input.projectId;
  existing.jobIdNumber = input.jobIdNumber;
  existing.vendor = input.vendor;
  existing.carrier = input.carrier;
  existing.expectedArrivalAt = input.expectedArrivalAt;
  existing.generatedAt = input.expectedArrivalAt;
  existing.buyerName = input.buyerName ?? null;
  existing.expectationNotes = input.notes;
  existing.expectationStatus = input.expectationStatus;
  existing.expectedPalletCount = input.expectedPalletCount;
  existing.lines = input.lines;
  existing.source = "coordinator";

  for (const order of system.receivingOrders) {
    if (order.poNumber === previousNumber) order.poNumber = nextNumber;
  }
  for (const document of system.purchaseDocuments ?? []) {
    if (document.purchaseOrderNumber !== previousNumber) continue;
    document.purchaseOrderNumber = nextNumber;
    document.jobIdNumber = input.jobIdNumber;
    document.lines = input.lines.slice(0, 200).map((line) => ({
      sku: line.sku,
      upc: line.upc,
      description: line.description,
      quantity: line.quantity,
      unitPrice: null,
      extendedPrice: null,
    }));
  }

  syncExpectedLoad(system, {
    purchaseOrderNumber: nextNumber,
    vendor: input.vendor,
    carrier: input.carrier,
    palletCount: input.expectedPalletCount,
    lines: input.lines,
    now: input.now,
    nextId: input.nextId,
  });
  return { ok: true, purchaseOrder: existing };
}

export function deleteInboundEntry(
  system: InventorySystem,
  id: string,
): { ok: true; documentIds: string[] } | { ok: false; error: string } {
  const index = system.purchaseOrders.findIndex((order) => order.id === id);
  if (index < 0) {
    return { ok: false, error: "That inbound purchase order was not found." };
  }
  const existing = system.purchaseOrders[index];
  if (!existing) {
    return { ok: false, error: "That inbound purchase order was not found." };
  }
  if (inboundReceivingHasStarted(system.receivingOrders, existing.purchaseOrderNumber)) {
    return {
      ok: false,
      error: "This purchase order already has freight on the dock, so it cannot be deleted.",
    };
  }
  const documentIds = (system.purchaseDocuments ?? [])
    .filter((document) => document.purchaseOrderNumber === existing.purchaseOrderNumber)
    .map((document) => document.id);
  system.purchaseOrders.splice(index, 1);
  system.receivingOrders = system.receivingOrders.filter(
    (order) =>
      !(
        order.poNumber === existing.purchaseOrderNumber &&
        isUncheckedExpectedLoad(order)
      ),
  );
  if (system.purchaseDocuments) {
    system.purchaseDocuments = system.purchaseDocuments.filter(
      (document) => document.purchaseOrderNumber !== existing.purchaseOrderNumber,
    );
  }
  return { ok: true, documentIds };
}

function syncExpectedLoad(
  system: InventorySystem,
  input: {
    purchaseOrderNumber: string;
    vendor: string;
    carrier: string;
    palletCount: number;
    lines: BuyerPoLine[];
    now: string;
    nextId: () => string;
  },
) {
  const receivable = receivableInvoiceLines(input.lines);
  const expected = system.receivingOrders.find(
    (order) =>
      order.poNumber === input.purchaseOrderNumber && isUncheckedExpectedLoad(order),
  );
  if (!expected) {
    if (
      receivable.length === 0 ||
      inboundReceivingHasStarted(system.receivingOrders, input.purchaseOrderNumber)
    ) {
      return;
    }
    stageExpectedReceivingOrder(system.receivingOrders, {
      id: input.nextId(),
      palletId: input.nextId(),
      caseIds: receivable.map(() => input.nextId()),
      now: input.now,
      purchaseOrderNumber: input.purchaseOrderNumber,
      vendor: input.vendor,
      carrier: input.carrier,
      palletCount: input.palletCount,
      receiverName: "Expected Receiver",
      lines: receivable,
      existingOrderNumbers: system.receivingOrders.map((order) => order.orderNumber),
    });
    return;
  }

  if (receivable.length === 0) {
    expected.vendor = input.vendor;
    expected.carrierInbound = input.carrier;
    expected.loadPalletCount = input.palletCount;
    expected.updatedAt = input.now;
    for (const pallet of expected.pallets) {
      pallet.cases = [];
      pallet.expectedSkuCount = 0;
      pallet.actualSkuCount = 0;
      pallet.expectedCaseCount = 0;
      pallet.actualCaseCount = 0;
    }
    return;
  }

  const rebuilt = buildExpectedInboundLoad({
    id: expected.id,
    palletId: expected.pallets[0]?.id ?? input.nextId(),
    caseIds: receivable.map(() => input.nextId()),
    now: expected.receivedAt || input.now,
    purchaseOrderNumber: input.purchaseOrderNumber,
    vendor: input.vendor,
    carrier: input.carrier,
    palletCount: input.palletCount,
    receiverName: expected.receiverName,
    createdBy: expected.createdBy,
    lines: receivable,
    existingOrderNumbers: [],
    notes: expected.notes,
  });
  rebuilt.orderNumber = expected.orderNumber;
  rebuilt.createdAt = expected.createdAt ?? input.now;
  rebuilt.updatedAt = input.now;
  const index = system.receivingOrders.indexOf(expected);
  system.receivingOrders[index] = rebuilt;
}
