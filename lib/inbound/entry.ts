import {
  INBOUND_CANCEL_REQUIRES_BUTTON,
  INBOUND_DOCK_DELETE_CONFIRMATION,
  INBOUND_DOCK_DELETE_DAILY_LIMIT,
  type BuyerPoLine,
  type ExpectationStatus,
  type InventorySystem,
  type PurchaseOrder,
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
  if (
    input.expectationStatus === "cancelled" &&
    existing.expectationStatus !== "cancelled" &&
    inboundReceivingHasStarted(system.receivingOrders, existing.purchaseOrderNumber)
  ) {
    return { ok: false, error: INBOUND_CANCEL_REQUIRES_BUTTON };
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

  refreshExpectedLoad(system, {
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

export type DeleteInboundEntryOptions = {
  actorRole?: string;
  actorId?: string;
  now?: string;
  dockConfirmText?: string;
  nextId?: () => string;
};

const DOCK_DELETE_REFERENCE = "dock-freight-delete";

export function dockFreightDeletesOnDay(system: InventorySystem, now: string): number {
  const day = now.slice(0, 10);
  return system.transactions.filter(
    (entry) =>
      entry.referenceType === DOCK_DELETE_REFERENCE && entry.occurredAt.slice(0, 10) === day,
  ).length;
}

export function deleteInboundEntry(
  system: InventorySystem,
  id: string,
  options?: DeleteInboundEntryOptions,
): { ok: true; documentIds: string[]; reversedUnits: number } | { ok: false; error: string } {
  const index = system.purchaseOrders.findIndex((order) => order.id === id);
  if (index < 0) {
    return { ok: false, error: "That inbound purchase order was not found." };
  }
  const existing = system.purchaseOrders[index];
  if (!existing) {
    return { ok: false, error: "That inbound purchase order was not found." };
  }
  const docked = inboundReceivingHasStarted(
    system.receivingOrders,
    existing.purchaseOrderNumber,
  );
  let reversedUnits = 0;
  if (docked) {
    if (options?.actorRole !== "coordinator") {
      return {
        ok: false,
        error: options?.actorRole
          ? "Only a coordinator can delete a purchase order that already has freight on the dock."
          : "This purchase order already has freight on the dock, so it cannot be deleted.",
      };
    }
    if (options.dockConfirmText !== INBOUND_DOCK_DELETE_CONFIRMATION) {
      return {
        ok: false,
        error:
          "Type DeleteThisMeow to confirm deleting a purchase order that has freight on the dock.",
      };
    }
    const now = options.now ?? new Date().toISOString();
    if (dockFreightDeletesOnDay(system, now) >= INBOUND_DOCK_DELETE_DAILY_LIMIT) {
      return {
        ok: false,
        error:
          "A coordinator can delete 5 purchase orders with freight on the dock per day. That limit is already used.",
      };
    }
    const nextId = options.nextId ?? (() => crypto.randomUUID());
    reversedUnits = balanceDockInventory(system, existing, now, nextId);
    system.receivingOrders = system.receivingOrders.filter(
      (order) => order.poNumber !== existing.purchaseOrderNumber,
    );
    system.transactions.unshift({
      id: nextId(),
      type: "dock-freight-delete",
      occurredAt: now,
      sku: existing.purchaseOrderNumber,
      batch: null,
      inventoryItemId: null,
      locationId: null,
      destinationLocationId: null,
      quantityDelta: 0,
      reason: "Coordinator deleted an inbound purchase order that had freight on the dock.",
      referenceType: DOCK_DELETE_REFERENCE,
      referenceId: existing.id,
      createdBy: options.actorId,
      notes: existing.purchaseOrderNumber,
    });
  }
  const documentIds = (system.purchaseDocuments ?? [])
    .filter((document) => document.purchaseOrderNumber === existing.purchaseOrderNumber)
    .map((document) => document.id);
  system.purchaseOrders.splice(index, 1);
  if (!docked) {
    system.receivingOrders = system.receivingOrders.filter(
      (order) =>
        !(
          order.poNumber === existing.purchaseOrderNumber &&
          isUncheckedExpectedLoad(order)
        ),
    );
  }
  if (system.purchaseDocuments) {
    system.purchaseDocuments = system.purchaseDocuments.filter(
      (document) => document.purchaseOrderNumber !== existing.purchaseOrderNumber,
    );
  }
  return { ok: true, documentIds, reversedUnits };
}

function balanceDockInventory(
  system: InventorySystem,
  purchaseOrder: PurchaseOrder,
  now: string,
  nextId: () => string,
): number {
  const orders = system.receivingOrders.filter(
    (order) => order.poNumber === purchaseOrder.purchaseOrderNumber,
  );
  const orderIds = new Set(orders.map((order) => order.id));
  const posted = system.transactions.filter(
    (entry) =>
      entry.referenceType === "receiving-order" &&
      entry.referenceId != null &&
      orderIds.has(entry.referenceId) &&
      entry.type === "putaway" &&
      entry.quantityDelta > 0,
  );
  const groups = new Map<
    string,
    {
      sku: string;
      upc?: string;
      batch: string | null;
      locationId: string | null;
      inventoryItemId: string | null;
      quantity: number;
    }
  >();
  const addGroup = (input: {
    sku: string;
    upc?: string;
    batch: string | null;
    locationId: string | null;
    inventoryItemId: string | null;
    quantity: number;
  }) => {
    const key = `${input.inventoryItemId ?? ""}|${input.sku}|${input.batch ?? ""}|${input.locationId ?? ""}`;
    const current = groups.get(key);
    if (current) current.quantity += input.quantity;
    else groups.set(key, { ...input });
  };
  if (posted.length > 0) {
    for (const entry of posted) {
      addGroup({
        sku: entry.sku,
        upc: entry.upc,
        batch: entry.batch ?? null,
        locationId: entry.locationId ?? null,
        inventoryItemId: entry.inventoryItemId ?? null,
        quantity: entry.quantityDelta,
      });
    }
  } else {
    for (const order of orders) {
      for (const pallet of order.pallets) {
        for (const item of pallet.cases) {
          if (!item.putawayPostedAt || !item.putawayLocationId) continue;
          addGroup({
            sku: item.sku,
            upc: item.upc,
            batch: item.batch ?? null,
            locationId: item.putawayLocationId,
            inventoryItemId: null,
            quantity: item.quantityInCase,
          });
        }
      }
    }
  }

  let reversed = 0;
  for (const group of groups.values()) {
    const item = system.inventoryItems.find(
      (entry) =>
        (group.inventoryItemId && entry.id === group.inventoryItemId) ||
        (!group.inventoryItemId &&
          entry.sku === group.sku &&
          (entry.batch ?? null) === group.batch &&
          entry.locationId === group.locationId),
    );
    if (!item || item.quantity < 1 || group.quantity < 1) continue;
    const remove = Math.min(item.quantity, group.quantity);
    const quantityBefore = item.quantity;
    item.quantity -= remove;
    item.updatedAt = now;
    reversed += remove;
    system.transactions.unshift({
      id: nextId(),
      type: "putaway",
      occurredAt: now,
      sku: item.sku,
      upc: item.upc,
      batch: item.batch ?? null,
      inventoryItemId: item.id,
      locationId: item.locationId,
      destinationLocationId: null,
      quantityDelta: -remove,
      quantityBefore,
      quantityAfter: item.quantity,
      reason: `Balanced inventory after deleting inbound PO ${purchaseOrder.purchaseOrderNumber}.`,
      referenceType: "purchase-order",
      referenceId: purchaseOrder.id,
    });
  }
  return reversed;
}

/** Remove one uploaded PDF. The purchase order and receiving loads stay. */
export function deleteUploadedPurchasePdf(
  system: InventorySystem,
  documentId: string,
): { ok: true; documentId: string } | { ok: false; error: string } {
  const documents = system.purchaseDocuments ?? [];
  const index = documents.findIndex((document) => document.id === documentId);
  if (index < 0) {
    return { ok: false, error: "That purchase PDF was not found." };
  }
  const removed = documents[index];
  documents.splice(index, 1);
  system.purchaseDocuments = documents;
  return { ok: true, documentId: removed?.id ?? documentId };
}

export function refreshExpectedLoad(
  system: InventorySystem,
  input: {
    purchaseOrderNumber: string;
    vendor: string;
    carrier: string;
    palletCount: number;
    lines: BuyerPoLine[];
    now: string;
    nextId: () => string;
    receiverName?: string;
  },
) {
  const receivable = receivableInvoiceLines(input.lines);
  const expected = system.receivingOrders.find(
    (order) =>
      order.poNumber === input.purchaseOrderNumber && isUncheckedExpectedLoad(order),
  );
  if (!expected) {
    // A cancelled receipt stays on file so a dock delete is still guarded, and
    // it must not block a coordinator from staging the purchase order again.
    const openReceiving = system.receivingOrders.filter(
      (order) => order.status !== "cancelled",
    );
    if (
      receivable.length === 0 ||
      inboundReceivingHasStarted(openReceiving, input.purchaseOrderNumber)
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
      receiverName: input.receiverName?.trim() || "Expected Receiver",
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
