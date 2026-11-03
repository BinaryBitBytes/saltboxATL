import { describe, it } from "mocha";
import { expect } from "chai";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { committedCubeForLocation } from "@/lib/cubing/capacity";
import {
  DEFAULT_PALLET_CUBE_CUBIC_INCHES,
  DEFAULT_RACK_CUBE_CUBIC_INCHES,
  measureCaseCube,
} from "@/lib/cubing/measure";
import {
  GenerateZoneLocationsInputSchema,
  InventorySystemSchema,
  type Division,
  type GenerateZoneLocationsInput,
  type InventorySystem,
  type ItemCube,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import {
  DEFAULT_BAY_CUBE_BUDGET,
  addAisle,
  addBay,
  addBuilding,
  addSite,
  addStructuredLocation,
  addZone,
} from "@/lib/locations/hierarchy";
import {
  compareBinCodes,
  parseBinCode,
  slotFitsBayCube,
} from "@/lib/locations/nomenclature";
import {
  applyZoneLocations,
  categorizeInventoryLines,
  NomenclatureError,
  planZoneLocations,
  resolveZoneCube,
} from "@/lib/locations/zoning";
import { makeItem } from "../helpers";

function emptySystem(): InventorySystem {
  return InventorySystemSchema.parse({});
}

function face(division: Division = "hyperscale", budget = 1_000_000) {
  const system = emptySystem();
  const site = addSite(system, {
    division,
    codename: "ALPHA",
    state: "GA",
    city: "Atlanta",
    name: "Alpha campus",
  });
  const building = addBuilding(system, { division, siteId: site.id, number: 1 });
  const zone = addZone(system, {
    division,
    buildingId: building.id,
    letter: "A",
    itemType: "fiber",
    cubeSize: "medium",
    inboundVelocity: "fast",
    outboundVelocity: "slow",
  });
  const aisle = addAisle(system, { division, zoneId: zone.id, number: 3 });
  const bay = addBay(system, {
    division,
    aisleId: aisle.id,
    number: 12,
    cubeBudgetCubicInches: budget,
  });
  return { system, site, building, zone, aisle, bay };
}

function request(
  buildingId: string,
  overrides: Partial<GenerateZoneLocationsInput> = {},
): GenerateZoneLocationsInput {
  return {
    buildingId,
    aisleFrom: 3,
    aisleTo: 3,
    bayFrom: 12,
    bayTo: 12,
    includePick: true,
    includeOverhead: false,
    pickHeightFrom: "A",
    pickHeightTo: "A",
    pickPositionFrom: 1,
    pickPositionTo: 2,
    overheadFrom: 4,
    overheadTo: 4,
    overheadSides: "both",
    storageClass: "rack",
    ...overrides,
  };
}

function warehouseStamp(system: InventorySystem) {
  return {
    zones: system.zones.map((zone) => ({
      id: zone.id,
      letter: zone.letter,
      buildingId: zone.buildingId,
    })),
    aisles: system.aisles.map((aisle) => ({
      id: aisle.id,
      zoneId: aisle.zoneId,
      number: aisle.number,
    })),
    bays: system.bays.map((bay) => ({
      id: bay.id,
      aisleId: bay.aisleId,
      number: bay.number,
      budget: bay.cubeBudgetCubicInches,
    })),
    locations: system.locations.map((location) => ({
      id: location.id,
      code: location.code,
      bayId: location.bayId ?? null,
      cube: location.cubeCapacityCubicInches,
      storageClass: location.storageClass,
      slotKind: location.slotKind ?? null,
      height: location.height ?? null,
      position: location.position ?? null,
      side: location.side ?? null,
    })),
  };
}

function itemCube(sku: string, cubicInches: number, unitsPerCase = 1): ItemCube {
  return {
    sku,
    description: "Cubed for zoning",
    lengthInches: 10,
    widthInches: 10,
    heightInches: cubicInches / 100,
    cubicInches,
    unitsPerCase,
    cubedAt: nowIso(),
  };
}

function receipt(input: {
  locationId: string;
  sku: string;
  quantityInCase: number;
  status?: ReceivingOrder["status"];
  posted?: boolean;
}): ReceivingOrder {
  return {
    id: createId(),
    poNumber: "PO-ZONE",
    receivedAt: nowIso(),
    vendor: "Vendor",
    orderNumber: "ORD-ZONE",
    carrierInbound: "Carrier",
    receiverName: "Receiver",
    loadPalletCount: 1,
    status: input.status ?? "received",
    pallets: [
      {
        id: createId(),
        palletNumber: "1",
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
            id: createId(),
            upc: "010000000001",
            sku: input.sku,
            batch: null,
            quantityInCase: input.quantityInCase,
            description: "Case",
            manufacturer: "",
            color: null,
            fiber: null,
            putawayRoomId: null,
            putawayLocationId: input.locationId,
            putawayPostedAt: input.posted ? nowIso() : null,
          },
        ],
      },
    ],
  } as ReceivingOrder;
}

