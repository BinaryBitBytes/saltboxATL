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
import type { CaseItem } from "@/lib/inventory-schema";
import { ValidationError } from "@/lib/validation/errors";
import { makeItem, makeLocation } from "../helpers";

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
});
