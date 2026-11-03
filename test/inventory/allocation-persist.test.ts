import { describe, it } from "mocha";
import { expect } from "chai";
import { createId } from "@/backend/server/helperUtils";
import { createSeedSystem, ensureSystemDefaults } from "@/backend/server/seed";
import { reconcilePersistedAllocations } from "@/lib/allocation/persist";
import { locationHeldByOther, pickAllocatedQuantity } from "@/lib/allocation/workflow";
import { applyInventoryMove } from "@/lib/inventory/move";
import type { CustomerOrder, InventoryAllocation, InventoryTransaction } from "@/lib/inventory-schema";
import { loadFacilityTransfer } from "@/lib/transfers/facility";
import { locationSiteId, scopeToSite } from "@/lib/sites/database";
import { ValidationError } from "@/lib/validation/errors";

const NOW = "2026-11-03T20:00:00.000Z";

function hold(overrides: Partial<InventoryAllocation> & Pick<InventoryAllocation, "kind" | "locationId">): InventoryAllocation {
  return {
    id: createId(),
    division: "hyperscale",
    status: "open",
    sku: "CAT6-BLU-1000",
    batch: null,
    quantity: 48,
    picks: [],
    createdAt: NOW,
    createdBy: "Avery Manager",
    ...overrides,
  };
}

