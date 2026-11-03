import { describe, it } from "mocha";
import { expect } from "chai";
import { createId } from "@/backend/server/helperUtils";
import { createSeedSystem } from "@/backend/server/seed";
import {
  applyItemCube,
  applyLocationCapacity,
  applyPickAllocation,
  applySlotting,
  consumeAllocatedPicks,
  directReceivedCase,
  finishSlotHolds,
  logCompletedReceiving,
  logPartialPallet,
  logReopenedReceiving,
  releaseAllocationOnSystem,
} from "@/lib/inventory/logged-actions";
import {
  applyPartialInboundPallet,
  finishReceivingShipment,
} from "@/lib/inbound/receiving-transactions";
import { applyReopenAsPartial } from "@/lib/receiving/reopen";
import { applyZoneLocations, categorizeInventoryLines } from "@/lib/locations/zoning";
import { measureCaseCube } from "@/lib/cubing/measure";
import {
  CaseItemSchema,
  GenerateZoneLocationsInputSchema,
  InventoryTransactionSchema,
  PalletSchema,
  ReceivingOrderSchema,
  type InventorySystem,
  type ReceivingOrder,
} from "@/lib/inventory-schema";

const NOW = "2026-11-03T19:00:00.000Z";

function ofType(system: InventorySystem, type: string) {
  return (system.transactions ?? []).filter((entry) => entry.type === type);
}

