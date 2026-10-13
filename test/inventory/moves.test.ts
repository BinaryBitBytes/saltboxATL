import { describe, it } from "mocha";
import { expect } from "chai";
import { putAwayCases } from "@/backend/server/inventory-ops";
import { nowIso } from "@/backend/server/helperUtils";
import { applyInventoryMove, consolidateInventoryLines } from "@/lib/moves/apply";
import {
  arriveSiteTransfer,
  createSiteTransferRecord,
  loadTransferPallet,
  unloadTransferLine,
} from "@/lib/moves/transfer";
import type { CaseItem, InventoryItem } from "@/lib/inventory-schema";
import { inventoryKey } from "@/lib/inventory/keys";
import { ValidationError } from "@/lib/validation/errors";
import { makeItem, makeLocation } from "../helpers";

const SLOT_CUBE = { sku: "FBR-LC-12-100", cubicInches: 100, unitsPerCase: 1 };

function onHand(items: Array<{ sku: string; quantity: number }>, sku: string) {
  return items.reduce((sum, item) => (item.sku === sku ? sum + item.quantity : sum), 0);
}

function liveAt(
  items: InventoryItem[],
  sku: string,
  locationId: string,
  projectId: string | null = null,
) {
  const key = inventoryKey(sku, null, locationId, projectId);
  return items.filter(
    (item) =>
      inventoryKey(item.sku, item.batch, item.locationId, item.projectId) === key &&
      item.quantity > 0,
  );
}

function makeCase(locationId: string, quantity = 4): CaseItem {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    upc: "010000000001",
    sku: "FBR-LC-12-100",
    batch: null,
    quantityInCase: quantity,
    description: "Fiber case",
    manufacturer: "",
    color: null,
    fiber: null,
    putawayRoomId: null,
    putawayLocationId: locationId,
    putawayPostedAt: null,
  };
}

