import { describe, it } from "mocha";
import { expect } from "chai";
import { InventorySystemSchema, type Division, type InventorySystem } from "@/lib/inventory-schema";
import { GenerateZoneLocationsInputSchema } from "@/lib/inventory-schema";
import {
  DEFAULT_PALLET_CUBE_CUBIC_INCHES,
  DEFAULT_RACK_CUBE_CUBIC_INCHES,
  measureCaseCube,
} from "@/lib/cubing/measure";
import {
  addBay,
  addBuilding,
  addSite,
  addStructuredLocation,
  addZone,
  addAisle,
} from "@/lib/locations/hierarchy";
import {
  applyZoneLocations,
  categorizeInventoryLines,
  NomenclatureError,
  planZoneLocations,
  resolveZoneCube,
} from "@/lib/locations/zoning";
import { makeItem } from "../helpers";
import type { GenerateZoneLocationsInput } from "@/lib/inventory-schema";

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
