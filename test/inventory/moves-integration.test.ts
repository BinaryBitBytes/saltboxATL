import { describe, it } from "mocha";
import { expect } from "chai";
import { createSeedSystem } from "@/backend/server/seed";
import { mergeDivision, scopeSystem } from "@/lib/divisions";
import { addLicensePlate, addStructuredLocation } from "@/lib/locations/hierarchy";
import { applyInventoryMove, findLocationForScan } from "@/lib/inventory/move";
import { parseScanCode } from "@/lib/scan-code";
import { ValidationError } from "@/lib/validation/errors";

const now = "2026-10-23T17:00:00.000Z";

function moveInput(inventoryItemId: string, destinationLocationId: string, quantity: number) {
  return {
    inventoryItemId,
    destinationLocationId,
    quantity,
    confirmLargeInput: false as const,
  };
}

describe("RF moves on the logistics address model", () => {
  it("resolves a structured bin scan and a legacy bin scan to seeded locations", () => {
    const system = createSeedSystem();
    const structured = parseScanCode("alpha-001-a03-12-a01");
    expect(structured.locationCode).to.equal("ALPHA-001-A03-12-A01");
    expect(structured.sku).to.equal(undefined);
    expect(findLocationForScan(system.locations, structured)?.slotKind).to.equal("pick");

    const legacy = parseScanCode("A-01-01");
    expect(legacy.locationCode).to.equal(undefined);
    expect(findLocationForScan(system.locations, legacy)?.code).to.equal("A-01-01");
  });

  it("moves Hyperscale stock onto the Alpha slot and leaves Security inventory in place", () => {
    const full = createSeedSystem();
    const securityBefore = full.inventoryItems.find((item) => item.sku === "SEC-CAM-01");
    expect(securityBefore?.quantity).to.equal(6);

    const hyperscale = scopeSystem(full, "hyperscale");
    const from = hyperscale.locations.find((location) => location.code === "A-01-01");
    const alpha = hyperscale.locations.find(
      (location) => location.code === "ALPHA-001-A03-12-A01",
    );
    const item = hyperscale.inventoryItems.find((entry) => entry.locationId === from?.id);
    expect(from && alpha && item).to.not.equal(undefined);
    expect(hyperscale.locations.some((location) => location.code === "SEC-A1")).to.equal(false);

    const moved = applyInventoryMove(
      hyperscale,
      moveInput(item!.id, alpha!.id, 2),
      now,
    );
    hyperscale.inventoryItems = moved.items;
    mergeDivision(full, hyperscale, "hyperscale");

    expect(
      full.inventoryItems.find(
        (entry) => entry.sku === "CAT6-BLU-1000" && entry.locationId === alpha!.id,
      )?.quantity,
    ).to.equal(2);
    expect(
      full.inventoryItems.find((entry) => entry.id === item!.id)?.quantity,
    ).to.equal(46);
    expect(full.inventoryItems.find((entry) => entry.sku === "SEC-CAM-01")?.quantity).to.equal(6);
    expect(full.locations.some((location) => location.code === "SEC-A1")).to.equal(true);
    expect(moved.changes[0]?.destinationLocationId).to.equal(alpha!.id);
  });

  it("refuses to move Hyperscale stock into a Security bin", () => {
    const system = createSeedSystem();
    const from = system.locations.find((location) => location.code === "A-01-01");
    const security = system.locations.find((location) => location.code === "SEC-A1");
    const item = system.inventoryItems.find((entry) => entry.locationId === from?.id);
    expect(() =>
      applyInventoryMove(system, moveInput(item!.id, security!.id, 1), now),
    ).to.throw(ValidationError, /one division/i);
  });

  it("moves stock into an overhead slot and carries a license plate only on a full move", () => {
    const system = createSeedSystem();
    const alphaBay = system.bays.find((entry) => {
      const aisle = system.aisles.find((candidate) => candidate.id === entry.aisleId);
      const zone = system.zones.find((candidate) => candidate.id === aisle?.zoneId);
      return zone?.letter === "A" && entry.number === 12;
    });
    expect(alphaBay).to.not.equal(undefined);
    const overhead = addStructuredLocation(system, {
      bayId: alphaBay!.id,
      slotKind: "overhead",
      height: "04",
      side: "A",
    });
    expect(overhead.code).to.equal("ALPHA-001-A03-12-04A");

    const from = system.locations.find((location) => location.code === "A-01-01");
    const item = system.inventoryItems.find((entry) => entry.locationId === from?.id);
    const plate = addLicensePlate(system, {
      division: "hyperscale",
      locationId: from!.id,
      code: "LPABCD1234",
    });
    item!.licensePlateId = plate.id;

    const partial = applyInventoryMove(system, moveInput(item!.id, overhead.id, 1), now);
    system.inventoryItems = partial.items;
    expect(plate.locationId).to.equal(from!.id);
    expect(partial.items.find((entry) => entry.id === item!.id)?.licensePlateId).to.equal(plate.id);
    expect(
      partial.items.find((entry) => entry.locationId === overhead.id)?.licensePlateId ?? null,
    ).to.equal(null);

    const remaining = partial.items.find((entry) => entry.id === item!.id);
    const full = applyInventoryMove(
      { ...system, inventoryItems: partial.items },
      moveInput(item!.id, overhead.id, remaining!.quantity),
      now,
    );
    expect(plate.locationId).to.equal(overhead.id);
    expect(plate.trailerId).to.equal(null);
    expect(full.items.find((entry) => entry.id === item!.id)?.licensePlateId ?? null).to.equal(
      null,
    );
    expect(
      full.items.find((entry) => entry.locationId === overhead.id && entry.sku === item!.sku)
        ?.licensePlateId,
    ).to.equal(plate.id);
  });
});