describe("RF inventory moves", () => {
  const now = nowIso();

  it("moves stock to an empty location without project approval", () => {
    const sourceLocation = makeLocation({ code: "A-01-01" });
    const destination = makeLocation({ code: "A-01-02" });
    const item = makeItem({
      locationId: sourceLocation.id,
      quantity: 10,
      projectId: "JOB-100",
    });
    const moved = applyInventoryMove({
      items: [item],
      locations: [sourceLocation, destination],
      inventoryItemId: item.id,
      quantity: 4,
      destinationLocationId: destination.id,
      now,
    });
    const source = moved.items.find((entry) => entry.id === item.id);
    const landed = moved.items.find((entry) => entry.id === moved.destinationItemId);
    expect(source?.quantity).to.equal(6);
    expect(landed?.quantity).to.equal(4);
    expect(landed?.projectId).to.equal("JOB-100");
    expect(landed?.locationId).to.equal(destination.id);
    expect(moved.combined).to.equal(false);
  });

  it("blocks combining project-tracked stock until a manager approves it", () => {
    const origin = makeLocation({ code: "A-01-01" });
    const bin = makeLocation({ code: "A-01-02" });
    const source = makeItem({ locationId: origin.id, quantity: 6, projectId: "JOB-100" });
    const existing = makeItem({
      locationId: bin.id,
      quantity: 2,
      projectId: "JOB-100",
      sku: source.sku,
    });
    expect(() =>
      applyInventoryMove({
        items: [source, existing],
        locations: [origin, bin],
        inventoryItemId: source.id,
        quantity: 1,
        destinationLocationId: bin.id,
        now,
      }),
    ).to.throw(ValidationError, /administrative approval/i);

    const approved = applyInventoryMove({
      items: [source, existing],
      locations: [origin, bin],
      inventoryItemId: source.id,
      quantity: 1,
      destinationLocationId: bin.id,
      now,
      approveProjectCombine: true,
      approverIsAdmin: true,
    });
    expect(
      approved.items.find((entry) => entry.id === existing.id)?.quantity,
    ).to.equal(3);
  });

  it("requires a chosen project ID when consolidating mixed project stock", () => {
    const left = makeLocation({ code: "A-01-01" });
    const right = makeLocation({ code: "A-01-02" });
    const tracked = makeItem({ locationId: left.id, quantity: 4, projectId: "JOB-100" });
    const open = makeItem({ locationId: right.id, quantity: 8, projectId: null, sku: tracked.sku });
    expect(() =>
      consolidateInventoryLines({
        items: [tracked, open],
        locations: [left, right],
        destinationLocationId: right.id,
        lines: [
          { inventoryItemId: tracked.id, quantity: 4 },
          { inventoryItemId: open.id, quantity: 8 },
        ],
        now,
        approveProjectCombine: true,
        approverIsAdmin: true,
      }),
    ).to.throw(ValidationError, /project ID to keep/i);

    const kept = consolidateInventoryLines({
      items: [tracked, open],
      locations: [left, right],
      destinationLocationId: right.id,
      lines: [
        { inventoryItemId: tracked.id, quantity: 4 },
        { inventoryItemId: open.id, quantity: 8 },
      ],
      resultingProjectId: "JOB-100",
      now,
      approveProjectCombine: true,
      approverIsAdmin: true,
    });
    const destination = kept.items.find((entry) => entry.id === kept.destinationItemId);
    expect(destination?.quantity).to.equal(12);
    expect(destination?.projectId).to.equal("JOB-100");
  });

  it("consolidates untracked stock without administrative approval", () => {
    const left = makeLocation({ code: "A-01-01" });
    const right = makeLocation({ code: "B-01-01" });
    const first = makeItem({ locationId: left.id, quantity: 3, projectId: null });
    const second = makeItem({ locationId: right.id, quantity: 5, projectId: null, sku: first.sku });
    const consolidated = consolidateInventoryLines({
      items: [first, second],
      locations: [left, right],
      destinationLocationId: right.id,
      lines: [
        { inventoryItemId: first.id, quantity: 3 },
        { inventoryItemId: second.id, quantity: 5 },
      ],
      now,
    });
    expect(
      consolidated.items.find((entry) => entry.id === consolidated.destinationItemId)?.quantity,
    ).to.equal(8);
  });

  it("loads many pallets onto a trailer, arrives at the other building, and unloads only there", () => {
    const warehouseA = "11111111-1111-4111-8111-111111111111";
    const warehouseB = "22222222-2222-4222-8222-222222222222";
    const trailer = makeLocation({
      code: "TRL-01",
      roomId: warehouseA,
      storageClass: "container",
    });
    const bin = makeLocation({ code: "A-01-01", roomId: warehouseA });
    const otherBuilding = makeLocation({ code: "B-01-01", roomId: warehouseB });
    const wrongBin = makeLocation({ code: "A-01-02", roomId: warehouseA });
    const first = makeItem({ locationId: bin.id, quantity: 10, projectId: null });
    const second = makeItem({
      sku: "CAT6-BLU-1000",
      locationId: bin.id,
      quantity: 6,
      projectId: null,
    });
    const rooms = [
      { id: warehouseA, name: "Warehouse A" },
      { id: warehouseB, name: "Warehouse B" },
    ];
    const transfer = createSiteTransferRecord({
      transfers: [],
      locations: [trailer, bin, otherBuilding],
      rooms,
      trailerLocationId: trailer.id,
      fromRoomId: warehouseA,
      toRoomId: warehouseB,
      now,
    });
    const firstLoad = loadTransferPallet({
      transfer,
      items: [first, second],
      locations: [trailer, bin, otherBuilding],
      inventoryItemId: first.id,
      palletNumber: "P1",
      quantity: 4,
      now,
    });
    const secondLoad = loadTransferPallet({
      transfer: firstLoad.transfer,
      items: firstLoad.items,
      locations: [trailer, bin, otherBuilding],
      inventoryItemId: second.id,
      palletNumber: "P2",
      quantity: 2,
      now,
    });
    expect(secondLoad.transfer.pallets).to.have.length(2);
    expect(
      secondLoad.items
        .filter((item) => item.locationId === trailer.id)
        .reduce((sum, item) => sum + item.quantity, 0),
    ).to.equal(6);

    const arrived = arriveSiteTransfer({
      transfer: { ...secondLoad.transfer, status: "in-transit" },
      locations: [trailer, bin, otherBuilding, wrongBin],
      now,
    });
    expect(
      arrived.locations.find((location) => location.id === trailer.id)?.roomId,
    ).to.equal(warehouseB);

    const line = arrived.transfer.pallets[0]?.lines[0];
    expect(line).to.not.equal(undefined);
    expect(() =>
      unloadTransferLine({
        transfer: arrived.transfer,
        items: secondLoad.items,
        locations: arrived.locations,
        lineId: line!.id,
        destinationLocationId: wrongBin.id,
        quantity: 1,
        now,
      }),
    ).to.throw(ValidationError, /destination site/i);

    const unloaded = unloadTransferLine({
      transfer: arrived.transfer,
      items: secondLoad.items,
      locations: arrived.locations,
      lineId: line!.id,
      destinationLocationId: otherBuilding.id,
      quantity: line!.quantity,
      now,
    });
    expect(
      unloaded.items.find(
        (item) => item.locationId === otherBuilding.id && item.sku === first.sku,
      )?.quantity,
    ).to.equal(line!.quantity);
  });

  it("rejects putaway that combines existing project stock without approval", () => {
    const bin = makeLocation();
    const existing = makeItem({
      locationId: bin.id,
      quantity: 2,
      projectId: "JOB-100",
    });
    expect(() =>
      putAwayCases([existing], [makeCase(bin.id)], now, { projectId: "JOB-100" }),
    ).to.throw(ValidationError, /administrative approval/i);

    const posted = putAwayCases([existing], [makeCase(bin.id, 3)], now, {
      projectId: "JOB-100",
      allowProjectCombine: true,
    });
    expect(posted.items.find((item) => item.id === existing.id)?.quantity).to.equal(5);

    const freshBin = makeLocation({ code: "B-01-01" });
    const firstReceipt = putAwayCases([], [makeCase(freshBin.id, 2), makeCase(freshBin.id, 2)], now, {
      projectId: "JOB-200",
    });
    expect(firstReceipt.items.reduce((sum, item) => sum + item.quantity, 0)).to.equal(4);
    expect(firstReceipt.items[0]?.projectId).to.equal("JOB-200");
  });

  it("rejects a move that does not fit and states how many units the location can take", () => {
    const sourceLocation = makeLocation({ code: "A-01-01", cubeCapacityCubicInches: 10000 });
    const slot = makeLocation({ code: "A-02-01", cubeCapacityCubicInches: 500 });
    const item = makeItem({ locationId: sourceLocation.id, quantity: 10, projectId: null });
    let moved: ReturnType<typeof applyInventoryMove> | undefined;
    expect(() => {
      moved = applyInventoryMove({
        items: [item],
        locations: [sourceLocation, slot],
        inventoryItemId: item.id,
        quantity: 8,
        destinationLocationId: slot.id,
        now,
        cubes: [SLOT_CUBE],
      });
    }).to.throw(
      ValidationError,
      /Location A-02-01 can hold .* Entering 8 of FBR-LC-12-100 .* too large for the location\. It can take 5 more units of FBR-LC-12-100/,
    );
    expect(moved).to.equal(undefined);
    expect(item.quantity).to.equal(10);

    const exact = applyInventoryMove({
      items: [item],
      locations: [sourceLocation, slot],
      inventoryItemId: item.id,
      quantity: 5,
      destinationLocationId: slot.id,
      now,
      cubes: [SLOT_CUBE],
    });
    expect(onHand(exact.items, item.sku)).to.equal(10);
    expect(exact.changes.reduce((sum, change) => sum + change.quantityDelta, 0)).to.equal(0);
    expect(liveAt(exact.items, item.sku, slot.id)).to.have.length(1);
    expect(liveAt(exact.items, item.sku, slot.id)[0]?.quantity).to.equal(5);
  });

  it("counts stock already in the slot and directed cube when telling the user what still fits", () => {
    const sourceLocation = makeLocation({ code: "A-01-01", cubeCapacityCubicInches: 10000 });
    const slot = makeLocation({ code: "A-02-01", cubeCapacityCubicInches: 500 });
    const source = makeItem({ locationId: sourceLocation.id, quantity: 10, projectId: null });
    const occupying = makeItem({
      locationId: slot.id,
      quantity: 2,
      projectId: null,
      sku: source.sku,
    });
    expect(() =>
      applyInventoryMove({
        items: [source, occupying],
        locations: [sourceLocation, slot],
        inventoryItemId: source.id,
        quantity: 4,
        destinationLocationId: slot.id,
        now,
        cubes: [SLOT_CUBE],
      }),
    ).to.throw(ValidationError, /Entering 4 of FBR-LC-12-100 .* 3 more units of FBR-LC-12-100/);

    const openSlot = makeLocation({ code: "A-02-02", cubeCapacityCubicInches: 500 });
    expect(() =>
      applyInventoryMove({
        items: [source],
        locations: [sourceLocation, openSlot],
        inventoryItemId: source.id,
        quantity: 2,
        destinationLocationId: openSlot.id,
        now,
        cubes: [SLOT_CUBE],
        directedCubicInches: () => 400,
      }),
    ).to.throw(ValidationError, /Entering 2 of FBR-LC-12-100 .* 1 more unit of FBR-LC-12-100/);
  });

  it("rejects a consolidation that does not fit and keeps every source quantity", () => {
    const left = makeLocation({ code: "A-01-01", cubeCapacityCubicInches: 10000 });
    const right = makeLocation({ code: "A-02-01", cubeCapacityCubicInches: 500 });
    const first = makeItem({ locationId: left.id, quantity: 4, projectId: null });
    const second = makeItem({ locationId: right.id, quantity: 2, projectId: null, sku: first.sku });
    const third = makeItem({
      locationId: makeLocation().id,
      quantity: 4,
      projectId: null,
      sku: first.sku,
    });
    const before = [first, second, third].map((item) => item.quantity);
    expect(() =>
      consolidateInventoryLines({
        items: [first, second, third],
        locations: [left, right],
        destinationLocationId: right.id,
        lines: [
          { inventoryItemId: second.id, quantity: 2 },
          { inventoryItemId: first.id, quantity: 4 },
          { inventoryItemId: third.id, quantity: 4 },
        ],
        now,
        cubes: [SLOT_CUBE],
      }),
    ).to.throw(ValidationError, /Entering 8 of FBR-LC-12-100 .* 3 more units of FBR-LC-12-100/);
    expect([first, second, third].map((item) => item.quantity)).to.deep.equal(before);
  });

  it("consolidates only when the slot can hold the entry and does not duplicate quantity", () => {
    const left = makeLocation({ code: "A-01-01", cubeCapacityCubicInches: 10000 });
    const middle = makeLocation({ code: "A-01-02", cubeCapacityCubicInches: 10000 });
    const right = makeLocation({ code: "A-02-01", cubeCapacityCubicInches: 500 });
    const first = makeItem({ locationId: left.id, quantity: 2, projectId: null });
    const second = makeItem({ locationId: middle.id, quantity: 2, projectId: null, sku: first.sku });
    const consolidated = consolidateInventoryLines({
      items: [first, second],
      locations: [left, middle, right],
      destinationLocationId: right.id,
      lines: [
        { inventoryItemId: first.id, quantity: 2 },
        { inventoryItemId: second.id, quantity: 2 },
      ],
      now,
      cubes: [SLOT_CUBE],
    });
    expect(onHand(consolidated.items, first.sku)).to.equal(4);
    expect(consolidated.changes.reduce((sum, change) => sum + change.quantityDelta, 0)).to.equal(0);
    expect(liveAt(consolidated.items, first.sku, right.id)).to.have.length(1);
    expect(liveAt(consolidated.items, first.sku, right.id)[0]?.quantity).to.equal(4);
    expect(consolidated.items.filter((item) => item.quantity > 0)).to.have.length(1);
  });

  it("keeps a partial move and a merge from creating a second on-hand balance", () => {
    const origin = makeLocation({ code: "A-01-01" });
    const bin = makeLocation({ code: "A-01-02" });
    const source = makeItem({ locationId: origin.id, quantity: 10, projectId: null });
    const partial = applyInventoryMove({
      items: [source],
      locations: [origin, bin],
      inventoryItemId: source.id,
      quantity: 4,
      destinationLocationId: bin.id,
      now,
    });
    expect(onHand(partial.items, source.sku)).to.equal(10);
    expect(partial.items.find((item) => item.id === source.id)?.quantity).to.equal(6);
    expect(liveAt(partial.items, source.sku, bin.id)).to.have.length(1);
    expect(partial.changes.reduce((sum, change) => sum + change.quantityDelta, 0)).to.equal(0);

    const existing = partial.items.find((item) => item.locationId === bin.id)!;
    const merged = applyInventoryMove({
      items: partial.items,
      locations: [origin, bin],
      inventoryItemId: source.id,
      quantity: 6,
      destinationLocationId: bin.id,
      now,
    });
    expect(onHand(merged.items, source.sku)).to.equal(10);
    expect(merged.items.find((item) => item.id === source.id)?.quantity).to.equal(0);
    expect(liveAt(merged.items, source.sku, bin.id)).to.have.length(1);
    expect(liveAt(merged.items, source.sku, bin.id)[0]?.id).to.equal(existing.id);
    expect(liveAt(merged.items, source.sku, bin.id)[0]?.quantity).to.equal(10);
    expect(merged.items.filter((item) => item.id === existing.id)).to.have.length(1);
  });

  it("refuses a move that would leave two live lines for the same identity", () => {
    const origin = makeLocation({ code: "A-01-01" });
    const bin = makeLocation({ code: "A-01-02" });
    const source = makeItem({ locationId: origin.id, quantity: 4, projectId: null });
    const first = makeItem({ locationId: bin.id, quantity: 2, projectId: null, sku: source.sku });
    const duplicate = makeItem({ locationId: bin.id, quantity: 3, projectId: null, sku: source.sku });
    const quantities = [source, first, duplicate].map((item) => item.quantity);
    let moved: ReturnType<typeof applyInventoryMove> | undefined;
    expect(() => {
      moved = applyInventoryMove({
        items: [source, first, duplicate],
        locations: [origin, bin],
        inventoryItemId: source.id,
        quantity: 1,
        destinationLocationId: bin.id,
        now,
      });
    }).to.throw(ValidationError, /duplicate inventory/i);
    expect(moved).to.equal(undefined);
    expect([source, first, duplicate].map((item) => item.quantity)).to.deep.equal(quantities);
  });

  it("does not count a same-location project change as more cube in the slot", () => {
    const bin = makeLocation({ code: "A-01-01", cubeCapacityCubicInches: 300 });
    const item = makeItem({ locationId: bin.id, quantity: 4, projectId: "JOB-100" });
    const moved = applyInventoryMove({
      items: [item],
      locations: [bin],
      inventoryItemId: item.id,
      quantity: 4,
      destinationLocationId: bin.id,
      projectId: "JOB-200",
      now,
      approveProjectCombine: true,
      approverIsAdmin: true,
      cubes: [SLOT_CUBE],
    });
    expect(onHand(moved.items, item.sku)).to.equal(4);
    expect(moved.items.filter((entry) => entry.quantity > 0)).to.have.length(1);
    expect(moved.items.find((entry) => entry.quantity > 0)?.projectId).to.equal("JOB-200");
  });

  it("rejects a trailer load that would exceed the container and names how many units still fit", () => {
    const warehouseA = "11111111-1111-4111-8111-111111111111";
    const warehouseB = "22222222-2222-4222-8222-222222222222";
    const trailer = makeLocation({
      code: "TRL-01",
      roomId: warehouseA,
      storageClass: "container",
      cubeCapacityCubicInches: 500,
    });
    const bin = makeLocation({
      code: "A-01-01",
      roomId: warehouseA,
      cubeCapacityCubicInches: 10000,
    });
    const item = makeItem({ locationId: bin.id, quantity: 10, projectId: null });
    const transfer = createSiteTransferRecord({
      transfers: [],
      locations: [trailer, bin],
      rooms: [
        { id: warehouseA, name: "Warehouse A" },
        { id: warehouseB, name: "Warehouse B" },
      ],
      trailerLocationId: trailer.id,
      fromRoomId: warehouseA,
      toRoomId: warehouseB,
      now,
    });
    expect(() =>
      loadTransferPallet({
        transfer,
        items: [item],
        locations: [trailer, bin],
        inventoryItemId: item.id,
        palletNumber: "P1",
        quantity: 8,
        now,
        cubes: [SLOT_CUBE],
      }),
    ).to.throw(ValidationError, /TRL-01 can hold .* Entering 8 .* 5 more units/);
    expect(item.quantity).to.equal(10);
  });
});
