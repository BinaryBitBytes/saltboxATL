import { describe, it } from "mocha";
import { expect } from "chai";
import {
  addQuantity,
  applyAdjustment,
  setOnHandQuantity,
} from "@/backend/server/inventory-ops";
import {
  buildInventoryCountReport,
  quantityAfterMatches,
  type InventoryCountReport,
} from "@/lib/inventory/count-math";
import {
  parseInventorySpreadsheet,
  planInventoryImport,
} from "@/lib/inventory/spreadsheet";
import { buildItemCatalog, queryItemReport } from "@/lib/reports/item-report";
import type { InventoryTransaction, InventoryTransactionType } from "@/lib/inventory-schema";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { makeItem, makeLocation } from "../helpers";
import { ValidationError } from "@/lib/validation/errors";
import type { StockChange } from "@/backend/server/inventory-ops";

const room = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Warehouse A",
};
const bin = makeLocation({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "A-01-01",
  roomId: room.id,
});
const damaged = makeLocation({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  code: "DMG-01",
  roomId: room.id,
});

function record(
  change: StockChange,
  type: InventoryTransactionType,
  occurredAt: string,
  referenceId = createId(),
): InventoryTransaction {
  return {
    id: createId(),
    type,
    occurredAt,
    sku: change.sku,
    upc: change.upc,
    batch: change.batch,
    inventoryItemId: change.inventoryItemId,
    locationId: change.locationId,
    destinationLocationId: change.destinationLocationId ?? null,
    quantityDelta: change.quantityDelta,
    quantityBefore: change.quantityBefore,
    quantityAfter: change.quantityAfter,
    referenceType: type === "import" ? "spreadsheet-import" : "adjustment",
    referenceId,
  };
}

function expectChange(change: StockChange, before: number, delta: number, after: number) {
  expect(change.quantityBefore).to.equal(before);
  expect(change.quantityDelta).to.equal(delta);
  expect(change.quantityAfter).to.equal(after);
  expect(quantityAfterMatches(change)).to.equal(true);
}

