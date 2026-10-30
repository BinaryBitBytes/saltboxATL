import { describe, it } from "mocha";
import { expect } from "chai";
import { applyAdjustment, type StockChange } from "@/backend/server/inventory-ops";
import { createAdjustmentRecord } from "@/backend/server/inventory-service";
import {
  DAMAGE_ALREADY_HELD_MESSAGE,
  DAMAGE_LOG_HIGHLIGHT,
  DAMAGE_REPORT_ONLY_MESSAGE,
  DAMAGE_TAB_ONLY_MESSAGE,
  assertDamageReportedOnTab,
  buildDamageReport,
  damageChangeBalances,
  damageLogHighlight,
  type DamageTransactionLine,
} from "@/lib/inventory/damage";
import { ValidationError } from "@/lib/validation/errors";
import { makeItem, makeLocation } from "../helpers";

const NOW = "2026-10-30T15:00:00.000Z";
const LATER = "2026-10-30T16:00:00.000Z";

function damageLines(
  changes: StockChange[],
  referenceId: string,
  occurredAt = NOW,
): DamageTransactionLine[] {
  return changes.map((change, index) => ({
    id: `${referenceId.slice(0, 24)}${String(index + 1).padStart(12, "0")}`.slice(0, 36),
    type: "damage",
    occurredAt,
    sku: change.sku,
    quantityDelta: change.quantityDelta,
    quantityBefore: change.quantityBefore,
    quantityAfter: change.quantityAfter,
    locationId: change.locationId,
    destinationLocationId: change.destinationLocationId,
    referenceId,
    reason: "Crushed",
    createdBy: "Jordan Associate",
  }));
}

function onHand(items: Array<{ quantity: number }>): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

