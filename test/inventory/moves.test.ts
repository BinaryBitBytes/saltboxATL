import { describe, it } from "mocha";
import { expect } from "chai";
import { moveQuantity } from "@/backend/server/inventory-ops";
import { applyInventoryMove } from "@/lib/inventory/move";
import type { CustomerOrder, ItemCube } from "@/lib/inventory-schema";
import { ValidationError } from "@/lib/validation/errors";
import { makeItem, makeLocation } from "../helpers";

const now = "2026-10-23T16:00:00.000Z";

function cube(sku: string, cubicInches: number): ItemCube {
  return {
    sku,
    description: sku,
    lengthInches: 1,
    widthInches: 1,
    heightInches: cubicInches,
    cubicInches,
    unitsPerCase: 1,
    cubedAt: now,
  };
}

describe("RF inventory moves", () => {
  it("moves quantity into a new bin and keeps the remainder in the source", () => {
    const source = makeLocation({ code: "A-01-01" });
    const destination = makeLocation({ code: "A-01-02" });
    const item = makeItem({ locationId: source.id, quantity: 10, batch: "B1" });
    const result = moveQuantity({
      items: [item],
      source: item,
      destinationLocationId: destination.id,
      quantity: 4,
      now,
    });

    const from = result.items.find((entry) => entry.id === item.id);
    const to = result.items.find(
      (entry) => entry.locationId === destination.id && entry.sku === item.sku,
    );
    expect(from?.quantity).to.equal(6);
    expect(to?.quantity).to.equal(4);
    expect(to?.batch).to.equal("B1");
    expect(result.changes.map((change) => change.quantityDelta)).to.deep.equal([-4, 4]);
    expect(result.changes[0]?.destinationLocationId).to.equal(destination.id);
    expect(result.changes.reduce((sum, change) => sum + change.quantityDelta, 0)).to.equal(0);
  });

  it("adds to the destination line that already holds the same SKU and batch", () => {
    const source = makeLocation({ code: "A-01-01" });
    const destination = makeLocation({ code: "B-02-02" });
    const item = makeItem({ locationId: source.id, quantity: 5, batch: null });
    const existing = makeItem({
      sku: item.sku,
      upc: item.upc,
      locationId: destination.id,
      quantity: 3,
      batch: null,
    });
    const otherBatch = makeItem({
      sku: item.sku,
      locationId: destination.id,
      quantity: 9,
      batch: "OTHER",
    });
    const result = moveQuantity({
      items: [item, existing, otherBatch],
      source: item,
      destinationLocationId: destination.id,
      quantity: 2,
      now,
    });
    expect(result.items.find((entry) => entry.id === existing.id)?.quantity).to.equal(5);
    expect(result.items.find((entry) => entry.id === otherBatch.id)?.quantity).to.equal(9);
    expect(result.items.filter((entry) => entry.sku === item.sku)).to.have.length(3);
  });

  it("rejects a move into the same bin or past the on-hand quantity", () => {
    const source = makeLocation({ code: "A-01-01" });
    const item = makeItem({ locationId: source.id, quantity: 2 });
    expect(() =>
      moveQuantity({
        items: [item],
        source: item,
        destinationLocationId: source.id,
        quantity: 1,
        now,
      }),
    ).to.throw(ValidationError, /different destination/i);
    expect(() =>
      moveQuantity({
        items: [item],
        source: item,
        destinationLocationId: makeLocation().id,
        quantity: 3,
        now,
      }),
    ).to.throw(ValidationError, /on-hand/i);
  });

  it("keeps reserved units in place and rejects a destination that cannot hold the cube", () => {
    const source = makeLocation({ code: "A-01-01", cubeCapacityCubicInches: 10_000 });
    const destination = makeLocation({ code: "A-01-02", cubeCapacityCubicInches: 150 });
    const item = makeItem({ locationId: source.id, quantity: 5 });
    const orders = [
      {
        status: "picking",
        lines: [{ inventoryItemId: item.id, quantity: 4 }],
      },
    ] as CustomerOrder[];

    expect(() =>
      applyInventoryMove(
        {
          inventoryItems: [item],
          locations: [source, destination],
          itemCubes: [cube(item.sku, 100)],
          customerOrders: orders,
        },
        {
          inventoryItemId: item.id,
          destinationLocationId: destination.id,
          quantity: 2,
          confirmLargeInput: false,
        },
        now,
      ),
    ).to.throw(ValidationError, /reserved/i);

    const moved = applyInventoryMove(
      {
        inventoryItems: [item],
        locations: [source, destination],
        itemCubes: [cube(item.sku, 100)],
        customerOrders: orders,
      },
      {
        inventoryItemId: item.id,
        destinationLocationId: destination.id,
        quantity: 1,
        confirmLargeInput: false,
      },
      now,
    );
    expect(moved.items.find((entry) => entry.id === item.id)?.quantity).to.equal(4);
    expect(
      moved.items.find((entry) => entry.locationId === destination.id)?.quantity,
    ).to.equal(1);

    const full = makeItem({ locationId: source.id, quantity: 2, sku: "BULK" });
    expect(() =>
      applyInventoryMove(
        {
          inventoryItems: [full],
          locations: [source, destination],
          itemCubes: [cube("BULK", 100)],
        },
        {
          inventoryItemId: full.id,
          destinationLocationId: destination.id,
          quantity: 2,
          confirmLargeInput: false,
        },
        now,
      ),
    ).to.throw(ValidationError, /too large/i);
  });

  it("rejects an inactive destination", () => {
    const source = makeLocation({ code: "A-01-01" });
    const destination = makeLocation({ code: "A-01-02", isActive: false });
    const item = makeItem({ locationId: source.id, quantity: 2 });
    expect(() =>
      applyInventoryMove(
        { inventoryItems: [item], locations: [source, destination] },
        {
          inventoryItemId: item.id,
          destinationLocationId: destination.id,
          quantity: 1,
          confirmLargeInput: false,
        },
        now,
      ),
    ).to.throw(ValidationError, /inactive/i);
  });
});
