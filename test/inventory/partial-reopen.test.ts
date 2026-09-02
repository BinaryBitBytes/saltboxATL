import { describe, it } from "mocha";
import { expect } from "chai";
import type { CaseItem, Pallet, ReceivingOrder } from "@/lib/inventory-schema";
import {
  applyReopenAsPartial,
  canReopenClosedReceiving,
  casesPendingPutaway,
  defaultReopenExpectedPalletCount,
  hasPostedPutaway,
  isCasePutawayPosted,
  remainingExpectedPallets,
} from "@/lib/receiving/reopen";
import { isClosedReceiving, isReceivingEditable } from "@/lib/inventory-schema";
import { createId } from "@/backend/server/helperUtils";

function makeCase(overrides: Partial<CaseItem> = {}): CaseItem {
  return {
    id: createId(),
    upc: "010000000001",
    sku: "FBR-LC-12-100",
    batch: null,
    quantityInCase: 12,
    description: "Fiber case",
    manufacturer: "",
    color: null,
    fiber: null,
    putawayRoomId: null,
    putawayLocationId: null,
    putawayPostedAt: null,
    ...overrides,
  };
}

function makePallet(overrides: Partial<Pallet> = {}): Pallet {
  return {
    id: createId(),
    palletNumber: "1",
    trackingNumber: "",
    isPartial: false,
    partialedBy: null,
    expectedSkuCount: 1,
    actualSkuCount: 1,
    expectedCaseCount: 1,
    actualCaseCount: 1,
    cases: [makeCase()],
    ...overrides,
  };
}

function makeOrder(overrides: Partial<ReceivingOrder> = {}): ReceivingOrder {
  return {
    id: createId(),
    poNumber: "PO-1001",
    receivedAt: "2026-08-24T12:00:00.000Z",
    vendor: "Corning",
    orderNumber: "RCV-1",
    carrierInbound: "XPO",
    receiverName: "Jordan Associate",
    loadPalletCount: 4,
    status: "completed",
    isPartialed: false,
    workingPalletId: null,
    pallets: [makePallet()],
    notes: undefined,
    ...overrides,
  };
}

describe("partial PO reopen", () => {
  it("counts remaining expected pallets on an early-closed order", () => {
    const order = makeOrder({ loadPalletCount: 4, pallets: [makePallet()] });
    expect(remainingExpectedPallets(order)).to.equal(3);
    expect(defaultReopenExpectedPalletCount(order)).to.equal(4);
    expect(isClosedReceiving("completed")).to.equal(true);
    expect(isReceivingEditable("completed")).to.equal(false);
  });

  it("reopens a completed early-closed PO as partialed in-progress", () => {
    const posted = makeCase({
      putawayLocationId: createId(),
      putawayPostedAt: null,
    });
    const order = makeOrder({
      status: "completed",
      isPartialed: false,
      pallets: [makePallet({ cases: [posted] })],
    });
    const now = "2026-08-24T18:00:00.000Z";
    applyReopenAsPartial(order, "Avery Manager", now);

    expect(order.status).to.equal("in-progress");
    expect(order.isPartialed).to.equal(true);
    expect(order.partialedBy).to.equal("Avery Manager");
    expect(order.reopenedBy).to.equal("Avery Manager");
    expect(order.pallets[0]?.cases[0]?.putawayPostedAt).to.equal(now);
    expect(casesPendingPutaway(order)).to.have.length(0);
    expect(isCasePutawayPosted(order.pallets[0]!.cases[0]!)).to.equal(true);
  });

  it("lets a manager raise expected pallet count when the original count was already filled", () => {
    const order = makeOrder({
      status: "received",
      loadPalletCount: 1,
      pallets: [makePallet()],
    });
    expect(() => applyReopenAsPartial(order, "Avery Manager", "2026-08-24T18:00:00.000Z")).to.throw(
      /increase the expected pallet count/i,
    );
    expect(defaultReopenExpectedPalletCount(order)).to.equal(2);
    applyReopenAsPartial(order, "Avery Manager", "2026-08-24T18:00:00.000Z", 3);
    expect(order.loadPalletCount).to.equal(3);
    expect(order.status).to.equal("in-progress");
    expect(order.isPartialed).to.equal(true);
  });

  it("does not reopen draft or cancelled orders", () => {
    expect(() =>
      applyReopenAsPartial(
        makeOrder({ status: "draft" }),
        "Avery Manager",
        "2026-08-24T18:00:00.000Z",
      ),
    ).to.throw(/cannot be reopened/i);
    expect(() =>
      applyReopenAsPartial(
        makeOrder({ status: "cancelled" }),
        "Avery Manager",
        "2026-08-24T18:00:00.000Z",
      ),
    ).to.throw(/cannot be reopened/i);
  });

  it("keeps already posted cases out of a later putaway wave", () => {
    const posted = makeCase({ putawayPostedAt: "2026-08-24T12:00:00.000Z" });
    const pending = makeCase({ putawayPostedAt: null });
    const order = makeOrder({
      pallets: [makePallet({ cases: [posted, pending] })],
    });
    expect(casesPendingPutaway(order).map((item) => item.id)).to.deep.equal([
      pending.id,
    ]);
  });

  it("leaves awaiting-putaway cases unposted when reopening a received order", () => {
    const order = makeOrder({ status: "received" });
    applyReopenAsPartial(order, "Avery Manager", "2026-08-24T18:00:00.000Z");
    expect(order.status).to.equal("in-progress");
    expect(order.pallets[0]?.cases[0]?.putawayPostedAt).to.equal(null);
    expect(hasPostedPutaway(order)).to.equal(false);
    expect(casesPendingPutaway(order)).to.have.length(1);
  });

  it("only allows reopening received or completed orders", () => {
    expect(canReopenClosedReceiving({ status: "completed" })).to.equal(true);
    expect(canReopenClosedReceiving({ status: "received" })).to.equal(true);
    expect(canReopenClosedReceiving({ status: "in-progress" })).to.equal(false);
    expect(canReopenClosedReceiving({ status: "draft" })).to.equal(false);
    expect(canReopenClosedReceiving({ status: "cancelled" })).to.equal(false);
  });
});