function assertAppliedMatchesPlan(
  system: InventorySystem,
  division: Division,
  input: GenerateZoneLocationsInput,
) {
  const plan = planZoneLocations(system, division, input);
  const before = new Set(system.locations.map((location) => location.id));
  const result = applyZoneLocations(system, division, input);
  const created = system.locations.filter((location) => !before.has(location.id));
  const plannedCodes = plan.bays.flatMap((bay) => bay.drafts.map((draft) => draft.code));
  expect(created.map((location) => location.code)).to.deep.equal(plannedCodes);
  expect([...plannedCodes].sort(compareBinCodes)).to.deep.equal(plannedCodes);
  expect(result.created).to.equal(plannedCodes.length);
  expect(result.skipped).to.equal(plan.drafts.length - plannedCodes.length);
  expect(result.firstCode).to.equal(plannedCodes[0] ?? null);
  expect(result.lastCode).to.equal(plannedCodes.at(-1) ?? null);
  expect(result.cubeCapacityCubicInches).to.equal(plan.cubeCapacityCubicInches);
  expect(result.storageClass).to.equal(plan.storageClass);
  expect(result.zoneId).to.equal(
    plan.zoneId ?? system.zones.find((zone) => zone.letter === plan.letter)?.id,
  );
  for (const location of created) {
    expect(parseBinCode(location.code)).to.not.equal(null);
    expect(location.cubeCapacityCubicInches).to.equal(plan.cubeCapacityCubicInches);
    expect(location.storageClass).to.equal(plan.storageClass);
    expect(location.division).to.equal(division);
  }
  for (const bayPlan of plan.bays) {
    const aisle = system.aisles.find(
      (entry) => entry.zoneId === result.zoneId && entry.number === bayPlan.aisleNumber,
    );
    const bay = system.bays.find(
      (entry) => entry.aisleId === aisle?.id && entry.number === bayPlan.bayNumber,
    );
    expect(bay?.cubeBudgetCubicInches).to.equal(bayPlan.budget);
    const siblings = system.locations.filter((location) => location.bayId === bay?.id);
    const reserved = siblings.reduce(
      (sum, location) => sum + location.cubeCapacityCubicInches,
      0,
    );
    const stored = siblings.reduce(
      (sum, location) =>
        sum +
        committedCubeForLocation(
          location.id,
          system.inventoryItems,
          system.receivingOrders,
          system.itemCubes,
        ),
      0,
    );
    expect(
      slotFitsBayCube({
        bayCubeBudgetCubicInches: bay?.cubeBudgetCubicInches ?? 0,
        committedCubicInches: Math.max(reserved, stored),
        incomingCubicInches: 0,
      }),
    ).to.equal(true);
  }
  return { plan, result, created };
}

