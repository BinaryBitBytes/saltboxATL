import { describe, it } from "mocha";
import { expect } from "chai";
import { createId } from "@/backend/server/helperUtils";
import {
  completeSlotAllocations,
  consumePickAllocations,
  pickAllocatedQuantity,
  planPickAllocation,
  releaseOpenAllocation,
  reportPicksAgainst,
  upsertSlotAllocation,
  withAllocationHolds,
} from "@/lib/allocation/workflow";
import { allocateReceivingLine } from "@/lib/cubing/receiving-line";
import type { PutawaySlot } from "@/lib/cubing/putaway-allocation";
import { applyInventoryMove } from "@/lib/inventory/move";
import type {
  CaseItem,
  CustomerOrder,
  InventoryAllocation,
  ReceivingOrder,
} from "@/lib/inventory-schema";
import { ValidationError } from "@/lib/validation/errors";
import { makeItem, makeLocation } from "../helpers";

const NOW = "2026-11-03T16:00:00.000Z";
const HOME = { division: "hyperscale", siteId: "site-alpha" };

function openPick(
  sku: string,
  quantity: number,
  orderNumber: string,
  submittedAt: string,
): CustomerOrder {
  return {
    id: createId(),
    orderNumber,
    status: "picking",
    submittedAt,
    pickRequest: { status: "open", requestNumber: orderNumber.replace("ORD", "PK") },
    lines: [
      {
        id: createId(),
        sku,
        quantity,
        batch: null,
        locationId: createId(),
      },
    ],
  } as CustomerOrder;
}

function slot(overrides: Partial<PutawaySlot> & Pick<PutawaySlot, "id" | "code">): PutawaySlot {
  return {
    roomId: "room-1",
    storageClass: "rack",
    division: HOME.division,
    siteId: HOME.siteId,
    zoneKey: "A",
    aisleKey: "A-1",
    zoneProjectId: null,
    zoneCubeSize: null,
    slotKind: "pick",
    isActive: true,
    cubeCapacityCubicInches: 400,
    committedCubicInches: 0,
    occupants: [],
    ...overrides,
  };
}

