import { describe, it } from "mocha";
import { expect } from "chai";
import fs from "node:fs";
import { InventorySystemSchema, type Division, type InventorySystem } from "@/lib/inventory-schema";
import { createSeedSystem } from "@/backend/server/seed";
import { mergeDivision, scopeSystem } from "@/lib/divisions";
import { lookupInventory } from "@/backend/server/inventory-service";
import { mapLocation, mapSite } from "@/backend/server/pg-mapper";
import { buildHandlingLabel, buildLocationLabels } from "@/lib/labels/build-labels";
import {
  addAisle,
  addBay,
  addBuilding,
  addContainer,
  addLicensePlate,
  addSite,
  addStructuredLocation,
  addTrailer,
  addZone,
  NomenclatureError,
} from "@/lib/locations/hierarchy";
import {
  compareBinCodes,
  formatBinCode,
  formatContainerCode,
  formatLicensePlate,
  formatTrailerCode,
  parseBinCode,
  parseContainerCode,
  parseLicensePlate,
  parseTrailerCode,
  PHONETIC_CODENAMES,
  slotFitsBayCube,
  unusedCodenames,
} from "@/lib/locations/nomenclature";
import { encodeLocationPayload, parseScanCode } from "@/lib/scan-code";
import { makeItem, makeLocation } from "../helpers";
import { defaultStorageClass } from "@/lib/cubing/measure";

const LEGACY_CODES = ["A-01-01", "DOCK-01", "DMG-01", "PLT-01", "SEC-A1"];

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
    projectId: "PRJ-1",
    poNumber: "PO-9",
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