describe("zoning locations", () => {
  it("opens a pick range with the rack cube and skips bins that already exist", () => {
    const { system, building, zone, bay } = face();
    addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
    });
    const before = system.locations.length;
    const result = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, { zoneId: zone.id }),
    );
    expect(result.created).to.equal(1);
    expect(result.skipped).to.equal(1);
    expect(result.firstCode).to.equal("ALPHA-001-A03-12-A02");
    expect(result.cubeCapacityCubicInches).to.equal(DEFAULT_RACK_CUBE_CUBIC_INCHES);
    expect(system.locations).to.have.length(before + 1);
    expect(system.locations.at(-1)?.storageClass).to.equal("rack");
  });

  it("creates a new zone and sizes the bay budget to a measured case", () => {
    const { system, building } = face();
    const measured = measureCaseCube(10.01, 10, 10);
    const zonesBefore = system.zones.length;
    const result = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        letter: "B",
        itemType: "cable",
        cubeSize: "small",
        inboundVelocity: "medium",
        outboundVelocity: "fast",
        aisleFrom: 1,
        aisleTo: 1,
        bayFrom: 1,
        bayTo: 1,
        lengthInches: 10.01,
        widthInches: 10,
        heightInches: 10,
      }),
    );
    expect(system.zones).to.have.length(zonesBefore + 1);
    expect(system.zones.at(-1)?.itemType).to.equal("cable");
    expect(system.zones.at(-1)?.cubeSize).to.equal("small");
    expect(result.created).to.equal(2);
    expect(result.cubeCapacityCubicInches).to.equal(measured.cubicInches);
    expect(result.firstCode).to.equal("ALPHA-001-B01-01-A01");
    expect(result.lastCode).to.equal("ALPHA-001-B01-01-A02");
    const bay = system.bays.at(-1);
    expect(bay?.cubeBudgetCubicInches).to.equal(DEFAULT_BAY_CUBE_BUDGET);
    expect(bay?.cubeBudgetCubicInches).to.be.at.least(measured.cubicInches * 2);
  });

  it("uses an explicit cube capacity and the pallet class default", () => {
    expect(
      resolveZoneCube({ storageClass: "pallet", cubeCapacityCubicInches: 1200 }).cubeCapacityCubicInches,
    ).to.equal(1200);
    expect(resolveZoneCube({ storageClass: "pallet" }).cubeCapacityCubicInches).to.equal(
      DEFAULT_PALLET_CUBE_CUBIC_INCHES,
    );
    expect(() =>
      resolveZoneCube({
        storageClass: "rack",
        lengthInches: 10,
        widthInches: 10,
        heightInches: 10,
        cubeCapacityCubicInches: 100,
      }),
    ).to.throw(NomenclatureError, /not both/);
    expect(() => resolveZoneCube({ storageClass: "rack", lengthInches: 10 })).to.throw(
      NomenclatureError,
      /together/,
    );
  });

  it("rejects a range that would build more locations than one submit allows", () => {
    const { system, building, zone } = face();
    expect(() =>
      planZoneLocations(
        system,
        "hyperscale",
        request(building.id, {
          zoneId: zone.id,
          aisleFrom: 1,
          aisleTo: 20,
          bayFrom: 1,
          bayTo: 20,
          includePick: true,
          includeOverhead: true,
          pickHeightFrom: "A",
          pickHeightTo: "D",
          pickPositionFrom: 1,
          pickPositionTo: 9,
          overheadFrom: 4,
          overheadTo: 9,
          overheadSides: "both",
        }),
      ),
    ).to.throw(NomenclatureError, /480 or fewer/);
    expect(system.locations).to.have.length(0);
  });

  it("leaves the warehouse unchanged when the cube setting does not fit the bay", () => {
    const { system, building, zone } = face("hyperscale", 100);
    addStructuredLocation(system, {
      bayId: system.bays[0]!.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 60,
    });
    const snapshot = system.locations.length;
    expect(() =>
      applyZoneLocations(
        system,
        "hyperscale",
        request(building.id, {
          zoneId: zone.id,
          pickPositionFrom: 2,
          pickPositionTo: 2,
          cubeCapacityCubicInches: 50,
        }),
      ),
    ).to.throw(NomenclatureError, /cannot hold this cube setting/);
    expect(system.locations).to.have.length(snapshot);
  });

  it("raises an existing bay budget when the submitted cube setting needs it", () => {
    const { system, building, zone, bay } = face("hyperscale", 100);
    addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 60,
    });
    const result = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        zoneId: zone.id,
        pickPositionFrom: 2,
        pickPositionTo: 2,
        cubeCapacityCubicInches: 50,
        bayCubeBudgetCubicInches: 200,
      }),
    );
    expect(result.created).to.equal(1);
    expect(bay.cubeBudgetCubicInches).to.equal(200);
    expect(system.locations.at(-1)?.cubeCapacityCubicInches).to.equal(50);
  });

  it("does not add a zone when every location in the range already exists", () => {
    const { system, building } = face();
    const zonesBefore = system.zones.length;
    applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        letter: "C",
        itemType: "cable",
        cubeSize: "large",
        inboundVelocity: "slow",
        outboundVelocity: "slow",
        aisleFrom: 2,
        aisleTo: 2,
        bayFrom: 2,
        bayTo: 2,
      }),
    );
    expect(() =>
      applyZoneLocations(
        system,
        "hyperscale",
        request(building.id, {
          zoneId: system.zones.find((zone) => zone.letter === "C")?.id,
          aisleFrom: 2,
          aisleTo: 2,
          bayFrom: 2,
          bayTo: 2,
        }),
      ),
    ).to.throw(NomenclatureError, /already exists/);
    expect(system.zones).to.have.length(zonesBefore + 1);
  });

  it("rejects parameters outside the location schema", () => {
    const parsed = GenerateZoneLocationsInputSchema.safeParse({
      buildingId: "11111111-1111-4111-8111-111111111111",
      aisleFrom: 0,
      aisleTo: 1,
      bayFrom: 1,
      bayTo: 1,
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
    });
    expect(parsed.success).to.equal(false);
  });
});