describe("allocation of received inventory", () => {
  it("reports the open picks a received SKU could fill, oldest order first", () => {
    const picks = reportPicksAgainst({
      sku: "CASE-SKU",
      batch: null,
      quantity: 5,
      orders: [
        openPick("OTHER", 9, "ORD-0", "2026-11-01T12:00:00.000Z"),
        openPick("CASE-SKU", 2, "ORD-2", "2026-11-02T12:00:00.000Z"),
        openPick("CASE-SKU", 4, "ORD-1", "2026-11-01T12:00:00.000Z"),
        {
          ...openPick("CASE-SKU", 3, "ORD-3", "2026-11-03T12:00:00.000Z"),
          status: "fulfilled",
        } as CustomerOrder,
      ],
    });
    expect(picks.map((pick) => [pick.orderNumber, pick.quantityCovered, pick.quantityNeeded])).to.deep.equal([
      ["ORD-1", 4, 4],
      ["ORD-2", 1, 2],
    ]);
  });

  it("allocates on-hand quantity and keeps a second request on the same line", () => {
    const item = makeItem({ sku: "CASE-SKU", quantity: 8, locationId: createId() });
    const orders = [openPick("CASE-SKU", 3, "ORD-1", NOW)];
    const allocations: InventoryAllocation[] = [];
    const first = planPickAllocation({
      item,
      orders,
      allocations,
      now: NOW,
      id: createId(),
    });
    expect(first.ok).to.equal(true);
    if (!first.ok) return;
    expect(first.created).to.equal(true);
    expect(first.allocation.kind).to.equal("pick");
    expect(first.allocation.quantity).to.equal(8);
    expect(first.allocation.locationId).to.equal(item.locationId);
    expect(first.allocation.picks[0]?.quantityCovered).to.equal(3);
    expect(pickAllocatedQuantity(allocations, item.id)).to.equal(8);

    const second = planPickAllocation({
      item,
      orders,
      allocations,
      quantity: 4,
      now: NOW,
      id: createId(),
    });
    expect(second.ok).to.equal(true);
    if (!second.ok) return;
    expect(second.created).to.equal(false);
    expect(allocations).to.have.length(1);
    expect(allocations[0]?.quantity).to.equal(4);
  });

  it("refuses to allocate quantity that open orders already hold", () => {
    const item = makeItem({ sku: "CASE-SKU", quantity: 4 });
    const order = openPick("CASE-SKU", 4, "ORD-1", NOW);
    order.lines[0]!.inventoryItemId = item.id;
    const plan = planPickAllocation({
      item,
      orders: [order],
      allocations: [],
      now: NOW,
      id: createId(),
    });
    expect(plan.ok).to.equal(false);
    if (plan.ok) return;
    expect(plan.error).to.match(/reserved for open orders 4/i);
  });

  it("blocks a move into a slotted location and a move of pick-allocated units", () => {
    const source = makeLocation({ code: "A-01" });
    const reserved = makeLocation({ code: "R-01" });
    const item = makeItem({ locationId: source.id, sku: "CASE-SKU", quantity: 6 });
    const slotHold = upsertSlotAllocation({
      allocations: [],
      order: { id: createId(), division: "hyperscale" } as ReceivingOrder,
      caseItem: {
        id: createId(),
        sku: "CASE-SKU",
        batch: null,
        quantityInCase: 2,
      } as CaseItem,
      locationId: reserved.id,
      orders: [],
      now: NOW,
      id: createId(),
    }).allocation;
    expect(() =>
      applyInventoryMove(
        {
          inventoryItems: [item],
          locations: [source, reserved],
          allocations: [slotHold],
        },
        {
          inventoryItemId: item.id,
          destinationLocationId: reserved.id,
          quantity: 1,
          confirmLargeInput: false,
        },
        NOW,
      ),
    ).to.throw(ValidationError, /reserved for putaway/i);

    const pick = planPickAllocation({
      item,
      orders: [],
      allocations: [],
      quantity: 5,
      now: NOW,
      id: createId(),
    });
    expect(pick.ok).to.equal(true);
    if (!pick.ok) return;
    const openBin = makeLocation({ code: "B-02" });
    expect(() =>
      applyInventoryMove(
        {
          inventoryItems: [item],
          locations: [source, openBin],
          allocations: [pick.allocation],
        },
        {
          inventoryItemId: item.id,
          destinationLocationId: openBin.id,
          quantity: 2,
          confirmLargeInput: false,
        },
        NOW,
      ),
    ).to.throw(ValidationError, /reserved for picks 5/i);

    const moved = applyInventoryMove(
      {
        inventoryItems: [item],
        locations: [source, openBin],
        allocations: [pick.allocation],
      },
      {
        inventoryItemId: item.id,
        destinationLocationId: openBin.id,
        quantity: 1,
        confirmLargeInput: false,
      },
      NOW,
    );
    expect(moved.items.find((entry) => entry.locationId === openBin.id)?.quantity).to.equal(1);
  });

  it("keeps a held shelf out of the next receiving direction until the slot allocation is finished", () => {
    const shelf = slot({ id: "shelf-1", code: "A-01", cubeCapacityCubicInches: 500 });
    const otherShelf = slot({ id: "shelf-2", code: "A-02", cubeCapacityCubicInches: 450 });
    const caseId = createId();
    const allocations = [
      {
        id: createId(),
        kind: "slot" as const,
        status: "open" as const,
        sku: "CASE-SKU",
        batch: null,
        quantity: 1,
        locationId: shelf.id,
        caseId,
        picks: [],
        createdAt: NOW,
      },
    ];
    const held = withAllocationHolds([shelf, otherShelf], allocations);
    const plan = allocateReceivingLine({
      quantity: 2,
      cubicInchesPerUnit: 100,
      fullPallet: false,
      projectId: "JOB-1",
      poNumber: "PO-1",
      sku: "CASE-SKU",
      batch: null,
      division: HOME.division,
      siteId: HOME.siteId,
      locations: held,
    });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.route).to.equal("shelf");
    expect(plan.slices.map((slice) => slice.locationId)).to.deep.equal(["shelf-2"]);

    completeSlotAllocations(allocations, new Set([caseId]), NOW);
    expect(allocations[0]?.status).to.equal("completed");
    const released = withAllocationHolds([shelf], allocations);
    expect(released[0]?.committedCubicInches).to.equal(0);
  });

  it("releases a pick allocation so the quantity can move again", () => {
    const source = makeLocation({ code: "A-01" });
    const destination = makeLocation({ code: "B-02" });
    const item = makeItem({ locationId: source.id, sku: "CASE-SKU", quantity: 3 });
    const allocations: InventoryAllocation[] = [];
    const plan = planPickAllocation({
      item,
      orders: [openPick("CASE-SKU", 2, "ORD-9", NOW)],
      allocations,
      now: NOW,
      id: createId(),
    });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    releaseOpenAllocation(allocations, plan.allocation.id, NOW);
    expect(pickAllocatedQuantity(allocations, item.id)).to.equal(0);
    const moved = applyInventoryMove(
      {
        inventoryItems: [item],
        locations: [source, destination],
        allocations,
      },
      {
        inventoryItemId: item.id,
        destinationLocationId: destination.id,
        quantity: 3,
        confirmLargeInput: false,
      },
      NOW,
    );
    expect(moved.items.find((entry) => entry.locationId === destination.id)?.quantity).to.equal(3);
  });

  it("finishes a pick allocation when that received stock is picked", () => {
    const item = makeItem({ sku: "CASE-SKU", quantity: 4 });
    const allocations: InventoryAllocation[] = [];
    const plan = planPickAllocation({
      item,
      orders: [],
      allocations,
      quantity: 4,
      now: NOW,
      id: createId(),
    });
    expect(plan.ok).to.equal(true);
    consumePickAllocations(allocations, item.id, 4, NOW);
    expect(allocations[0]?.status).to.equal("completed");
    expect(pickAllocatedQuantity(allocations, item.id)).to.equal(0);
  });
});