function onHand(system: InventorySystem, sku: string) {
  return system.inventoryItems
    .filter((item) => item.sku === sku)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function receipt(
  system: InventorySystem,
  input: {
    sku: string;
    quantity: number;
    fullPallet?: boolean;
    orderNumber: string;
    expectedCaseCount?: number;
  },
): ReceivingOrder {
  const item = CaseItemSchema.parse({
    id: createId(),
    upc: "010000000001",
    sku: input.sku,
    quantityInCase: input.quantity,
    description: "Logged case",
    fullPallet: input.fullPallet ?? null,
  });
  const order = ReceivingOrderSchema.parse({
    id: createId(),
    division: "hyperscale",
    poNumber: `PO-${input.orderNumber}`,
    receivedAt: NOW,
    vendor: "Test Vendor",
    orderNumber: input.orderNumber,
    carrierInbound: "Test",
    receiverName: "Avery Manager",
    loadPalletCount: 1,
    status: "in-progress",
    intake: "expected",
    pallets: [
      PalletSchema.parse({
        id: createId(),
        palletNumber: "P1",
        expectedCaseCount: input.expectedCaseCount ?? 1,
        cases: [item],
      }),
    ],
    createdBy: "Avery Manager",
  });
  system.receivingOrders.push(order);
  return order;
}

describe("stock log behavior", () => {
  it("logs a pick allocation and its release without changing on-hand", () => {
    const system = createSeedSystem();
    const item = system.inventoryItems.find((entry) => entry.sku === "CAT6-BLU-1000");
    expect(item).to.not.equal(undefined);
    const before = onHand(system, "CAT6-BLU-1000");
    const allocation = applyPickAllocation(system, {
      inventoryItemId: item!.id,
      quantity: 1,
      createdBy: "Avery Manager",
    });
    const opened = ofType(system, "allocation");
    expect(opened[0]).to.include({
      sku: "CAT6-BLU-1000",
      quantityDelta: 1,
      locationId: item!.locationId,
      referenceId: allocation.id,
      createdBy: "Avery Manager",
    });
    expect(opened[0]?.reason).to.match(/Allocated 1 of CAT6-BLU-1000 for picks at A-01-01/i);
    expect(onHand(system, "CAT6-BLU-1000")).to.equal(before);

    releaseAllocationOnSystem(system, allocation.id);
    const released = ofType(system, "allocation-release")[0];
    expect(released).to.include({
      sku: "CAT6-BLU-1000",
      quantityDelta: -1,
      locationId: item!.locationId,
    });
    expect(released?.reason).to.match(/Released 1 of CAT6-BLU-1000/i);
    expect(onHand(system, "CAT6-BLU-1000")).to.equal(before);

    const second = applyPickAllocation(system, {
      inventoryItemId: item!.id,
      quantity: 2,
      createdBy: "Avery Manager",
    });
    consumeAllocatedPicks(system, [{ inventoryItemId: item!.id, quantity: 2 }], NOW, "Avery Manager");
    expect(ofType(system, "allocation-release")[0]?.reason).to.match(
      /Pick finished the allocation of 2 CAT6-BLU-1000/i,
    );
    expect(system.allocations?.find((entry) => entry.id === second.id)?.status).to.equal(
      "completed",
    );
    expect(onHand(system, "CAT6-BLU-1000")).to.equal(before);
    expect(InventoryTransactionSchema.array().parse(system.transactions)).to.have.length(
      system.transactions.length,
    );
  });

  it("logs receiving direction and a slot hold, and does not log the same direction twice", () => {
    const system = createSeedSystem();
    const before = onHand(system, "FBR-LC-12-100");
    const order = receipt(system, { sku: "FBR-LC-12-100", quantity: 2, orderNumber: "RCV-SHELF" });
    const slotted = applySlotting(system, {
      receivingOrderId: order.id,
      createdBy: "Avery Manager",
    });
    expect(slotted).to.have.length(1);
    const directed = ofType(system, "receiving-direct");
    expect(directed).to.have.length(1);
    expect(directed[0]?.quantityDelta).to.equal(2);
    expect(directed[0]?.reason).to.match(/shelf slot|rack slot/i);
    expect(directed[0]?.notes).to.match(/unchanged/i);
    const hold = ofType(system, "allocation")[0];
    expect(hold).to.include({
      sku: "FBR-LC-12-100",
      quantityDelta: 2,
      locationId: slotted[0]?.locationId,
      referenceType: "allocation",
    });
    expect(hold?.reason).to.match(/Slotted 2 of FBR-LC-12-100 for putaway/i);

    applySlotting(system, { receivingOrderId: order.id, createdBy: "Avery Manager" });
    expect(ofType(system, "receiving-direct")).to.have.length(1);
    expect(ofType(system, "allocation")).to.have.length(1);
    expect(onHand(system, "FBR-LC-12-100")).to.equal(before);
  });

  it("logs a full pallet direction and clears the slot hold when putaway finishes", () => {
    const system = createSeedSystem();
    const order = receipt(system, {
      sku: "FBR-LC-12-100",
      quantity: 56,
      fullPallet: true,
      orderNumber: "RCV-PALLET",
    });
    const slotted = applySlotting(system, {
      receivingOrderId: order.id,
      createdBy: "Avery Manager",
    });
    const directed = ofType(system, "receiving-direct")[0];
    expect(directed?.reason).to.match(/Full pallet of FBR-LC-12-100 directed to PLT-/i);
    expect(slotted[0]?.locationId).to.equal(directed?.locationId);

    const caseId = order.pallets[0]?.cases[0]?.id;
    expect(caseId).to.not.equal(undefined);
    finishSlotHolds(system, new Set([caseId!]), NOW, "Avery Manager");
    const released = ofType(system, "allocation-release")[0];
    expect(released?.quantityDelta).to.equal(-56);
    expect(released?.reason).to.match(/Putaway finished the slot reservation of 56 FBR-LC-12-100/i);
  });

  it("does not write another direction when the same line is directed again", () => {
    const system = createSeedSystem();
    const order = receipt(system, { sku: "FBR-LC-12-100", quantity: 2, orderNumber: "RCV-AGAIN" });
    const pallet = order.pallets[0]!;
    const item = pallet.cases[0]!;
    directReceivedCase(system, order, pallet, item, false);
    expect(ofType(system, "receiving-direct")).to.have.length(1);
    const saved = pallet.cases[0]!;
    directReceivedCase(system, order, pallet, saved, false);
    expect(ofType(system, "receiving-direct")).to.have.length(1);
  });

  it("logs completed receiving, a partial pallet, and a reopen", () => {
    const system = createSeedSystem();
    const order = receipt(system, { sku: "FBR-LC-12-100", quantity: 2, orderNumber: "RCV-DONE" });
    const finished = finishReceivingShipment(order, null, {
      acknowledgeBackorder: true,
      now: NOW,
    });
    expect(finished.ok, finished.ok ? "" : finished.error).to.equal(true);
    if (!finished.ok) return;
    logCompletedReceiving(system, order, finished.backorderLines, NOW);
    expect(ofType(system, "receiving")[0]?.reason).to.match(
      /Received 2 of FBR-LC-12-100 on RCV-DONE/i,
    );
    const short = receipt(system, {
      sku: "FBR-LC-12-100",
      quantity: 1,
      orderNumber: "RCV-SHORT",
      expectedCaseCount: 2,
    });
    const shortFinish = finishReceivingShipment(short, null, {
      acknowledgeBackorder: true,
      now: NOW,
    });
    expect(shortFinish.ok, shortFinish.ok ? "" : shortFinish.error).to.equal(true);
    if (!shortFinish.ok) return;
    logCompletedReceiving(system, short, shortFinish.backorderLines, NOW);
    expect(ofType(system, "receiving").some((entry) => /Backorder of 1/.test(entry.reason ?? ""))).to.equal(
      true,
    );

    const partialOrder = receipt(system, {
      sku: "FBR-LC-12-100",
      quantity: 1,
      orderNumber: "RCV-PART",
      expectedCaseCount: 2,
    });
    const partial = applyPartialInboundPallet({
      order: partialOrder,
      palletId: partialOrder.pallets[0]!.id,
      partialedBy: "Jordan Associate",
      expectedLines: [],
      now: NOW,
    });
    expect(partial.ok).to.equal(true);
    logPartialPallet(system, partialOrder, partialOrder.pallets[0]!.id, "Jordan Associate", NOW);
    expect(ofType(system, "partial-pallet")[0]?.reason).to.match(
      /Jordan Associate marked pallet P1 partial on RCV-PART/i,
    );

    partialOrder.status = "received";
    applyReopenAsPartial(partialOrder, "Avery Manager", NOW, 2);
    logReopenedReceiving(system, partialOrder, "Avery Manager", NOW);
    expect(ofType(system, "reopen-receiving")[0]?.reason).to.match(
      /Avery Manager reopened RCV-PART/i,
    );
  });

  it("logs cubing, location capacity, zone categories, and generated locations", () => {
    const system = createSeedSystem();
    const measured = measureCaseCube(12, 8, 4);
    applyItemCube(system, {
      sku: "CUBE-NEW",
      description: "New cube",
      ...measured,
      unitsPerCase: 2,
      cubedAt: NOW,
      cubedBy: "Avery Manager",
    });
    expect(ofType(system, "cube")[0]?.reason).to.match(/Cubed CUBE-NEW/i);
    expect(ofType(system, "cube")[0]?.createdBy).to.equal("Avery Manager");

    const location = system.locations.find((entry) => entry.code === "A-01-02");
    expect(location).to.not.equal(undefined);
    applyLocationCapacity(system, {
      id: location!.id,
      storageClass: "rack",
      cubeCapacityCubicInches: location!.cubeCapacityCubicInches,
      createdBy: "Avery Manager",
    });
    expect(ofType(system, "location-capacity")[0]).to.include({
      sku: "A-01-02",
      locationId: location!.id,
      quantityDelta: 0,
    });

    const zone = system.zones.find(
      (entry) => entry.letter === "A" && entry.division === "hyperscale",
    );
    const item = system.inventoryItems.find((entry) => entry.sku === "CAT6-BLU-1000");
    expect(zone && item).to.not.equal(undefined);
    const stockBefore = onHand(system, "CAT6-BLU-1000");
    categorizeInventoryLines(
      system,
      "hyperscale",
      { inventoryItemIds: [item!.id], zoneId: zone!.id },
      "Avery Manager",
    );
    expect(ofType(system, "zone")[0]?.reason).to.match(/Categorized CAT6-BLU-1000 into zone A/i);
    categorizeInventoryLines(
      system,
      "hyperscale",
      { inventoryItemIds: [item!.id], zoneId: null },
      "Avery Manager",
    );
    expect(ofType(system, "zone")[0]?.reason).to.match(/Cleared the zone category on CAT6-BLU-1000/i);
    expect(onHand(system, "CAT6-BLU-1000")).to.equal(stockBefore);

    const building = system.buildings.find((entry) => entry.division === "hyperscale");
    expect(building).to.not.equal(undefined);
    const generated = applyZoneLocations(
      system,
      "hyperscale",
      GenerateZoneLocationsInputSchema.parse({
        buildingId: building!.id,
        letter: "Z",
        itemType: "fiber",
        cubeSize: "medium",
        inboundVelocity: "fast",
        outboundVelocity: "slow",
        aisleFrom: 9,
        aisleTo: 9,
        bayFrom: 9,
        bayTo: 9,
        includePick: true,
        includeOverhead: false,
        pickHeightFrom: "A",
        pickHeightTo: "A",
        pickPositionFrom: 1,
        pickPositionTo: 1,
        overheadFrom: 4,
        overheadTo: 4,
        overheadSides: "A",
        storageClass: "rack",
      }),
      "Avery Manager",
    );
    expect(generated.created).to.be.greaterThan(0);
    const row = ofType(system, "zone-locations")[0];
    expect(row?.quantityDelta).to.equal(generated.created);
    expect(row?.reason).to.match(/Generated \d+ locations in zone Z/i);
    expect(row?.createdBy).to.equal("Avery Manager");
  });
});
