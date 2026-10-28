import {
  INBOUND_CANCEL_CONFIRMATION,
  isReceivingEditable,
  type BackorderLine,
  type InventorySystem,
  type PurchaseOrder,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import { receivableInvoiceLines } from "@/lib/documents/inbound-load";
import { inboundReceivingHasStarted } from "@/lib/inbound/entry";
import { isCoordinatorPurchaseOrder } from "@/lib/purchase-orders";
import { hasPostedPutaway } from "@/lib/receiving/reopen";

export const ASSOCIATES_CANNOT_CANCEL =
  "Associates cannot cancel a purchase order once the shipment has entered receiving.";
export const MANAGERS_OR_COORDINATORS_CANCEL =
  "Only a manager or coordinator can cancel a purchase order once the shipment has entered receiving.";
export const TYPE_CANCEL_PHRASE =
  "Type CancelRightMeow to cancel this purchase order.";
export const PO_NOT_IN_RECEIVING =
  "This purchase order has not entered receiving.";
export const PO_ALREADY_CANCELLED = "This purchase order is already cancelled.";
export const PO_HAS_ON_HAND =
  "This order already has on-hand inventory and cannot be cancelled. Keep it open as a partialed PO until remaining freight arrives.";
export const PALLET_ALREADY_PARTIAL = "This pallet is already partial.";
export const PALLET_NOT_SHORT =
  "Every expected case is already on this pallet. Remove the cases that have not arrived, or lower a quantity, before partialing the pallet.";
export const PALLET_NOT_OPENED =
  "Partial this pallet from the inbound shipment after receiving opens it.";
export const BACKORDER_CONFIRM =
  "Some cases on this purchase order have not shipped. Confirm the backorder to complete this shipment.";
export const RECEIVE_ONE_CASE =
  "Receive at least one case before completing this order.";
export const RECEIVE_ONE_MORE =
  "Receive at least one additional case before completing this partialed order.";
export const PARTIAL_NAME =
  "Enter the name of the person partialing this pallet.";
export const PALLET_MISSING = "Pallet not found on this receiving order.";
export const PO_NOT_FOUND = "That inbound purchase order was not found.";

const CANCEL_ROLES = new Set(["manager", "security-manager", "coordinator"]);
const ASSOCIATE_ROLES = new Set(["associate", "security-associate"]);

export type ExpectedArrivalLine = {
  sku: string;
  description: string;
  quantity: number;
};

export function canConfirmInboundCancel(role: string): boolean {
  return CANCEL_ROLES.has(role);
}

export function inboundCancelRoleError(role: string): string | null {
  if (canConfirmInboundCancel(role)) return null;
  if (ASSOCIATE_ROLES.has(role)) return ASSOCIATES_CANNOT_CANCEL;
  return MANAGERS_OR_COORDINATORS_CANCEL;
}

/** True once the dock is working a coordinator purchase order, not while it is only an unchecked expected draft. */
export function inboundCancelApplies(
  order: { poNumber: string; intake?: string | null; status: string },
  purchaseOrder: PurchaseOrder | null,
  receivingOrders: ReadonlyArray<{ poNumber: string; intake?: string | null; status: string }>,
): boolean {
  if (!purchaseOrder || order.poNumber !== purchaseOrder.purchaseOrderNumber) return false;
  const inbound =
    order.intake === "expected" || isCoordinatorPurchaseOrder(purchaseOrder);
  if (!inbound) return false;
  return inboundReceivingHasStarted(
    receivingOrders,
    purchaseOrder.purchaseOrderNumber,
  );
}

export function inboundShipmentOpenedByReceiving(order: {
  intake?: string | null;
  status: ReceivingOrder["status"];
}): boolean {
  return order.intake === "expected" && isReceivingEditable(order.status);
}

function lineKey(sku: string, description: string): string {
  const trimmedSku = sku.trim();
  return trimmedSku || description.trim();
}

/**
 * Purchase-order text is not what lands on the expected pallet. Staged cases
 * come from receivableInvoiceLines, which drops rows that cannot be received
 * and replaces a blank or invalid SKU with a description slug.
 */
export function receivableExpectedLines(
  lines: readonly ExpectedArrivalLine[],
): ExpectedArrivalLine[] {
  return receivableInvoiceLines(
    lines.map((line) => ({
      sku: line.sku,
      upc: "",
      description: line.description,
      quantity: line.quantity,
    })),
  ).map((line) => ({
    sku: line.sku,
    description: line.description,
    quantity: line.quantity,
  }));
}

export function backorderLinesForShipment(
  order: Pick<ReceivingOrder, "pallets">,
  expectedLines: readonly ExpectedArrivalLine[],
): BackorderLine[] {
  const stagedLines = receivableExpectedLines(expectedLines);
  if (expectedLines.length > 0) {
    const receivedByKey = new Map<string, number>();
    for (const pallet of order.pallets) {
      for (const item of pallet.cases) {
        const key = lineKey(item.sku, item.description);
        if (!key) continue;
        receivedByKey.set(key, (receivedByKey.get(key) ?? 0) + item.quantityInCase);
      }
    }
    const expectedByKey = new Map<string, ExpectedArrivalLine>();
    for (const line of stagedLines) {
      const key = lineKey(line.sku, line.description);
      if (!key || line.quantity < 1) continue;
      const current = expectedByKey.get(key);
      if (current) current.quantity += line.quantity;
      else expectedByKey.set(key, { ...line });
    }
    const short: BackorderLine[] = [];
    for (const [key, expected] of expectedByKey) {
      const received = receivedByKey.get(key) ?? 0;
      if (received >= expected.quantity) continue;
      short.push({
        sku: expected.sku,
        description: expected.description,
        expectedQuantity: expected.quantity,
        receivedQuantity: received,
      });
    }
    return short;
  }

  const expectedCases = order.pallets.reduce(
    (sum, pallet) => sum + pallet.expectedCaseCount,
    0,
  );
  const receivedCases = order.pallets.reduce(
    (sum, pallet) => sum + pallet.cases.length,
    0,
  );
  if (expectedCases <= receivedCases) return [];
  return [
    {
      sku: "",
      description: "Cases on this order",
      expectedQuantity: expectedCases,
      receivedQuantity: receivedCases,
    },
  ];
}

export function palletHasUnarrivedInventory(
  pallet: ReceivingOrder["pallets"][number],
  order: Pick<ReceivingOrder, "pallets">,
  expectedLines: readonly ExpectedArrivalLine[],
): boolean {
  if (pallet.expectedCaseCount > pallet.cases.length) return true;
  const shortfall = backorderLinesForShipment(order, expectedLines);
  if (shortfall.length === 0) return false;
  if (pallet.palletNumber === "EXPECTED" || order.pallets.length === 1) return true;
  const keys = new Set(
    pallet.cases.map((item) => lineKey(item.sku, item.description)).filter(Boolean),
  );
  return shortfall.some((line) => keys.has(lineKey(line.sku, line.description)));
}

export function expectedLinesFromPurchaseOrder(
  purchaseOrder: PurchaseOrder | null | undefined,
): ExpectedArrivalLine[] {
  return receivableExpectedLines(
    (purchaseOrder?.lines ?? []).map((line) => ({
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
    })),
  );
}

function clearParsedCases(order: ReceivingOrder): void {
  const parsed = order.pallets.filter((pallet) => pallet.palletNumber === "EXPECTED");
  const targets =
    parsed.length > 0 ? parsed : order.intake === "expected" ? order.pallets : [];
  for (const pallet of targets) {
    pallet.cases = [];
    pallet.actualCaseCount = 0;
    pallet.actualSkuCount = 0;
    pallet.expectedCaseCount = 0;
    pallet.expectedSkuCount = 0;
  }
}

export function cancelEnteredInboundPurchaseOrder(
  system: InventorySystem,
  purchaseOrderId: string,
  options: {
    actorRole: string;
    actorId?: string;
    confirmText?: string;
    now: string;
    nextId: () => string;
  },
): { ok: true; documentIds: string[] } | { ok: false; error: string } {
  const existing = system.purchaseOrders.find((order) => order.id === purchaseOrderId);
  if (!existing) return { ok: false, error: PO_NOT_FOUND };
  if (!inboundReceivingHasStarted(system.receivingOrders, existing.purchaseOrderNumber)) {
    return { ok: false, error: PO_NOT_IN_RECEIVING };
  }
  const roleError = inboundCancelRoleError(options.actorRole);
  if (roleError) return { ok: false, error: roleError };
  if (options.confirmText !== INBOUND_CANCEL_CONFIRMATION) {
    return { ok: false, error: TYPE_CANCEL_PHRASE };
  }

  const open = system.receivingOrders.filter(
    (order) =>
      order.poNumber === existing.purchaseOrderNumber && order.status !== "cancelled",
  );
  if (open.some((order) => hasPostedPutaway(order))) {
    return { ok: false, error: PO_HAS_ON_HAND };
  }
  if (existing.expectationStatus === "cancelled" && open.length === 0) {
    return { ok: false, error: PO_ALREADY_CANCELLED };
  }

  const documents = system.purchaseDocuments ?? [];
  const documentIds = documents
    .filter((document) => document.purchaseOrderNumber === existing.purchaseOrderNumber)
    .map((document) => document.id);
  system.purchaseDocuments = documents.filter(
    (document) => document.purchaseOrderNumber !== existing.purchaseOrderNumber,
  );
  existing.lines = [];
  existing.expectationStatus = "cancelled";

  for (const order of open) {
    order.status = "cancelled";
    order.workingPalletId = null;
    order.updatedAt = options.now;
    clearParsedCases(order);
  }

  system.transactions.unshift({
    id: options.nextId(),
    type: "inbound-po-cancel",
    occurredAt: options.now,
    sku: existing.purchaseOrderNumber,
    batch: null,
    inventoryItemId: null,
    locationId: null,
    destinationLocationId: null,
    quantityDelta: 0,
    reason:
      "Cancelled an inbound purchase order after it entered receiving. Parsed expected entries and the PDF were removed.",
    referenceType: "purchase-order",
    referenceId: existing.id,
    createdBy: options.actorId,
    notes: existing.purchaseOrderNumber,
  });
  return { ok: true, documentIds };
}

export function applyPartialInboundPallet(input: {
  order: ReceivingOrder;
  palletId: string;
  partialedBy: string;
  expectedLines: readonly ExpectedArrivalLine[];
  now: string;
}): { ok: true } | { ok: false; error: string } {
  const { order } = input;
  if (!isReceivingEditable(order.status)) {
    return {
      ok: false,
      error: `Receiving order ${order.orderNumber} is ${order.status} and cannot be partialed.`,
    };
  }
  if (!inboundShipmentOpenedByReceiving(order)) {
    return { ok: false, error: PALLET_NOT_OPENED };
  }
  const pallet = order.pallets.find((entry) => entry.id === input.palletId);
  if (!pallet) return { ok: false, error: PALLET_MISSING };
  if (pallet.isPartial) return { ok: false, error: PALLET_ALREADY_PARTIAL };
  if (!palletHasUnarrivedInventory(pallet, order, input.expectedLines)) {
    return { ok: false, error: PALLET_NOT_SHORT };
  }
  const name = input.partialedBy.trim();
  if (!name) return { ok: false, error: PARTIAL_NAME };

  pallet.isPartial = true;
  pallet.partialedBy = name;
  const skus = new Set(pallet.cases.map((item) => item.sku));
  pallet.actualCaseCount = pallet.cases.length;
  pallet.actualSkuCount = skus.size;
  if (order.status === "draft") order.status = "in-progress";
  order.isPartialed = true;
  order.partialedAt = input.now;
  order.partialedBy = name;
  order.updatedAt = input.now;
  return { ok: true };
}

export function finishReceivingShipment(
  order: ReceivingOrder,
  purchaseOrder: PurchaseOrder | null,
  input: { acknowledgeBackorder: boolean; now: string },
): { ok: true; backorderLines: BackorderLine[] } | { ok: false; error: string } {
  if (!isReceivingEditable(order.status)) {
    return {
      ok: false,
      error: `Receiving order ${order.orderNumber} is ${order.status} and cannot be edited.`,
    };
  }
  const pending = order.pallets.flatMap((pallet) =>
    pallet.cases.filter((item) => !item.putawayPostedAt),
  );
  if (pending.length === 0) {
    return {
      ok: false,
      error: hasPostedPutaway(order) ? RECEIVE_ONE_MORE : RECEIVE_ONE_CASE,
    };
  }
  const backorderLines = backorderLinesForShipment(
    order,
    expectedLinesFromPurchaseOrder(purchaseOrder),
  );
  if (backorderLines.length > 0 && !input.acknowledgeBackorder) {
    return { ok: false, error: BACKORDER_CONFIRM };
  }
  order.backorderLines = backorderLines;
  order.status = "received";
  order.workingPalletId = null;
  order.updatedAt = input.now;
  return { ok: true, backorderLines };
}
