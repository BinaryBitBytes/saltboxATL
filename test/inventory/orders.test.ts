import { describe, it } from "mocha";
import { expect } from "chai";
import { makeItem, makeLocation } from "../helpers";
import { ValidationError } from "@/lib/validation/errors";
import {
  assertAvailableQuantity,
  availableToOrder,
  reservedQuantity,
} from "@/lib/orders/availability";
import {
  buildOrderItemLabels,
  buildOrderLoadingSheet,
  buildOrderPackSlip,
  DEFAULT_WAREHOUSE_LABEL_PRINTER,
} from "@/lib/orders/documents";
import { applyOrderFulfillment } from "@/lib/orders/fulfill";
import {
  acknowledgeWarehousePrint,
  cancelRemoteOrder,
  nextOrderNumber,
  placeRemoteOrder,
} from "@/lib/orders/release";
import { mapCustomerOrder } from "@/backend/server/pg-mapper";
import type { CustomerOrder, InventoryItem, Location } from "@/lib/inventory-schema";

const NOW = "2026-10-06T15:00:00.000Z";

function place(input: {
  inventory: InventoryItem[];
  locations: Location[];
  lines: Array<{ inventoryItemId: string; quantity: number }>;
  existingOrders?: CustomerOrder[];
  customer?: string;
  now?: string;
}): CustomerOrder {
  return placeRemoteOrder({
    customer: input.customer ?? "North site",
    placedBy: "Casey User",
    createdBy: "Casey User",
    now: input.now ?? NOW,
    printerName: DEFAULT_WAREHOUSE_LABEL_PRINTER,
    existingOrders: input.existingOrders ?? [],
    inventory: input.inventory,
    locations: input.locations,
    lines: input.lines,
  });
}