describe("zoning categories", () => {
  it("assigns inventory lines to a zone and clears them", () => {
    const { system, zone, bay } = face();
    const location = addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
    });
    const item = makeItem({ locationId: location.id, division: "hyperscale" });
    system.inventoryItems = [item];
    expect(categorizeInventoryLines(system, "hyperscale", {
      inventoryItemIds: [item.id],
      zoneId: zone.id,
    })).to.equal(1);
    expect(item.zoneId).to.equal(zone.id);
    expect(categorizeInventoryLines(system, "hyperscale", {
      inventoryItemIds: [item.id],
      zoneId: zone.id,
    })).to.equal(0);
    expect(categorizeInventoryLines(system, "hyperscale", {
      inventoryItemIds: [item.id],
      zoneId: null,
    })).to.equal(1);
    expect(item.zoneId).to.equal(null);
  });

  it("refuses a zone that belongs to another site", () => {
    const { system, bay } = face();
    const location = addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "B",
      position: 1,
    });
    const otherSite = addSite(system, {
      division: "hyperscale",
      codename: "BETA",
      state: "GA",
      city: "Savannah",
      name: "Beta campus",
    });
    const otherBuilding = addBuilding(system, {
      division: "hyperscale",
      siteId: otherSite.id,
      number: 1,
    });
    const otherZone = addZone(system, {
      division: "hyperscale",
      buildingId: otherBuilding.id,
      letter: "A",
      itemType: "cable",
      cubeSize: "large",
      inboundVelocity: "slow",
      outboundVelocity: "slow",
    });
    const item = makeItem({ locationId: location.id, division: "hyperscale" });
    system.inventoryItems = [item];
    expect(() =>
      categorizeInventoryLines(system, "hyperscale", {
        inventoryItemIds: [item.id],
        zoneId: otherZone.id,
      }),
    ).to.throw(NomenclatureError, /another site/);
    expect(item.zoneId).to.equal(undefined);
  });
});

