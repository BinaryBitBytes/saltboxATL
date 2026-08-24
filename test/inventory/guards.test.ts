import { describe, it } from "mocha";
import { expect } from "chai";
import {
  addQuantity,
  applyAdjustment,
  pickFromInventory,
  putAwayCases,
} from "@/backend/server/inventory-ops";
import {
  assertActiveLocation,
  assertUniquePicks,
} from "@/lib/validation/inventory-guards";
import { ValidationError } from "@/lib/validation/errors";
import { nowIso } from "@/backend/server/helperUtils";
import { makeItem, makeLocation } from "../helpers";

describe("inventory control safeguards", () => {
  it("blocks shipping more than on-hand quantity", () => {
    const item = makeItem({ quantity: 4 });
    expect(() =>
      pickFromInventory(
        [item],
        [{ inventoryItemId: item.id, quantity: 5 }],
        nowIso(),
      ),
    ).to.throw(ValidationError, /not enough/i);
  });

  it("prevents inventory from going negative and rejects zero/overflow adds", () => {
    const item = makeItem({ quantity: 2 });
    expect(() =>
      addQuantity([item], {
        sku: item.sku,
        upc: item.upc,
        batch: item.batch,
        locationId: item.locationId,
        quantity: 0,
        now: nowIso(),
      }),
    ).to.throw(ValidationError);

    const picked = pickFromInventory(
      [item],
      [{ inventoryItemId: item.id, quantity: 2 }],
      nowIso(),
    );
    expect(picked.remaining[0].quantity).to.equal(0);
  });

  it("blocks shortage adjustments larger than on-hand stock", () => {
    const item = makeItem({ quantity: 3 });
    expect(() =>
      applyAdjustment({
        items: [item],
        target: item,
        type: "shortage",
        quantity: 4,
        now: nowIso(),
      }),
    ).to.throw(ValidationError, /not enough/i);
  });

  it("requires putaway locations before cases can be put away", () => {
    expect(() =>
      putAwayCases(
        [],
        [
          {
            id: itemId(),
            upc: "010000000001",
            sku: "FBR-LC-12-100",
            batch: null,
            quantityInCase: 12,
            description: "Fiber",
            fiber: null,
            putawayRoomId: null,
            putawayLocationId: null,
            putawayPostedAt: null,
          },
        ],
        nowIso(),
      ),
    ).to.throw(/putaway location/i);
  });

  it("rejects inactive locations and duplicate shipment picks", () => {
    expect(() =>
      assertActiveLocation(makeLocation({ isActive: false }), "putaway"),
    ).to.throw(ValidationError, /inactive/i);

    const id = makeItem().id;
    expect(() =>
      assertUniquePicks([
        { inventoryItemId: id, quantity: 1 },
        { inventoryItemId: id, quantity: 2 },
      ]),
    ).to.throw(ValidationError, /duplicate/i);
  });
});

function itemId() {
  return "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
}