describe("remote orders", () => {
  it("prints one label per item plus a pack slip and loading sheet, then opens a pick", () => {
    const location = makeLocation({ code: "A-01-01" });
    const fiber = makeItem({
      sku: "FBR-LC-12-100",
      locationId: location.id,
      quantity: 24,
      description: "12-strand LC fiber, 100m",
    });
    const copper = makeItem({
      sku: "CAT6-BLU-1000",
      upc: "010000000002",
      locationId: location.id,
      quantity: 10,
      description: "Cat6 blue 1000ft box",
    });
    const order = place({
      inventory: [fiber, copper],
      locations: [location],
      lines: [
        { inventoryItemId: fiber.id, quantity: 2 },
        { inventoryItemId: copper.id, quantity: 4 },
      ],
    });

    expect(order.status).to.equal("picking");
    expect(order.orderNumber).to.equal("ORD-20261006-001");
    expect(order.printBatch.printerName).to.equal(DEFAULT_WAREHOUSE_LABEL_PRINTER);
    expect(order.printBatch.status).to.equal("dispatched");
    expect(order.printBatch.itemLabelCount).to.equal(2);
    expect(order.printBatch.includesPackSlip).to.equal(true);
    expect(order.printBatch.includesLoadingSheet).to.equal(true);
    expect(order.printBatch.documents.map((doc) => doc.kind)).to.deep.equal([
      "item-label",
      "item-label",
      "pack-slip",
      "loading-sheet",
    ]);
    expect(order.pickRequest.status).to.equal("open");
    expect(order.pickRequest.requestNumber).to.equal("PK-20261006-001");
    expect(order.pickRequest.triggeredByPrintBatchId).to.equal(order.printBatch.id);
    expect(order.pickRequest.printerName).to.equal(order.printBatch.printerName);

    const locations = new Map([[location.id, location.code]]);
    const labels = buildOrderItemLabels(order, locations);
    const packSlip = buildOrderPackSlip(order, locations);
    const loadingSheet = buildOrderLoadingSheet(order, locations);
    expect(labels).to.have.length(order.lines.length);
    expect(labels.map((label) => label.title)).to.deep.equal([
      "FBR-LC-12-100",
      "CAT6-BLU-1000",
    ]);
    expect(labels[0].kind).to.equal("order");
    expect(packSlip.totalUnits).to.equal(6);
    expect(packSlip.totalLines).to.equal(2);
    expect(loadingSheet.totals.units).to.equal(6);
    expect(loadingSheet.locations[0].locationCode).to.equal("A-01-01");
    expect(loadingSheet.pickRequestNumber).to.equal(order.pickRequest.requestNumber);
  });

  it("reserves on-hand quantity so a second order cannot take the same units", () => {
    const location = makeLocation();
    const item = makeItem({ locationId: location.id, quantity: 5, sku: "FBR-LC-12-100" });
    const first = place({
      inventory: [item],
      locations: [location],
      lines: [{ inventoryItemId: item.id, quantity: 4 }],
    });
    expect(reservedQuantity([first], item.id)).to.equal(4);
    expect(availableToOrder(item.quantity, reservedQuantity([first], item.id))).to.equal(1);
    expect(() =>
      place({
        inventory: [item],
        locations: [location],
        existingOrders: [first],
        lines: [{ inventoryItemId: item.id, quantity: 2 }],
      }),
    ).to.throw(ValidationError, /reserved for open orders 4/);
    expect(() =>
      assertAvailableQuantity(item.quantity, 4, 2, item.sku, "ship"),
    ).to.throw(ValidationError, /unreserved/);
  });

  it("numbers orders for the same day in sequence", () => {
    const location = makeLocation();
    const item = makeItem({ locationId: location.id, quantity: 20 });
    const first = place({
      inventory: [item],
      locations: [location],
      lines: [{ inventoryItemId: item.id, quantity: 1 }],
    });
    const second = place({
      inventory: [item],
      locations: [location],
      existingOrders: [first],
      lines: [{ inventoryItemId: item.id, quantity: 1 }],
    });
    expect(nextOrderNumber([first, second], NOW)).to.equal("ORD-20261006-003");
    expect(second.orderNumber).to.equal("ORD-20261006-002");
  });

  it("releases a reservation on cancel and deducts on-hand when the pick is completed", () => {
    const location = makeLocation();
    const item = makeItem({ locationId: location.id, quantity: 8 });
    const order = place({
      inventory: [item],
      locations: [location],
      lines: [{ inventoryItemId: item.id, quantity: 3 }],
    });
    const cancelled = cancelRemoteOrder(order, NOW);
    expect(cancelled.status).to.equal("cancelled");
    expect(cancelled.pickRequest.status).to.equal("cancelled");
    expect(reservedQuantity([cancelled], item.id)).to.equal(0);

    const printed = acknowledgeWarehousePrint(order, NOW);
    expect(printed.printBatch.status).to.equal("printed");
    expect(printed.printBatch.printedAt).to.equal(NOW);
    expect(printed.pickRequest.status).to.equal("open");

    const fulfilled = applyOrderFulfillment({
      order: printed,
      items: [item],
      now: NOW,
      completedBy: "Jordan Associate",
    });
    expect(fulfilled.order.status).to.equal("fulfilled");
    expect(fulfilled.order.pickRequest.status).to.equal("completed");
    expect(fulfilled.items[0].quantity).to.equal(5);
    expect(fulfilled.changes[0].quantityDelta).to.equal(-3);
    expect(reservedQuantity([fulfilled.order], item.id)).to.equal(0);
  });

  it("maps a stored customer order row", () => {
    const location = makeLocation();
    const item = makeItem({ locationId: location.id, quantity: 6 });
    const order = place({
      inventory: [item],
      locations: [location],
      lines: [{ inventoryItemId: item.id, quantity: 1 }],
    });
    const mapped = mapCustomerOrder({
      id: order.id,
      order_number: order.orderNumber,
      customer: order.customer,
      placed_by: order.placedBy,
      notes: order.notes ?? null,
      status: order.status,
      submitted_at: order.submittedAt,
      lines: order.lines,
      print_batch: order.printBatch,
      pick_request: order.pickRequest,
      created_at: order.createdAt ?? null,
      updated_at: order.updatedAt ?? null,
      created_by: order.createdBy ?? null,
    });
    expect(mapped.pickRequest.requestNumber).to.equal(order.pickRequest.requestNumber);
    expect(mapped.printBatch.documents).to.have.length(3);
  });
});