describe("logistics nomenclature", () => {
  it("round-trips pick and overhead bin codes", () => {
    const pick = formatBinCode({
      codename: "alpha",
      building: 1,
      zone: "a",
      aisle: 3,
      bay: 12,
      slot: { kind: "pick", height: "A", position: 1 },
    });
    expect(pick).to.equal("ALPHA-001-A03-12-A01");
    expect(parseBinCode(pick)).to.deep.equal({
      codename: "ALPHA",
      building: 1,
      zone: "A",
      aisle: 3,
      bay: 12,
      slot: { kind: "pick", height: "A", position: 1 },
    });

    const overhead = formatBinCode({
      codename: "NOVEMBER",
      building: 100,
      zone: "Z",
      aisle: 99,
      bay: 99,
      slot: { kind: "overhead", height: 9, side: "b" },
    });
    expect(overhead).to.equal("NOVEMBER-100-Z99-99-09B");
    expect(overhead.length).to.be.lessThan(41);
    expect(parseBinCode(overhead)?.slot).to.deep.equal({
      kind: "overhead",
      height: 9,
      side: "B",
    });
  });

  it("rejects building, aisle, pick, and overhead addresses outside the grammar", () => {
    expect(() =>
      formatBinCode({
        codename: "ALPHA",
        building: 0,
        zone: "A",
        aisle: 3,
        bay: 12,
        slot: { kind: "pick", height: "A", position: 1 },
      }),
    ).to.throw(NomenclatureError, /building/i);
    expect(() =>
      formatBinCode({
        codename: "ALPHA",
        building: 101,
        zone: "A",
        aisle: 3,
        bay: 12,
        slot: { kind: "pick", height: "A", position: 1 },
      }),
    ).to.throw(NomenclatureError, /building/i);
    expect(() =>
      formatBinCode({
        codename: "ALPHA",
        building: 1,
        zone: "A",
        aisle: 0,
        bay: 12,
        slot: { kind: "pick", height: "A", position: 1 },
      }),
    ).to.throw(NomenclatureError, /aisle/i);
    expect(() =>
      formatBinCode({
        codename: "ALPHA",
        building: 1,
        zone: "A",
        aisle: 3,
        bay: 12,
        slot: { kind: "pick", height: "E", position: 1 },
      }),
    ).to.throw(NomenclatureError, /pick height/i);
    expect(() =>
      formatBinCode({
        codename: "ALPHA",
        building: 1,
        zone: "A",
        aisle: 3,
        bay: 12,
        slot: { kind: "pick", height: "A", position: 10 },
      }),
    ).to.throw(NomenclatureError, /01 through 09/i);
    expect(() =>
      formatBinCode({
        codename: "ALPHA",
        building: 1,
        zone: "A",
        aisle: 3,
        bay: 12,
        slot: { kind: "overhead", height: 3, side: "A" },
      }),
    ).to.throw(NomenclatureError, /overhead/i);
    expect(() =>
      formatBinCode({
        codename: "ALPHA",
        building: 1,
        zone: "A",
        aisle: 3,
        bay: 12,
        slot: { kind: "overhead", height: 4, side: "C" },
      }),
    ).to.throw(NomenclatureError, /overhead side/i);

    for (const code of [
      "ALPHA-000-A03-12-A01",
      "ALPHA-101-A03-12-A01",
      "ALPHA-001-A00-12-A01",
      "ALPHA-001-A03-12-E01",
      "ALPHA-001-A03-12-A10",
      "ALPHA-001-A03-12-03A",
      "ALPHA-001-A03-12-04C",
      ...LEGACY_CODES,
    ]) {
      expect(parseBinCode(code), code).to.equal(null);
    }
  });

  it("walks the pick path before overhead slots", () => {
    const ordered = [
      "ALPHA-001-A03-12-04B",
      "ALPHA-001-A03-12-A01",
      "ALPHA-001-A03-12-B01",
      "DOCK-01",
      "ALPHA-001-A03-12-04A",
      "ALPHA-001-A02-12-D09",
    ].sort(compareBinCodes);
    expect(ordered).to.deep.equal([
      "ALPHA-001-A02-12-D09",
      "ALPHA-001-A03-12-A01",
      "ALPHA-001-A03-12-B01",
      "ALPHA-001-A03-12-04A",
      "ALPHA-001-A03-12-04B",
      "DOCK-01",
    ]);
  });

  it("keeps a new slot inside the bay cube budget", () => {
    expect(
      slotFitsBayCube({
        bayCubeBudgetCubicInches: 100,
        committedCubicInches: 80,
        incomingCubicInches: 20,
      }),
    ).to.equal(true);
    expect(
      slotFitsBayCube({
        bayCubeBudgetCubicInches: 100,
        committedCubicInches: 80,
        incomingCubicInches: 20.01,
      }),
    ).to.equal(false);

    const { system, bay } = face("hyperscale", 100);
    addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      cubeCapacityCubicInches: 60,
    });
    expect(() =>
      addStructuredLocation(system, {
        bayId: bay.id,
        slotKind: "pick",
        height: "A",
        position: 2,
        cubeCapacityCubicInches: 50,
      }),
    ).to.throw(NomenclatureError, /bay budget/i);
    const second = addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 2,
      cubeCapacityCubicInches: 40,
    });
    expect(second.code).to.equal("ALPHA-001-A03-12-A02");
  });

  it("lets each division assign the same codename", () => {
    const { system, site } = face("hyperscale");
    expect(() =>
      addSite(system, {
        division: "hyperscale",
        codename: "ALPHA",
        state: "GA",
        city: "Savannah",
        name: "Duplicate",
      }),
    ).to.throw(NomenclatureError, /already used/);
    const securitySite = addSite(system, {
      division: "security",
      codename: "ALPHA",
      state: "TX",
      city: "Dallas",
      name: "Security alpha",
    });
    expect(securitySite.codename).to.equal("ALPHA");
    expect(() =>
      addBuilding(system, { division: "security", siteId: site.id, number: 2 }),
    ).to.throw(NomenclatureError, /this division/);
    expect(unusedCodenames(["alpha", "BETA"])).to.not.include("ALPHA");
    expect(unusedCodenames(["alpha", "BETA"])).to.include("CHARLIE");
  });

  it("seeds ALPHA only in Hyperscale and keeps it when Security saves", () => {
    const full = createSeedSystem();
    expect(
      full.locations.some(
        (location) =>
          location.code === "ALPHA-001-A03-12-A01" && location.division === "hyperscale",
      ),
    ).to.equal(true);
    expect(full.locations.some((location) => location.code === "A-01-01")).to.equal(true);
    expect(full.sites.filter((site) => site.codename === "ALPHA").map((site) => site.division)).to.deep.equal([
      "hyperscale",
    ]);
    expect(full.rooms.some((room) => room.name === "ALPHA-001" && room.division === "hyperscale")).to.equal(
      true,
    );
    expect(defaultStorageClass("DOCK-01")).to.equal("staging");
    expect(defaultStorageClass("ALPHA-001-A03-12-A01")).to.equal("rack");

    const security = scopeSystem(full, "security");
    expect(security.sites).to.deep.equal([]);
    expect(security.locations.map((location) => location.code)).to.deep.equal([
      "SEC-A1",
      "SEC-HOLD",
    ]);
    addSite(security, {
      division: "security",
      codename: "ALPHA",
      state: "TX",
      city: "Dallas",
      name: "Security alpha",
    });
    mergeDivision(full, security, "security");
    expect(
      full.sites
        .filter((site) => site.codename === "ALPHA")
        .map((site) => `${site.division}:${site.city}`)
        .sort(),
    ).to.deep.equal(["hyperscale:Atlanta", "security:Dallas"]);
  });

  it("formats trailer, license plate, and container identities", () => {
    expect(formatTrailerCode(142)).to.equal("TN000142");
    expect(parseTrailerCode("tn000142")).to.equal("TN000142");
    expect(parseTrailerCode("TN142")).to.equal(null);
    expect(parseTrailerCode("TN000000")).to.equal(null);
    expect(formatLicensePlate("abcd1234ef")).to.equal("LPABCD1234");
    expect(parseLicensePlate("lpabcd1234")).to.equal("LPABCD1234");
    expect(parseLicensePlate("LPABC")).to.equal(null);
    expect(formatContainerCode("dddd1111-1111-4111-8111-111111111111")).to.equal("CNDDDD1111");
    expect(parseContainerCode("CNDDDD1111")).to.equal("CNDDDD1111");
  });

  it("scans a structured bin separately from handling units", () => {
    expect(parseScanCode("ALPHA-001-A03-12-A01").locationCode).to.equal(
      "ALPHA-001-A03-12-A01",
    );
    expect(parseScanCode("ALPHA-001-A03-12-A01").sku).to.equal(undefined);
    expect(parseScanCode("TN000142")).to.deep.include({ trailerCode: "TN000142" });
    expect(parseScanCode("LPABCD1234").licensePlateCode).to.equal("LPABCD1234");
    expect(parseScanCode("CNDDDD1111").containerCode).to.equal("CNDDDD1111");
    expect(parseScanCode("A-01-01").sku).to.equal("A-01-01");
    expect(parseScanCode("saltbox://location?code=A-01-01").locationCode).to.equal("A-01-01");

    const encoded = encodeLocationPayload({
      code: "ALPHA-001-A03-12-04A",
      room: "ALPHA-001",
      bin: parseBinCode("ALPHA-001-A03-12-04A"),
    });
    expect(encoded).to.include('"v":2');
    expect(parseScanCode(encoded).locationCode).to.equal("ALPHA-001-A03-12-04A");
    const legacy = encodeLocationPayload({ code: "A-01-01", room: "Main" });
    expect(legacy).to.include('"v":1');
    expect(parseScanCode(legacy).locationCode).to.equal("A-01-01");
  });

  it("prints the full bin code and resolves stock by license plate", () => {
    const location = makeLocation({
      code: "ALPHA-001-A03-12-A01",
      description: "Pick path low, position 01",
    });
    const [label] = buildLocationLabels([{ ...location, roomName: "ALPHA-001" }]);
    expect(label?.barcodeValue).to.equal("ALPHA-001-A03-12-A01");
    expect(parseScanCode(label?.qrValue ?? "").locationCode).to.equal("ALPHA-001-A03-12-A01");
    expect(label?.fields.some((field) => field.value === "ALPHA")).to.equal(true);

    const trailerLabel = buildHandlingLabel({
      id: "trailer-1",
      kind: "trailer",
      code: "TN000142",
      detail: "arrived",
    });
    expect(parseScanCode(trailerLabel.qrValue).trailerCode).to.equal("TN000142");

    const { system, bay } = face();
    const slot = addStructuredLocation(system, {
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
    });
    const plate = addLicensePlate(system, {
      division: "hyperscale",
      locationId: slot.id,
      id: "eeee1111-1111-4111-8111-111111111111",
    });
    const container = addContainer(system, {
      division: "hyperscale",
      licensePlateId: plate.id,
      id: "eeee2222-2222-4222-8222-222222222222",
    });
    const trailer = addTrailer(system, {
      division: "hyperscale",
      siteId: system.sites[0]!.id,
      number: 142,
    });
    expect(plate.code).to.match(/^LP/);
    expect(container.code).to.match(/^CN/);
    expect(trailer.code).to.equal("TN000142");
    system.inventoryItems.push(
      makeItem({
        locationId: slot.id,
        licensePlateId: plate.id,
        containerId: container.id,
        division: "hyperscale",
      }),
    );
    expect(lookupInventory(system, slot.code)).to.have.length(1);
    expect(lookupInventory(system, plate.code)).to.have.length(1);
    expect(lookupInventory(system, container.code)).to.have.length(1);
    expect(lookupInventory(system, "A-01-01")).to.have.length(0);
  });

  it("maps structured rows and keeps the codename list in the migration", () => {
    const mapped = mapLocation({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "ALPHA-001-A03-12-A01",
      room_id: "11111111-1111-4111-8111-111111111111",
      description: "Pick path low, position 01",
      is_active: true,
      storage_class: "rack",
      cube_capacity_cubic_inches: 100,
      division: "security",
      bay_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      slot_kind: "pick",
      height: "A",
      position: 1,
      side: null,
    });
    expect(mapped.division).to.equal("security");
    expect(mapped.bayId).to.equal("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(mapped.slotKind).to.equal("pick");
    expect(mapped.position).to.equal(1);
    const site = mapSite({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      division: "security",
      codename: "BETA",
      state: "tx",
      city: "Dallas",
      name: "Beta yard",
    });
    expect(InventorySystemSchema.parse({ sites: [site], locations: [mapped], rooms: [{
      id: mapped.roomId,
      name: "BETA-001",
    }] }).sites[0]?.state).to.equal("TX");

    const sql = fs.readFileSync("backend/db/010_location_nomenclature.sql", "utf8");
    for (const name of PHONETIC_CODENAMES) {
      expect(sql).to.include(`'${name}'`);
    }
    expect(sql).to.include("UNIQUE (division, codename)");
    expect(sql).to.include("license_plate_id");
  });
});