describe("inventory count transaction math", () => {
  it("keeps overage, shortage, damage, and import equal to before plus delta", () => {
    const started = makeItem({
      sku: "CBL-ORG-100",
      locationId: bin.id,
      quantity: 10,
      description: "orange cable",
    });
    let items = [started];
    const transactions: InventoryTransaction[] = [];

    const overage = applyAdjustment({
      items,
      target: items[0],
      type: "overage",
      quantity: 4,
      now: "2026-10-05T12:00:00.000Z",
    });
    items = overage.items;
    expectChange(overage.changes[0], 10, 4, 14);
    transactions.push(record(overage.changes[0], "overage", "2026-10-05T12:00:00.000Z"));

    const imported = setOnHandQuantity(items, {
      sku: started.sku,
      upc: started.upc,
      batch: started.batch,
      locationId: started.locationId,
      quantity: 20,
      now: "2026-10-05T12:01:00.000Z",
    });
    items = imported.items;
    expect(imported.change).to.not.equal(null);
    expectChange(imported.change!, 14, 6, 20);
    transactions.push(record(imported.change!, "import", "2026-10-05T12:01:00.000Z"));

    const shortage = applyAdjustment({
      items,
      target: items.find((item) => item.locationId === bin.id)!,
      type: "shortage",
      quantity: 2,
      now: "2026-10-05T12:02:00.000Z",
    });
    items = shortage.items;
    expectChange(shortage.changes[0], 20, -2, 18);
    transactions.push(record(shortage.changes[0], "shortage", "2026-10-05T12:02:00.000Z"));

    const writeOff = applyAdjustment({
      items,
      target: items.find((item) => item.locationId === bin.id)!,
      type: "damage",
      quantity: 1,
      now: "2026-10-05T12:03:00.000Z",
    });
    items = writeOff.items;
    expectChange(writeOff.changes[0], 18, -1, 17);
    expect(items.reduce((sum, item) => sum + item.quantity, 0)).to.equal(17);
    transactions.push(record(writeOff.changes[0], "damage", "2026-10-05T12:03:00.000Z"));

    const referenceId = createId();
    const moved = applyAdjustment({
      items,
      target: items.find((item) => item.locationId === bin.id)!,
      type: "damage",
      quantity: 3,
      now: "2026-10-05T12:04:00.000Z",
      damagedLocationId: damaged.id,
    });
    items = moved.items;
    expect(moved.changes).to.have.length(2);
    expectChange(moved.changes[0], 17, -3, 14);
    expectChange(moved.changes[1], 0, 3, 3);
    expect(moved.changes[0].quantityDelta + moved.changes[1].quantityDelta).to.equal(0);
    expect(items.reduce((sum, item) => sum + item.quantity, 0)).to.equal(17);
    transactions.push(
      record(moved.changes[0], "damage", "2026-10-05T12:04:00.000Z", referenceId),
      record(moved.changes[1], "damage", "2026-10-05T12:04:00.000Z", referenceId),
    );

    const report = buildInventoryCountReport({ items, transactions });
    expect(report.balanced).to.equal(true);
    expect(report.discrepancies).to.deep.equal([]);
    expect(report.onHand).to.equal(17);
    expect(report.movements.overage).to.equal(4);
    expect(report.movements.shortage).to.equal(-2);
    expect(report.movements.import).to.equal(6);
    expect(report.movements.damageWriteOff).to.equal(1);
    expect(report.movements.damageMoved).to.equal(3);
    expect(report.movements.damageNet).to.equal(-1);
    expect(items.find((item) => item.locationId === bin.id)?.quantity).to.equal(14);
    expect(items.find((item) => item.locationId === damaged.id)?.quantity).to.equal(3);
  });

  it("records a new overage from zero and an import that adds to the line", () => {
    const created = addQuantity([], {
      sku: "CBL-ORG-100",
      upc: "010000000088",
      batch: null,
      locationId: bin.id,
      quantity: 6,
      description: "orange cable",
      now: "2026-10-05T13:00:00.000Z",
    });
    expectChange(created.change, 0, 6, 6);

    const plan = planInventoryImport({
      rows: parseInventorySpreadsheet("SKU,Qty,Location\nCBL-ORG-100,5,A-01-01\n"),
      items: created.items,
      locations: [bin],
      rooms: [room],
      products: [],
      mode: "add",
    });
    expect(plan.errors).to.deep.equal([]);
    expect(plan.unitsDelta).to.equal(5);
    const applied = setOnHandQuantity(created.items, {
      sku: "CBL-ORG-100",
      batch: null,
      locationId: bin.id,
      quantity: plan.changes[0].quantityAfter,
      now: "2026-10-05T13:01:00.000Z",
    });
    expectChange(applied.change!, 6, 5, 11);
    expect(applied.change!.quantityDelta).to.equal(plan.unitsDelta);

    const report = buildInventoryCountReport({
      items: applied.items,
      transactions: [
        record(created.change, "overage", "2026-10-05T13:00:00.000Z"),
        record(applied.change!, "import", "2026-10-05T13:01:00.000Z"),
      ],
    });
    expect(report.balanced).to.equal(true);
    expect(report.onHand).to.equal(11);
    expect(report.movements.overage + report.movements.import).to.equal(11);
  });

  it("rejects a damage move into the same bin without changing the count", () => {
    const item = makeItem({ locationId: bin.id, quantity: 9 });
    expect(() =>
      applyAdjustment({
        items: [item],
        target: item,
        type: "damage",
        quantity: 2,
        now: nowIso(),
        damagedLocationId: bin.id,
      }),
    ).to.throw(ValidationError, /different bin/i);
    expect(item.quantity).to.equal(9);
  });

  it("flags a transaction whose after quantity does not match the line", () => {
    const item = makeItem({ quantity: 8, sku: "CBL-ORG-100" });
    const report: InventoryCountReport = buildInventoryCountReport({
      items: [item],
      transactions: [
        {
          id: createId(),
          type: "shortage",
          occurredAt: "2026-10-05T14:00:00.000Z",
          sku: item.sku,
          inventoryItemId: item.id,
          quantityBefore: 10,
          quantityDelta: -2,
          quantityAfter: 8,
          referenceId: createId(),
        },
        {
          id: createId(),
          type: "overage",
          occurredAt: "2026-10-05T14:01:00.000Z",
          sku: item.sku,
          inventoryItemId: item.id,
          quantityBefore: 8,
          quantityDelta: 5,
          quantityAfter: 12,
          referenceId: createId(),
        },
      ],
    });
    expect(report.balanced).to.equal(false);
    expect(report.discrepancies.map((entry) => entry.message).join(" ")).to.match(
      /on hand is 8/,
    );
  });

  it("counts on-hand units separately from received and shipped quantities", () => {
    const item = makeItem({
      sku: "CBL-ORG-100",
      locationId: bin.id,
      quantity: 14,
      description: "orange cable",
    });
    const catalog = buildItemCatalog({
      inventoryItems: [item],
      locations: [bin],
      rooms: [room],
      receivingOrders: [
        {
          id: createId(),
          poNumber: "PO-ORANGE",
          orderNumber: "RCV-ORANGE",
          status: "completed",
          pallets: [
            {
              id: createId(),
              palletNumber: "P1",
              cases: [
                {
                  id: createId(),
                  sku: "CBL-ORG-100",
                  upc: "010000000088",
                  batch: null,
                  quantityInCase: 10,
                  description: "orange cable",
                  putawayLocationId: bin.id,
                  putawayPostedAt: "2026-10-05T12:00:00.000Z",
                },
              ],
            },
          ],
        },
      ] as never,
      shippingOrders: [
        {
          id: createId(),
          shipmentNumber: "OUT-1",
          pallets: [
            {
              id: createId(),
              palletNumber: "OUT-1",
              cases: [
                {
                  id: createId(),
                  sku: "CBL-ORG-100",
                  upc: "010000000088",
                  quantityInCase: 3,
                  description: "orange cable",
                  putawayLocationId: bin.id,
                },
              ],
            },
          ],
        },
      ] as never,
    });
    const report = queryItemReport(catalog, { sku: "CBL-ORG" });
    expect(report.totals.onHandUnits).to.equal(14);
    expect(report.totals.units).to.equal(14);
    expect(report.totals.awaitingPutawayUnits).to.equal(0);
    expect(report.totals.shippedUnits).to.equal(3);
    expect(report.rows.some((row) => row.inboundState === "received")).to.equal(true);
  });
});