describe("damage transaction calculations", () => {
  it("writes off part of a line and records the before, delta, and after", () => {
    const item = makeItem({ quantity: 10 });
    const result = applyAdjustment({
      items: [item],
      target: item,
      type: "damage",
      quantity: 4,
      now: NOW,
    });

    expect(result.changes).to.have.length(1);
    const change = result.changes[0];
    expect(change.quantityBefore).to.equal(10);
    expect(change.quantityDelta).to.equal(-4);
    expect(change.quantityAfter).to.equal(6);
    expect(damageChangeBalances(change)).to.equal(true);
    expect(result.items.find((entry) => entry.id === item.id)?.quantity).to.equal(6);
    expect(onHand(result.items)).to.equal(6);
    expect(item.quantity).to.equal(10);
  });

  it("writes off the full on-hand quantity down to zero", () => {
    const item = makeItem({ quantity: 10 });
    const result = applyAdjustment({
      items: [item],
      target: item,
      type: "damage",
      quantity: 10,
      now: NOW,
    });

    expect(result.items[0]?.quantity).to.equal(0);
    expect(result.changes[0]).to.include({
      quantityBefore: 10,
      quantityDelta: -10,
      quantityAfter: 0,
    });
    expect(onHand(result.items)).to.equal(0);
  });

  it("applies a second write-off to the remaining quantity", () => {
    const item = makeItem({ quantity: 10 });
    const first = applyAdjustment({
      items: [item],
      target: item,
      type: "damage",
      quantity: 4,
      now: NOW,
    });
    const remaining = first.items.find((entry) => entry.id === item.id);
    if (!remaining) throw new Error("missing source line");
    const second = applyAdjustment({
      items: first.items,
      target: remaining,
      type: "damage",
      quantity: 2,
      now: LATER,
    });

    expect(second.items.find((entry) => entry.id === item.id)?.quantity).to.equal(4);
    expect(second.changes[0]).to.include({
      quantityBefore: 6,
      quantityDelta: -2,
      quantityAfter: 4,
    });
    expect(onHand(second.items)).to.equal(4);
  });

  it("rejects a damage quantity above on-hand, zero, or negative", () => {
    const item = makeItem({ quantity: 3 });
    expect(() =>
      applyAdjustment({
        items: [item],
        target: item,
        type: "damage",
        quantity: 4,
        now: NOW,
      }),
    ).to.throw(ValidationError, /not enough/i);
    expect(() =>
      applyAdjustment({
        items: [item],
        target: item,
        type: "damage",
        quantity: 0,
        now: NOW,
      }),
    ).to.throw(ValidationError, /at least 1/i);
    expect(() =>
      applyAdjustment({
        items: [item],
        target: item,
        type: "damage",
        quantity: -2,
        now: NOW,
      }),
    ).to.throw(ValidationError, /cannot be negative/i);
    expect(item.quantity).to.equal(3);
  });

  it("moves damaged units into a hold bin without changing total on-hand", () => {
    const source = makeLocation({ code: "A-01-01" });
    const hold = makeLocation({ code: "DMG-01" });
    const item = makeItem({
      locationId: source.id,
      quantity: 10,
      batch: "B1",
      manufacturer: "Corning",
      color: "blue",
    });
    const other = makeItem({ sku: "FBR-SC-6-50", quantity: 8, locationId: source.id });
    const result = applyAdjustment({
      items: [item, other],
      target: item,
      type: "damage",
      quantity: 3,
      now: NOW,
      damagedLocationId: hold.id,
    });

    const from = result.items.find((entry) => entry.id === item.id);
    const held = result.items.find(
      (entry) => entry.locationId === hold.id && entry.sku === item.sku,
    );
    expect(from?.quantity).to.equal(7);
    expect(held?.quantity).to.equal(3);
    expect(held?.batch).to.equal("B1");
    expect(held?.manufacturer).to.equal("Corning");
    expect(held?.color).to.equal("blue");
    expect(result.items.find((entry) => entry.id === other.id)?.quantity).to.equal(8);
    expect(onHand(result.items)).to.equal(onHand([item, other]));
    expect(result.changes.map((change) => change.quantityDelta)).to.deep.equal([-3, 3]);
    expect(result.changes.every(damageChangeBalances)).to.equal(true);
    expect(result.changes[0]?.destinationLocationId).to.equal(hold.id);
    expect(result.changes[1]?.locationId).to.equal(hold.id);
    expect(item.quantity).to.equal(10);
    expect(other.quantity).to.equal(8);
  });

  it("adds a hold move onto the matching batch and leaves a different batch alone", () => {
    const source = makeLocation({ code: "A-01-01" });
    const hold = makeLocation({ code: "DMG-01" });
    const item = makeItem({ locationId: source.id, quantity: 5, batch: null });
    const existing = makeItem({
      sku: item.sku,
      upc: item.upc,
      locationId: hold.id,
      quantity: 2,
      batch: null,
    });
    const otherBatch = makeItem({
      sku: item.sku,
      locationId: hold.id,
      quantity: 9,
      batch: "OTHER",
    });
    const result = applyAdjustment({
      items: [item, existing, otherBatch],
      target: item,
      type: "damage",
      quantity: 2,
      now: NOW,
      damagedLocationId: hold.id,
    });

    expect(result.items.find((entry) => entry.id === item.id)?.quantity).to.equal(3);
    expect(result.items.find((entry) => entry.id === existing.id)?.quantity).to.equal(4);
    expect(result.items.find((entry) => entry.id === otherBatch.id)?.quantity).to.equal(9);
    expect(result.changes[1]).to.include({
      inventoryItemId: existing.id,
      quantityBefore: 2,
      quantityDelta: 2,
      quantityAfter: 4,
    });
    expect(onHand(result.items)).to.equal(onHand([item, existing, otherBatch]));
  });

  it("refuses to move damaged units into the bin that already holds them", () => {
    const hold = makeLocation({ code: "DMG-01" });
    const item = makeItem({ locationId: hold.id, quantity: 4 });
    expect(() =>
      applyAdjustment({
        items: [item],
        target: item,
        type: "damage",
        quantity: 1,
        now: NOW,
        damagedLocationId: hold.id,
      }),
    ).to.throw(ValidationError, DAMAGE_ALREADY_HELD_MESSAGE);
    expect(item.quantity).to.equal(4);
  });

  it("counts a write-off once and reduces on-hand by that quantity", () => {
    const item = makeItem({ quantity: 10 });
    const posted = applyAdjustment({
      items: [item],
      target: item,
      type: "damage",
      quantity: 4,
      now: NOW,
    });
    const report = buildDamageReport([
      ...damageLines(posted.changes, "11111111-1111-4111-8111-111111111111"),
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "shipping",
        occurredAt: NOW,
        sku: item.sku,
        quantityDelta: -10,
        quantityBefore: 10,
        quantityAfter: 0,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: "overage",
        occurredAt: NOW,
        sku: item.sku,
        quantityDelta: 2,
        quantityBefore: 6,
        quantityAfter: 8,
      },
    ]);

    expect(report.events).to.have.length(1);
    expect(report.events[0]).to.include({
      disposition: "write-off",
      unitsDamaged: 4,
      unitsWrittenOff: 4,
      unitsHeld: 0,
      onHandDelta: -4,
      sku: item.sku,
      reason: "Crushed",
      actor: "Jordan Associate",
    });
    expect(report.totals).to.deep.equal({
      events: 1,
      unitsDamaged: 4,
      unitsWrittenOff: 4,
      unitsHeld: 0,
      onHandDelta: -4,
    });
  });

  it("counts a hold move once so the inbound row is not a second damage", () => {
    const source = makeLocation({ code: "A-01-01" });
    const hold = makeLocation({ code: "DMG-01" });
    const item = makeItem({ locationId: source.id, quantity: 10 });
    const posted = applyAdjustment({
      items: [item],
      target: item,
      type: "damage",
      quantity: 3,
      now: LATER,
      damagedLocationId: hold.id,
    });
    const referenceId = "44444444-4444-4444-8444-444444444444";
    const report = buildDamageReport(damageLines(posted.changes, referenceId, LATER));
    const event = report.events[0];

    expect(report.events).to.have.length(1);
    expect(event?.id).to.equal(referenceId);
    expect(event).to.include({
      disposition: "hold",
      unitsDamaged: 3,
      unitsWrittenOff: 0,
      unitsHeld: 3,
      onHandDelta: 0,
    });
    expect(event?.sourceLocationId).to.equal(source.id);
    expect(event?.holdLocationId).to.equal(hold.id);
    expect(
      posted.changes.reduce((sum, change) => sum + Math.abs(change.quantityDelta), 0),
    ).to.equal(6);
    expect(report.totals.onHandDelta).to.equal(0);
    expect(report.totals.unitsDamaged).to.equal(3);
  });

  it("totals a write-off and a hold as separate events", () => {
    const source = makeLocation({ code: "A-01-01" });
    const hold = makeLocation({ code: "DMG-01" });
    const item = makeItem({ locationId: source.id, quantity: 10 });
    const writtenOff = applyAdjustment({
      items: [item],
      target: item,
      type: "damage",
      quantity: 4,
      now: NOW,
    });
    const moved = applyAdjustment({
      items: [item],
      target: item,
      type: "damage",
      quantity: 2,
      now: LATER,
      damagedLocationId: hold.id,
    });
    const report = buildDamageReport([
      ...damageLines(writtenOff.changes, "55555555-5555-4555-8555-555555555555", NOW),
      ...damageLines(moved.changes, "66666666-6666-4666-8666-666666666666", LATER),
    ]);

    expect(report.events.map((event) => event.disposition)).to.deep.equal([
      "hold",
      "write-off",
    ]);
    expect(report.totals).to.deep.equal({
      events: 2,
      unitsDamaged: 6,
      unitsWrittenOff: 4,
      unitsHeld: 2,
      onHandDelta: -4,
    });
  });

  it("highlights only damage transactions in the logs", () => {
    expect(damageLogHighlight("damage")).to.equal(DAMAGE_LOG_HIGHLIGHT);
    for (const type of ["shortage", "overage", "move", "shipping", "receiving", "import"]) {
      expect(damageLogHighlight(type), type).to.equal(undefined);
    }
  });

  it("keeps damage reporting on the damages tab", async () => {
    expect(() => assertDamageReportedOnTab("damage", "damage-report")).not.to.throw();
    expect(() => assertDamageReportedOnTab("shortage", "adjustment")).not.to.throw();
    expect(() => assertDamageReportedOnTab("damage", "adjustment")).to.throw(
      ValidationError,
      DAMAGE_REPORT_ONLY_MESSAGE,
    );
    expect(() => assertDamageReportedOnTab("overage", "damage-report")).to.throw(
      ValidationError,
      DAMAGE_TAB_ONLY_MESSAGE,
    );

    try {
      await createAdjustmentRecord({
        type: "damage",
        quantity: 1,
        reason: "Crushed",
      });
      expect.fail("general adjustments cannot post damage");
    } catch (error) {
      expect((error as Error).message).to.equal(DAMAGE_REPORT_ONLY_MESSAGE);
    }

    try {
      await createAdjustmentRecord(
        { type: "shortage", quantity: 1, reason: "Missing" },
        "damage-report",
      );
      expect.fail("the damages tab cannot post a shortage");
    } catch (error) {
      expect((error as Error).message).to.equal(DAMAGE_TAB_ONLY_MESSAGE);
    }
  });
});
