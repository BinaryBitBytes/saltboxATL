import { describe, it } from "mocha";
import { expect } from "chai";
import { createId } from "@/backend/server/helperUtils";
import { DAMAGE_LOG_HIGHLIGHT } from "@/lib/inventory/damage";
import {
  ALLOCATION_LOG_HIGHLIGHT,
  RELEASE_LOG_HIGHLIGHT,
  allocationHistorySince,
  describeAllocationHistory,
  pushStockHistory,
  recordAllocationHistory,
  stockLogHighlight,
} from "@/lib/inventory/stock-log";
import { planPickAllocation, releaseOpenAllocation } from "@/lib/allocation/workflow";
import type { InventoryAllocation, InventorySystem } from "@/lib/inventory-schema";
import { makeItem, makeLocation } from "../helpers";

const NOW = "2026-11-03T18:00:00.000Z";

describe("stock log highlights", () => {
  it("keeps damage amber, allocations light blue, and releases light yellow", () => {
    expect(stockLogHighlight("damage")).to.equal(DAMAGE_LOG_HIGHLIGHT);
    expect(stockLogHighlight("allocation")).to.equal(ALLOCATION_LOG_HIGHLIGHT);
    expect(stockLogHighlight("allocation-release")).to.equal(RELEASE_LOG_HIGHLIGHT);
    expect(ALLOCATION_LOG_HIGHLIGHT).to.include("bg-sky-100");
    expect(RELEASE_LOG_HIGHLIGHT).to.include("bg-yellow-100");
    expect(stockLogHighlight("putaway")).to.equal(undefined);
    expect(stockLogHighlight("cube")).to.equal(undefined);
  });

  it("records an allocation and its release without changing on-hand", () => {
    const location = makeLocation({ code: "FIBER-A1" });
    const item = makeItem({ sku: "CASE-SKU", quantity: 8, locationId: location.id });
    const system = {
      locations: [location],
      allocations: [] as InventoryAllocation[],
      transactions: [],
    } as unknown as InventorySystem;
    const before = (system.allocations ?? []).map((entry) => ({ ...entry, picks: [...entry.picks] }));
    const plan = planPickAllocation({
      item,
      orders: [],
      allocations: system.allocations ?? [],
      quantity: 5,
      now: NOW,
      id: createId(),
      createdBy: "Avery",
    });
    expect(plan.ok).to.equal(true);
    const opened = recordAllocationHistory(system, before, NOW, "Avery");
    expect(opened).to.have.length(1);
    expect(opened[0]).to.include({
      type: "allocation",
      sku: "CASE-SKU",
      quantityDelta: 5,
      locationId: location.id,
      createdBy: "Avery",
    });
    expect(opened[0]?.reason).to.match(/Allocated 5 of CASE-SKU for picks at FIBER-A1/i);
    expect(opened[0]?.notes).to.match(/unchanged/i);

    const held = (system.allocations ?? []).map((entry) => ({ ...entry, picks: [...entry.picks] }));
    if (!plan.ok) return;
    releaseOpenAllocation(system.allocations, plan.allocation.id, NOW);
    const released = recordAllocationHistory(system, held, NOW, "Avery");
    expect(released[0]).to.include({
      type: "allocation-release",
      quantityDelta: -5,
    });
    expect(released[0]?.reason).to.match(/Released 5 of CASE-SKU/i);
    expect(system.transactions?.map((entry) => entry.type)).to.deep.equal([
      "allocation-release",
      "allocation",
    ]);
  });

  it("describes a slot that moves and a partial release", () => {
    const id = createId();
    const open = {
      id,
      kind: "slot",
      status: "open",
      sku: "CASE-SKU",
      batch: null,
      quantity: 4,
      locationId: "loc-a",
      picks: [],
      createdAt: NOW,
    } as InventoryAllocation;
    const moved = { ...open, locationId: "loc-b" };
    const events = allocationHistorySince([open], [moved]);
    expect(events.map((event) => event.quantity)).to.deep.equal([0]);
    expect(
      describeAllocationHistory(events[0]!, (locationId) => locationId ?? "missing"),
    ).to.match(/moved from loc-a to loc-b/i);

    const smaller = { ...open, quantity: 1 };
    const partial = allocationHistorySince([open], [smaller]);
    expect(partial[0]).to.include({ type: "allocation-release", quantity: 3 });

    const row = pushStockHistory({ transactions: [] }, {
      type: "cube",
      sku: "CASE-SKU",
      occurredAt: NOW,
      reason: "Cubed CASE-SKU.",
    });
    expect(row.quantityDelta).to.equal(0);
    expect(row.type).to.equal("cube");
  });
});