describe("persisted allocation reconciliation", () => {
  it("drops a pick hold whose inventory line is gone so the bin can take stock again", () => {
    const system = createSeedSystem();
    const source = system.locations.find((location) => location.code === "A-01-01");
    const destination = system.locations.find((location) => location.code === "A-01-02");
    const item = system.inventoryItems.find((entry) => entry.locationId === source?.id);
    expect(source && destination && item).to.not.equal(undefined);
    system.allocations = [
      hold({
        kind: "pick",
        locationId: destination!.id,
        inventoryItemId: createId(),
        quantity: 10,
      }),
    ];
    expect(() =>
      applyInventoryMove(
        system,
        {
          inventoryItemId: item!.id,
          destinationLocationId: destination!.id,
          quantity: 1,
          confirmLargeInput: false,
        },
        NOW,
      ),
    ).to.throw(ValidationError, /reserved for picks/i);

    expect(reconcilePersistedAllocations(system, NOW)).to.equal(true);
    expect(system.allocations?.[0]?.status).to.equal("released");
    expect(locationHeldByOther(system.allocations, destination!.id)).to.equal(false);
    const moved = applyInventoryMove(
      system,
      {
        inventoryItemId: item!.id,
        destinationLocationId: destination!.id,
        quantity: 1,
        confirmLargeInput: false,
      },
      NOW,
    );
    expect(moved.items.find((entry) => entry.locationId === destination!.id)?.quantity).to.equal(1);
    expect(system.transactions.some((entry) => entry.type === "allocation-release")).to.equal(true);
    expect(reconcilePersistedAllocations(system, NOW)).to.equal(false);
  });

  it("shrinks a pick hold that is larger than on-hand and leaves the other site's hold alone", () => {
    const system = createSeedSystem();
    const item = system.inventoryItems.find((entry) => entry.sku === "CAT6-BLU-1000");
    expect(item).to.not.equal(undefined);
    item!.quantity = 10;
    system.customerOrders = [
      {
        status: "picking",
        lines: [{ inventoryItemId: item!.id, quantity: 4 }],
      } as CustomerOrder,
    ];
    const otherSite = hold({
      kind: "pick",
      locationId: createId(),
      inventoryItemId: createId(),
      quantity: 6,
      sku: "OTHER-SITE",
    });
    system.allocations = [
      hold({
        kind: "pick",
        locationId: item!.locationId,
        inventoryItemId: item!.id,
        quantity: 30,
      }),
      otherSite,
    ];

    expect(reconcilePersistedAllocations(system, NOW)).to.equal(true);
    const healed = system.allocations?.find((entry) => entry.inventoryItemId === item!.id);
    expect(healed?.status).to.equal("open");
    expect(healed?.quantity).to.equal(6);
    expect(pickAllocatedQuantity(system.allocations, item!.id)).to.equal(6);
    expect(system.allocations?.find((entry) => entry.id === otherSite.id)?.status).to.equal("open");
    expect(
      system.transactions.find((entry) => entry.type === "allocation-release")?.reason,
    ).to.match(/matches on-hand quantity/i);
  });

  it("releases a slot hold after the case is put away so the location cube is open", () => {
    const system = createSeedSystem();
    const destination = system.locations.find((location) => location.code === "A-01-02");
    const source = system.locations.find((location) => location.code === "FIBER-A1");
    const item = system.inventoryItems.find((entry) => entry.locationId === source?.id);
    const caseId = createId();
    expect(destination && item).to.not.equal(undefined);
    system.receivingOrders.push({
      id: createId(),
      division: "hyperscale",
      poNumber: "PO-STALE",
      receivedAt: NOW,
      vendor: "Test Vendor",
      orderNumber: "RCV-STALE",
      carrierInbound: "Test",
      receiverName: "Avery Manager",
      loadPalletCount: 1,
      status: "received",
      pallets: [
        {
          id: createId(),
          palletNumber: "P1",
          trackingNumber: "",
          isPartial: false,
          partialedBy: null,
          expectedSkuCount: 1,
          actualSkuCount: 1,
          expectedCaseCount: 1,
          actualCaseCount: 1,
          cubeRoute: null,
          cases: [
            {
              id: caseId,
              upc: "010000000001",
              sku: "FBR-LC-12-100",
              batch: null,
              quantityInCase: 2,
              description: "Posted case",
              putawayLocationId: destination!.id,
              putawayPostedAt: NOW,
            },
          ],
        },
      ],
    } as never);
    system.allocations = [
      hold({
        kind: "slot",
        sku: "FBR-LC-12-100",
        locationId: destination!.id,
        caseId,
        receivingOrderId: system.receivingOrders.at(-1)?.id,
        quantity: 2,
      }),
    ];
    expect(locationHeldByOther(system.allocations, destination!.id)).to.equal(true);

    expect(reconcilePersistedAllocations(system, NOW)).to.equal(true);
    expect(locationHeldByOther(system.allocations, destination!.id)).to.equal(false);
    const moved = applyInventoryMove(
      system,
      {
        inventoryItemId: item!.id,
        destinationLocationId: destination!.id,
        quantity: 1,
        confirmLargeInput: false,
      },
      NOW,
    );
    expect(moved.items.find((entry) => entry.locationId === destination!.id)?.quantity).to.equal(1);
  });

  it("keeps a facility transfer from taking pick-allocated units, then allows the free units after a stale hold is healed", () => {
    const system = createSeedSystem();
    const alpha = system.sites.find((site) => site.codename === "ALPHA" && site.division !== "security");
    const beta = system.sites.find((site) => site.codename === "BETA" && site.division !== "security");
    const fiber = system.inventoryItems.find((item) => item.sku === "FBR-LC-12-100");
    expect(alpha && beta && fiber).to.not.equal(undefined);
    expect(locationSiteId(system, system.locations.find((location) => location.id === fiber!.locationId)!)).to.equal(
      alpha!.id,
    );
    system.allocations = [
      hold({
        kind: "pick",
        sku: fiber!.sku,
        locationId: fiber!.locationId,
        inventoryItemId: fiber!.id,
        quantity: 20,
      }),
    ];
    expect(() =>
      loadFacilityTransfer(system, {
        actingSiteId: alpha!.id,
        inventoryItemId: fiber!.id,
        destinationSiteId: beta!.id,
        trailerCode: "TN000142",
        quantity: 10,
        loadedBy: "Riley Associate",
        now: NOW,
      }),
    ).to.throw(ValidationError, /Available: 4/);

    fiber!.quantity = 8;
    expect(reconcilePersistedAllocations(system, NOW)).to.equal(true);
    expect(pickAllocatedQuantity(system.allocations, fiber!.id)).to.equal(8);
    expect(() =>
      loadFacilityTransfer(system, {
        actingSiteId: alpha!.id,
        inventoryItemId: fiber!.id,
        destinationSiteId: beta!.id,
        trailerCode: "TN000143",
        quantity: 1,
        loadedBy: "Riley Associate",
        now: NOW,
      }),
    ).to.throw(ValidationError, /Available: 0/);

    system.allocations![0]!.status = "released";
    const loaded = loadFacilityTransfer(system, {
      actingSiteId: alpha!.id,
      inventoryItemId: fiber!.id,
      destinationSiteId: beta!.id,
      trailerCode: "TN000144",
      quantity: 4,
      loadedBy: "Riley Associate",
      now: NOW,
    });
    expect(loaded.lines[0]?.quantityLoaded).to.equal(4);
  });

  it("follows a pick onto a bin at another loaded site", () => {
    const system = createSeedSystem();
    const alpha = system.sites.find((site) => site.codename === "ALPHA" && site.division !== "security");
    const beta = system.sites.find((site) => site.codename === "BETA" && site.division !== "security");
    const fiber = system.inventoryItems.find((item) => item.sku === "FBR-LC-12-100");
    const betaLocation = system.locations.find(
      (location) => location.siteId === beta?.id && location.isActive,
    );
    expect(alpha && beta && fiber && betaLocation).to.not.equal(undefined);
    const previousLocationId = fiber!.locationId;
    fiber!.locationId = betaLocation!.id;
    system.allocations = [
      hold({
        kind: "pick",
        sku: fiber!.sku,
        locationId: previousLocationId,
        inventoryItemId: fiber!.id,
        quantity: 4,
      }),
    ];
    const alphaOnly = scopeToSite(structuredClone(system), alpha!.id);
    expect(alphaOnly.inventoryItems.some((item) => item.id === fiber!.id)).to.equal(false);

    expect(reconcilePersistedAllocations(system, NOW)).to.equal(true);
    const healed = system.allocations?.[0];
    expect(healed?.status).to.equal("open");
    expect(healed?.locationId).to.equal(betaLocation!.id);
    expect(locationHeldByOther(system.allocations, previousLocationId)).to.equal(false);
    expect(locationHeldByOther(system.allocations, betaLocation!.id)).to.equal(true);
    expect(system.transactions.some((entry) => entry.type === "allocation" && entry.quantityDelta === 0)).to.equal(
      true,
    );
  });

  it("keeps stock-log history when a stale hold is released", () => {
    const system = createSeedSystem();
    const destination = system.locations.find((location) => location.code === "A-01-02");
    expect(destination).to.not.equal(undefined);
    const marker = { id: "stock-log-marker" } as InventoryTransaction;
    const filler = Array.from({ length: 4999 }, (_, index) => ({ id: `stock-log-${index}` }) as InventoryTransaction);
    system.transactions = [...filler, marker];
    system.allocations = [
      hold({
        kind: "pick",
        locationId: destination!.id,
        inventoryItemId: createId(),
        quantity: 1,
      }),
    ];

    expect(reconcilePersistedAllocations(system, NOW)).to.equal(true);
    expect(system.transactions).to.have.length(5001);
    expect(system.transactions[0]?.type).to.equal("allocation-release");
    expect(system.transactions.some((entry) => entry.id === marker.id)).to.equal(true);
  });

  it("persists the heal when system defaults are applied", () => {
    const system = createSeedSystem();
    const destination = system.locations.find((location) => location.code === "A-01-02");
    expect(destination).to.not.equal(undefined);
    system.allocations = [
      hold({
        kind: "slot",
        locationId: destination!.id,
        caseId: createId(),
        quantity: 1,
        sku: "FBR-LC-12-100",
      }),
    ];
    expect(ensureSystemDefaults(system)).to.equal(true);
    expect(system.allocations?.[0]?.status).to.equal("released");
  });
});