describe("zone generation transactions", () => {
  it("applies the same bins, cubes, and bay budgets the plan accepted", () => {
    const { system, building } = face();
    const input = GenerateZoneLocationsInputSchema.parse(
      request(building.id, {
        letter: "E",
        itemType: "optic",
        cubeSize: "pallet",
        projectId: "PRJ-9",
        poNumber: "PO-9",
        inboundVelocity: "fast",
        outboundVelocity: "medium",
        aisleFrom: 4,
        aisleTo: 5,
        bayFrom: 1,
        bayTo: 2,
        pickPositionFrom: 1,
        pickPositionTo: 1,
        includeOverhead: true,
        overheadFrom: 4,
        overheadTo: 4,
        overheadSides: "A",
        storageClass: "pallet",
        cubeCapacityCubicInches: 1200,
        bayCubeBudgetCubicInches: 3000,
      }),
    );
    const { plan, result, created } = assertAppliedMatchesPlan(system, "hyperscale", input);
    expect(plan.drafts.every((draft) => !draft.exists)).to.equal(true);
    expect(created.map((location) => location.code)).to.deep.equal([
      "ALPHA-001-E04-01-A01",
      "ALPHA-001-E04-01-04A",
      "ALPHA-001-E04-02-A01",
      "ALPHA-001-E04-02-04A",
      "ALPHA-001-E05-01-A01",
      "ALPHA-001-E05-01-04A",
      "ALPHA-001-E05-02-A01",
      "ALPHA-001-E05-02-04A",
    ]);
    expect(result.created).to.equal(8);
    expect(result.skipped).to.equal(0);
    const zone = system.zones.find((entry) => entry.id === result.zoneId);
    expect(zone?.letter).to.equal("E");
    expect(zone?.projectId).to.equal("PRJ-9");
    expect(zone?.poNumber).to.equal("PO-9");
    for (const bayPlan of plan.bays) {
      expect(bayPlan.budget).to.equal(3000);
      expect(bayPlan.incoming).to.equal(2400);
    }
  });

  it("accepts slots when stored cube already exceeds reserved capacity", () => {
    const { system, building, zone, bay } = face("hyperscale", 1000);
    const occupied = addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 100,
    });
    const item = makeItem({
      locationId: occupied.id,
      division: "hyperscale",
      quantity: 18,
      sku: "FBR-LC-12-100",
    });
    system.inventoryItems = [item];
    system.itemCubes = [itemCube(item.sku, 100, 2)];
    system.receivingOrders = [
      receipt({
        locationId: occupied.id,
        sku: item.sku,
        quantityInCase: 20,
        posted: true,
      }),
    ];
    const stored = committedCubeForLocation(
      occupied.id,
      system.inventoryItems,
      system.receivingOrders,
      system.itemCubes,
    );
    expect(stored).to.equal(900);
    const input = request(building.id, {
      zoneId: zone.id,
      pickPositionFrom: 2,
      pickPositionTo: 3,
      cubeCapacityCubicInches: 80,
    });
    const plan = planZoneLocations(system, "hyperscale", input);
    expect(plan.bays[0]?.incoming).to.equal(160);
    expect(Math.max(100, stored) + (plan.bays[0]?.incoming ?? 0)).to.be.greaterThan(
      plan.bays[0]?.budget ?? 0,
    );
    const { created } = assertAppliedMatchesPlan(system, "hyperscale", input);
    expect(created.map((location) => location.code)).to.deep.equal([
      "ALPHA-001-A03-12-A02",
      "ALPHA-001-A03-12-A03",
    ]);
    const reserved = system.locations
      .filter((location) => location.bayId === bay.id)
      .reduce((sum, location) => sum + location.cubeCapacityCubicInches, 0);
    expect(reserved).to.equal(260);
    expect(Math.max(reserved, stored)).to.equal(900);
    expect(system.bays.find((entry) => entry.id === bay.id)?.cubeBudgetCubicInches).to.equal(
      1000,
    );
    expect(item.quantity).to.equal(18);
    expect(item.locationId).to.equal(occupied.id);

    const cubes = system.locations.map((location) => [
      location.id,
      location.cubeCapacityCubicInches,
    ]);
    const budgets = system.bays.map((entry) => [entry.id, entry.cubeBudgetCubicInches]);
    expect(() => applyZoneLocations(system, "hyperscale", input)).to.throw(
      NomenclatureError,
      /already exists/,
    );
    expect(
      system.locations.map((location) => [location.id, location.cubeCapacityCubicInches]),
    ).to.deep.equal(cubes);
    expect(system.bays.map((entry) => [entry.id, entry.cubeBudgetCubicInches])).to.deep.equal(
      budgets,
    );
  });

  it("refuses the whole range when a later bay fails the cube check", () => {
    const draft = face("hyperscale", 1000);
    const open = addBay(draft.system, {
      division: "hyperscale",
      aisleId: draft.aisle.id,
      number: 13,
      cubeBudgetCubicInches: 1000,
    });
    const occupied = addStructuredLocation(draft.system, {
      bayId: open.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 100,
    });
    const sku = "FBR-LC-12-100";
    draft.system.itemCubes = [itemCube(sku, 100, 2)];
    draft.system.receivingOrders = [
      receipt({
        locationId: occupied.id,
        sku,
        quantityInCase: 20,
        status: "draft",
      }),
    ];
    expect(
      committedCubeForLocation(
        occupied.id,
        draft.system.inventoryItems,
        draft.system.receivingOrders,
        draft.system.itemCubes,
      ),
    ).to.equal(0);
    const draftInput = request(draft.building.id, {
      zoneId: draft.zone.id,
      bayFrom: 12,
      bayTo: 13,
      pickPositionFrom: 2,
      pickPositionTo: 3,
      cubeCapacityCubicInches: 80,
    });
    const drafted = assertAppliedMatchesPlan(draft.system, "hyperscale", draftInput);
    expect(drafted.created).to.have.length(4);

    const { system, building, zone, aisle } = face("hyperscale", 1000);
    const later = addBay(system, {
      division: "hyperscale",
      aisleId: aisle.id,
      number: 13,
      cubeBudgetCubicInches: 1000,
    });
    const stocked = addStructuredLocation(system, {
      bayId: later.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 100,
    });
    system.itemCubes = [itemCube(sku, 100, 2)];
    system.receivingOrders = [
      receipt({ locationId: stocked.id, sku, quantityInCase: 20 }),
    ];
    expect(
      committedCubeForLocation(
        stocked.id,
        system.inventoryItems,
        system.receivingOrders,
        system.itemCubes,
      ),
    ).to.equal(1000);
    const before = warehouseStamp(system);
    expect(() =>
      applyZoneLocations(
        system,
        "hyperscale",
        request(building.id, {
          zoneId: zone.id,
          bayFrom: 12,
          bayTo: 13,
          pickPositionFrom: 2,
          pickPositionTo: 3,
          cubeCapacityCubicInches: 80,
        }),
      ),
    ).to.throw(NomenclatureError, /Bay 13 in aisle 03 cannot hold this cube setting/);
    expect(warehouseStamp(system)).to.deep.equal(before);
    expect(system.locations.some((location) => location.code.endsWith("-A02"))).to.equal(false);
  });

  it("rolls back earlier bays when a later slot identity already exists", () => {
    const { system, building, zone, aisle, bay } = face("hyperscale", 100);
    const legacy = addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 40,
    });
    legacy.code = "LEGACY-SLOT";
    const item = makeItem({
      locationId: legacy.id,
      division: "hyperscale",
      quantity: 4,
    });
    system.inventoryItems = [item];
    const before = warehouseStamp(system);
    const input = request(building.id, {
      zoneId: zone.id,
      bayFrom: 11,
      bayTo: 12,
      pickPositionFrom: 1,
      pickPositionTo: 1,
      cubeCapacityCubicInches: 30,
      bayCubeBudgetCubicInches: 500,
    });
    expect(planZoneLocations(system, "hyperscale", input).bays).to.have.length(2);
    expect(() => applyZoneLocations(system, "hyperscale", input)).to.throw(
      NomenclatureError,
      /Slot A01 already exists in this bay/,
    );
    expect(warehouseStamp(system)).to.deep.equal(before);
    expect(system.bays.find((entry) => entry.id === bay.id)?.cubeBudgetCubicInches).to.equal(100);
    expect(system.aisles.find((entry) => entry.id === aisle.id)?.number).to.equal(3);
    expect(system.locations.find((entry) => entry.id === legacy.id)?.code).to.equal("LEGACY-SLOT");
    expect(item.quantity).to.equal(4);
    expect(item.locationId).to.equal(legacy.id);

    const opened = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        zoneId: zone.id,
        bayFrom: 11,
        bayTo: 11,
        pickPositionFrom: 1,
        pickPositionTo: 1,
        cubeCapacityCubicInches: 30,
        bayCubeBudgetCubicInches: 500,
      }),
    );
    expect(opened.created).to.equal(1);
    expect(opened.firstCode).to.equal("ALPHA-001-A03-11-A01");
    expect(system.bays.find((entry) => entry.number === 11)?.cubeBudgetCubicInches).to.equal(500);
    expect(system.bays.find((entry) => entry.id === bay.id)?.cubeBudgetCubicInches).to.equal(100);

    const beside = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        zoneId: zone.id,
        pickPositionFrom: 2,
        pickPositionTo: 2,
        cubeCapacityCubicInches: 30,
        bayCubeBudgetCubicInches: 200,
      }),
    );
    expect(beside.created).to.equal(1);
    expect(beside.firstCode).to.equal("ALPHA-001-A03-12-A02");
    expect(system.bays.find((entry) => entry.id === bay.id)?.cubeBudgetCubicInches).to.equal(200);
    expect(system.locations.filter((entry) => entry.bayId === bay.id)).to.have.length(2);
    expect(system.locations.find((entry) => entry.id === legacy.id)?.code).to.equal("LEGACY-SLOT");
  });

  it("rejects a measured case that rounds above the submitted bay budget", () => {
    const { system, building } = face();
    const measured = measureCaseCube(10.01, 10, 10);
    expect(measured.cubicInches).to.equal(1025);
    const zoneFields = {
      letter: "B" as const,
      itemType: "cable",
      cubeSize: "small" as const,
      inboundVelocity: "medium" as const,
      outboundVelocity: "fast" as const,
      aisleFrom: 1,
      aisleTo: 1,
      bayFrom: 1,
      bayTo: 1,
      lengthInches: 10.01,
      widthInches: 10,
      heightInches: 10,
    };
    const before = warehouseStamp(system);
    expect(() =>
      applyZoneLocations(
        system,
        "hyperscale",
        request(building.id, {
          ...zoneFields,
          pickPositionTo: 1,
          bayCubeBudgetCubicInches: 1000,
        }),
      ),
    ).to.throw(NomenclatureError, /Bay 01 in aisle 01 cannot hold this cube setting/);
    expect(() =>
      applyZoneLocations(
        system,
        "hyperscale",
        request(building.id, {
          ...zoneFields,
          bayCubeBudgetCubicInches: 2049,
        }),
      ),
    ).to.throw(NomenclatureError, /cannot hold this cube setting/);
    expect(warehouseStamp(system)).to.deep.equal(before);

    const result = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        ...zoneFields,
        bayCubeBudgetCubicInches: 2050,
      }),
    );
    expect(result.created).to.equal(2);
    expect(result.cubeCapacityCubicInches).to.equal(1025);
    expect(result.firstCode).to.equal("ALPHA-001-B01-01-A01");
    expect(result.lastCode).to.equal("ALPHA-001-B01-01-A02");
    const createdBay = system.bays.find((entry) =>
      system.locations.some(
        (location) => location.bayId === entry.id && location.code === result.firstCode,
      ),
    );
    expect(createdBay?.cubeBudgetCubicInches).to.equal(2050);
    const created = system.locations.filter((location) => location.bayId === createdBay?.id);
    expect(created.map((location) => location.cubeCapacityCubicInches)).to.deep.equal([
      1025, 1025,
    ]);
    expect(
      slotFitsBayCube({
        bayCubeBudgetCubicInches: 2050,
        committedCubicInches: 2050,
        incomingCubicInches: 0,
      }),
    ).to.equal(true);
  });

  it("does not shrink a bay budget that is already large enough", () => {
    const { system, building, zone, bay } = face("hyperscale", 800);
    addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 100,
    });
    const result = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        zoneId: zone.id,
        pickPositionFrom: 2,
        pickPositionTo: 2,
        cubeCapacityCubicInches: 50,
        bayCubeBudgetCubicInches: 200,
      }),
    );
    expect(result.created).to.equal(1);
    expect(system.bays.find((entry) => entry.id === bay.id)?.cubeBudgetCubicInches).to.equal(800);
    expect(system.locations.at(-1)?.cubeCapacityCubicInches).to.equal(50);
  });

  it("keeps another division unchanged when generation is refused or applied", () => {
    const { system, building, zone, bay } = face("hyperscale", 900);
    const securitySite = addSite(system, {
      division: "security",
      codename: "ALPHA",
      state: "GA",
      city: "Atlanta",
      name: "Alpha security",
    });
    const securityBuilding = addBuilding(system, {
      division: "security",
      siteId: securitySite.id,
      number: 1,
    });
    const securityZone = addZone(system, {
      division: "security",
      buildingId: securityBuilding.id,
      letter: "A",
      itemType: "camera",
      cubeSize: "small",
      inboundVelocity: "slow",
      outboundVelocity: "slow",
    });
    const securityAisle = addAisle(system, {
      division: "security",
      zoneId: securityZone.id,
      number: 3,
    });
    const securityBay = addBay(system, {
      division: "security",
      aisleId: securityAisle.id,
      number: 12,
      cubeBudgetCubicInches: 400,
    });
    const securityLocation = addStructuredLocation(system, {
      bayId: securityBay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 77,
    });
    const before = warehouseStamp(system);
    expect(() =>
      applyZoneLocations(
        system,
        "security",
        request(building.id, { zoneId: zone.id, pickPositionTo: 1 }),
      ),
    ).to.throw(NomenclatureError, /this division/);
    expect(() =>
      applyZoneLocations(
        system,
        "hyperscale",
        request(securityBuilding.id, { zoneId: securityZone.id, pickPositionTo: 1 }),
      ),
    ).to.throw(NomenclatureError, /this division/);
    expect(() =>
      applyZoneLocations(
        system,
        "hyperscale",
        request(building.id, { zoneId: securityZone.id, pickPositionTo: 1 }),
      ),
    ).to.throw(NomenclatureError, /this division/);
    expect(warehouseStamp(system)).to.deep.equal(before);

    const result = applyZoneLocations(
      system,
      "hyperscale",
      request(building.id, {
        zoneId: zone.id,
        pickPositionFrom: 1,
        pickPositionTo: 1,
        cubeCapacityCubicInches: 40,
      }),
    );
    expect(result.created).to.equal(1);
    expect(result.firstCode).to.equal("ALPHA-001-A03-12-A01");
    expect(system.locations.filter((location) => location.code === "ALPHA-001-A03-12-A01")).to.have
      .length(2);
    expect(system.bays.find((entry) => entry.id === securityBay.id)?.cubeBudgetCubicInches).to.equal(
      400,
    );
    expect(system.locations.find((entry) => entry.id === securityLocation.id)?.cubeCapacityCubicInches).to.equal(77);
    expect(system.bays.find((entry) => entry.id === bay.id)?.cubeBudgetCubicInches).to.equal(900);
    expect(
      system.locations.find((entry) => entry.bayId === bay.id)?.cubeCapacityCubicInches,
    ).to.equal(40);
  });
});
