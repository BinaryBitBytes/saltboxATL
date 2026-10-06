import type {
  CustomerOrder,
  CustomerOrderLine,
  InventoryItem,
  Location,
} from "@/lib/inventory-schema";
import { CustomerOrderSchema } from "@/lib/inventory-schema";
import { assertUniquePicks } from "@/lib/validation/inventory-guards";
import { assertActiveLocation } from "@/lib/validation/inventory-guards";
import { ValidationError } from "@/lib/validation/errors";
import {
  assertAvailableQuantity,
  reservedQuantity,
} from "@/lib/orders/availability";

export function nextOrderNumber(
  orders: Array<{ orderNumber: string }>,
  nowIso: string,
): string {
  const day = nowIso.slice(0, 10).replaceAll("-", "");
  const prefix = `ORD-${day}-`;
  let max = 0;
  for (const order of orders) {
    if (!order.orderNumber.startsWith(prefix)) continue;
    const seq = Number(order.orderNumber.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function pickRequestNumber(orderNumber: string): string {
  return orderNumber.replace(/^ORD-/, "PK-");
}

export function placeRemoteOrder(input: {
  customer: string;
  notes?: string;
  placedBy: string;
  createdBy?: string;
  now: string;
  printerName: string;
  existingOrders: CustomerOrder[];
  inventory: InventoryItem[];
  locations: Location[];
  lines: Array<{ inventoryItemId: string; quantity: number }>;
}): CustomerOrder {
  assertUniquePicks(input.lines);
  if (!input.placedBy.trim()) {
    throw new ValidationError("A name is required to place an order.");
  }

  const orderLines: CustomerOrderLine[] = input.lines.map((requested) => {
    const item = input.inventory.find(
      (entry) => entry.id === requested.inventoryItemId,
    );
    if (!item) {
      throw new ValidationError(
        "One of the selected inventory lines no longer exists.",
      );
    }
    assertActiveLocation(
      input.locations.find((entry) => entry.id === item.locationId),
      "an order",
    );
    assertAvailableQuantity(
      item.quantity,
      reservedQuantity(input.existingOrders, item.id),
      requested.quantity,
      item.sku,
      "order",
    );
    return {
      id: crypto.randomUUID(),
      inventoryItemId: item.id,
      sku: item.sku,
      upc: item.upc ?? item.sku,
      description: item.description?.trim() || item.sku,
      manufacturer: item.manufacturer ?? "",
      color: item.color ?? null,
      batch: item.batch,
      locationId: item.locationId,
      quantity: requested.quantity,
    };
  });

  const orderNumber = nextOrderNumber(input.existingOrders, input.now);
  const printBatchId = crypto.randomUUID();
  const pickRequestId = crypto.randomUUID();

  return CustomerOrderSchema.parse({
    id: crypto.randomUUID(),
    orderNumber,
    customer: input.customer,
    placedBy: input.placedBy,
    notes: input.notes?.trim() ? input.notes.trim() : undefined,
    status: "picking",
    submittedAt: input.now,
    lines: orderLines,
    printBatch: {
      id: printBatchId,
      printerName: input.printerName,
      status: "dispatched",
      dispatchedAt: input.now,
      printedAt: null,
      documents: [
        ...orderLines.map((line) => ({
          kind: "item-label" as const,
          itemId: line.id,
          sku: line.sku,
          copies: 1 as const,
        })),
        { kind: "pack-slip" as const, copies: 1 as const },
        { kind: "loading-sheet" as const, copies: 1 as const },
      ],
      itemLabelCount: orderLines.length,
      includesPackSlip: true,
      includesLoadingSheet: true,
    },
    pickRequest: {
      id: pickRequestId,
      requestNumber: pickRequestNumber(orderNumber),
      status: "open",
      triggeredByPrintBatchId: printBatchId,
      printerName: input.printerName,
      requestedAt: input.now,
      completedAt: null,
    },
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.createdBy,
  });
}

export function acknowledgeWarehousePrint(
  order: CustomerOrder,
  now: string,
): CustomerOrder {
  if (order.printBatch.status === "printed") return order;
  return {
    ...order,
    updatedAt: now,
    printBatch: {
      ...order.printBatch,
      status: "printed",
      printedAt: now,
    },
  };
}

export function cancelRemoteOrder(order: CustomerOrder, now: string): CustomerOrder {
  if (order.status !== "picking" || order.pickRequest.status !== "open") {
    throw new ValidationError("Only an open pick can be cancelled.");
  }
  return {
    ...order,
    status: "cancelled",
    updatedAt: now,
    pickRequest: {
      ...order.pickRequest,
      status: "cancelled",
    },
  };
}
