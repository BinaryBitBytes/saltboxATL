import type {
  Division,
  InventoryItem,
  InventorySystem,
  ItemCube,
  Location,
  User,
} from "@/lib/inventory-schema";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/auth/demo-accounts";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { divisionForRole, divisionOf } from "@/lib/divisions";
import { assignLocationSites } from "@/lib/sites/database";
import { assignUserHomeSites } from "@/lib/sites/access";
import {
  DEFAULT_HOLD_CUBE_CUBIC_INCHES,
  DEFAULT_PALLET_CUBE_CUBIC_INCHES,
  DEFAULT_RACK_CUBE_CUBIC_INCHES,
  DEFAULT_STAGING_CUBE_CUBIC_INCHES,
  type StorageClass,
} from "@/lib/cubing/measure";
import { describeSlot, formatBinCode, padNumber } from "@/lib/locations/nomenclature";

const ROOM_RECEIVING = "11111111-1111-4111-8111-111111111111";
const ROOM_FIBER = "22222222-2222-4222-8222-222222222222";
const ROOM_WAREHOUSE = "33333333-3333-4333-8333-333333333333";
const ROOM_DAMAGED = "44444444-4444-4444-8444-444444444444";

const LOC_DOCK = "aaaa1111-1111-4111-8111-111111111111";
const LOC_FIBER = "aaaa2222-2222-4222-8222-222222222222";
const LOC_A0101 = "aaaa3333-3333-4333-8333-333333333333";
const LOC_A0102 = "aaaa4444-4444-4444-8444-444444444444";
export const LOC_DAMAGED = "aaaa5555-5555-4555-8555-555555555555";
const LOC_PLT01 = "aaaa6666-6666-4666-8666-666666666666";
const LOC_PLT02 = "aaaa7777-7777-4777-8777-777777777777";
const ROOM_SECURITY = "55555555-5555-4555-8555-555555555555";
const LOC_SECURITY = "aaaa8888-8888-4888-8888-888888888888";
const LOC_SECURITY_HOLD = "aaaa9999-9999-4999-8999-999999999999";
const ITEM_SECURITY = "cccc8888-8888-4888-8888-888888888888";
const SITE_ALPHA = "dddd1111-1111-4111-8111-111111111111";
const BUILDING_ALPHA = "dddd2222-2222-4222-8222-222222222222";
const ZONE_ALPHA = "dddd3333-3333-4333-8333-333333333333";
const AISLE_ALPHA = "dddd4444-4444-4444-8444-444444444444";
const BAY_ALPHA = "dddd5555-5555-4555-8555-555555555555";
const ROOM_ALPHA = "dddd6666-6666-4666-8666-666666666666";
const LOC_ALPHA = "dddd7777-7777-4777-8777-777777777777";
const SITE_BETA = "eeee1111-1111-4111-8111-111111111111";
const BUILDING_BETA = "eeee2222-2222-4222-8222-222222222222";
const ZONE_BETA = "eeee3333-3333-4333-8333-333333333333";
const AISLE_BETA = "eeee4444-4444-4444-8444-444444444444";
const BAY_BETA = "eeee5555-5555-4555-8555-555555555555";
const ROOM_BETA = "eeee6666-6666-4666-8666-666666666666";
const LOC_BETA = "eeee7777-7777-4777-8777-777777777777";
const LOC_BETA_PDU = "eeee8888-8888-4888-8888-888888888888";
const ITEM_BETA_CAT6 = "eeee9999-9999-4999-8999-999999999999";
const ITEM_BETA_PDU = "eeeeaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SITE_SIERRA = "ffff1111-1111-4111-8111-111111111111";
const BUILDING_SIERRA = "ffff2222-2222-4222-8222-222222222222";
const ZONE_SIERRA = "ffff3333-3333-4333-8333-333333333333";
const AISLE_SIERRA = "ffff4444-4444-4444-8444-444444444444";
const BAY_SIERRA = "ffff5555-5555-4555-8555-555555555555";
const ROOM_SIERRA = "ffff6666-6666-4666-8666-666666666666";
const LOC_SIERRA = "ffff7777-7777-4777-8777-777777777777";
const ALPHA_BAY_BUDGET = DEFAULT_RACK_CUBE_CUBIC_INCHES * 48;

export { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/auth/demo-accounts";

function sampleLocation(
  id: string,
  code: string,
  roomId: string,
  description: string,
  storageClass: StorageClass,
  cubeCapacityCubicInches: number,
  division: Division = "hyperscale",
): Location {
  return {
    id,
    division,
    code,
    roomId,
    description,
    isActive: true,
    storageClass,
    cubeCapacityCubicInches,
  };
}

function sampleCube(
  sku: string,
  lengthInches: number,
  widthInches: number,
  heightInches: number,
  description: string,
  division: Division = "hyperscale",
): ItemCube {
  const cubicInches = Math.round(lengthInches * widthInches * heightInches * 1000) / 1000;
  return {
    sku,
    description,
    lengthInches,
    widthInches,
    heightInches,
    cubicInches,
    unitsPerCase: 1,
    cubedAt: nowIso(),
    cubedBy: "system",
    division,
  };
}

function sampleItem(
  sku: string,
  upc: string,
  locationId: string,
  quantity: number,
  description: string,
  batch: string | null = null,
  division: Division = "hyperscale",
): InventoryItem {
  const now = nowIso();
  return {
    id: createId(),
    division,
    sku,
    upc,
    batch,
    locationId,
    quantity,
    description,
    manufacturer: "",
    color: null,
    fiber: null,
    lastMovedAt: now,
    updatedAt: now,
  };
}

export function createSeedSystem(): InventorySystem {
  const system: InventorySystem = {
    purchaseOrders: [],
    receivingOrders: [],
    shippingOrders: [],
    customerOrders: [],
    rooms: [
      {
        id: ROOM_RECEIVING,
        name: "Receiving Dock",
        description: "Inbound staging",
      },
      {
        id: ROOM_FIBER,
        name: "Fiber Room",
        description: "Fiber cable and connector stock",
      },
      {
        id: ROOM_WAREHOUSE,
        name: "Warehouse A",
        description: "Primary putaway floor",
      },
      {
        id: ROOM_DAMAGED,
        name: "Damaged Hold",
        description: "Quarantine for damaged product",
      },
    ],
    locations: [
      sampleLocation(
        LOC_DOCK,
        "DOCK-01",
        ROOM_RECEIVING,
        "Inbound pallet lane 1",
        "staging",
        DEFAULT_STAGING_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_FIBER,
        "FIBER-A1",
        ROOM_FIBER,
        "Fiber rack A1",
        "rack",
        DEFAULT_RACK_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_A0101,
        "A-01-01",
        ROOM_WAREHOUSE,
        "Aisle A, bay 01, level 01",
        "rack",
        DEFAULT_RACK_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_A0102,
        "A-01-02",
        ROOM_WAREHOUSE,
        "Aisle A, bay 01, level 02",
        "rack",
        DEFAULT_RACK_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_PLT01,
        "PLT-01",
        ROOM_WAREHOUSE,
        "Full pallet location 1",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_PLT02,
        "PLT-02",
        ROOM_WAREHOUSE,
        "Full pallet location 2",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_DAMAGED,
        "DMG-01",
        ROOM_DAMAGED,
        "Damaged / quarantine cage",
        "hold",
        DEFAULT_HOLD_CUBE_CUBIC_INCHES,
      ),
    ],
    inventoryItems: [
      sampleItem(
        "FBR-LC-12-100",
        "010000000001",
        LOC_FIBER,
        24,
        "12-strand LC fiber, 100m",
      ),
      sampleItem(
        "CAT6-BLU-1000",
        "010000000002",
        LOC_A0101,
        48,
        "Cat6 blue 1000ft box",
      ),
      sampleItem(
        "FBR-MPO-24-50",
        "010000000003",
        LOC_FIBER,
        12,
        "24-strand MPO trunk, 50m",
        "B2026-08",
      ),
    ],
    transactions: [],
    photos: [],
    purchaseDocuments: [],
    users: [],
    sites: [],
    buildings: [],
    zones: [],
    aisles: [],
    bays: [],
    trailers: [],
    licensePlates: [],
    containers: [],
    itemCubes: [
      sampleCube("FBR-LC-12-100", 12.25, 8.25, 3.25, "12-strand LC fiber, 100m"),
      sampleCube("CAT6-BLU-1000", 8, 6, 4, "Cat6 blue 1000ft box"),
      sampleCube("FBR-MPO-24-50", 10.25, 8.25, 4.25, "24-strand MPO trunk, 50m"),
    ],
  };
  ensureSystemDefaults(system);
  return system;
}

function stampDivision<T extends { division?: Division | null }>(
  records: T[] | undefined,
  division: Division,
): boolean {
  if (!records) return false;
  let changed = false;
  for (const record of records) {
    if (record.division !== "hyperscale" && record.division !== "security") {
      record.division = division;
      changed = true;
    }
  }
  return changed;
}

function ensureSecurityWarehouse(system: InventorySystem): boolean {
  let changed = false;
  if (!system.rooms.some((room) => room.id === ROOM_SECURITY)) {
    system.rooms.push({
      id: ROOM_SECURITY,
      division: "security",
      name: "Security Cage",
      description: "Security division stock",
    });
    changed = true;
  }
  if (!system.locations.some((location) => location.id === LOC_SECURITY)) {
    system.locations.push(
      sampleLocation(
        LOC_SECURITY,
        "SEC-A1",
        ROOM_SECURITY,
        "Security rack A1",
        "rack",
        DEFAULT_RACK_CUBE_CUBIC_INCHES,
        "security",
      ),
    );
    changed = true;
  }
  if (!system.locations.some((location) => location.id === LOC_SECURITY_HOLD)) {
    system.locations.push(
      sampleLocation(
        LOC_SECURITY_HOLD,
        "SEC-HOLD",
        ROOM_SECURITY,
        "Security quarantine",
        "hold",
        DEFAULT_HOLD_CUBE_CUBIC_INCHES,
        "security",
      ),
    );
    changed = true;
  }
  if (!system.inventoryItems.some((item) => item.id === ITEM_SECURITY)) {
    const item = sampleItem(
      "SEC-CAM-01",
      "010000000101",
      LOC_SECURITY,
      6,
      "Indoor dome camera",
      null,
      "security",
    );
    item.id = ITEM_SECURITY;
    system.inventoryItems.push(item);
    changed = true;
  }
  if (
    !system.itemCubes.some(
      (cube) => cube.sku === "SEC-CAM-01" && divisionOf(cube) === "security",
    )
  ) {
    system.itemCubes.push(
      sampleCube("SEC-CAM-01", 6, 6, 4, "Indoor dome camera", "security"),
    );
    changed = true;
  }
  return changed;
}

function ensureAlphaCampus(system: InventorySystem): boolean {
  let changed = false;
  const division = "hyperscale" as const;
  const address = {
    codename: "ALPHA" as const,
    building: 1,
    zone: "A",
    aisle: 3,
    bay: 12,
    slot: { kind: "pick" as const, height: "A", position: 1 },
  };
  const code = formatBinCode(address);
  const roomName = `ALPHA-${padNumber(1, 3)}`;

  let site = system.sites.find(
    (entry) => entry.codename === "ALPHA" && divisionOf(entry) === division,
  );
  if (!site) {
    site = {
      id: SITE_ALPHA,
      division,
      codename: "ALPHA",
      state: "GA",
      city: "Atlanta",
      name: "Alpha campus",
    };
    system.sites.push(site);
    changed = true;
  }

  let room =
    system.rooms.find((entry) => entry.id === ROOM_ALPHA) ??
    system.rooms.find(
      (entry) => entry.name === roomName && divisionOf(entry) === division,
    );
  if (!room) {
    room = {
      id: ROOM_ALPHA,
      division,
      name: roomName,
      description: "Site ALPHA, building 001",
    };
    system.rooms.push(room);
    changed = true;
  }

  let building = system.buildings.find(
    (entry) => entry.siteId === site.id && entry.number === 1,
  );
  if (!building) {
    building = {
      id: BUILDING_ALPHA,
      division,
      siteId: site.id,
      number: 1,
      roomId: room.id,
    };
    system.buildings.push(building);
    changed = true;
  }

  let zone = system.zones.find(
    (entry) => entry.buildingId === building.id && entry.letter === "A",
  );
  if (!zone) {
    zone = {
      id: ZONE_ALPHA,
      division,
      buildingId: building.id,
      letter: "A",
      itemType: "general",
      cubeSize: "medium",
      projectId: null,
      poNumber: null,
      inboundVelocity: "medium",
      outboundVelocity: "medium",
    };
    system.zones.push(zone);
    changed = true;
  }

  let aisle = system.aisles.find(
    (entry) => entry.zoneId === zone.id && entry.number === 3,
  );
  if (!aisle) {
    aisle = {
      id: AISLE_ALPHA,
      division,
      zoneId: zone.id,
      number: 3,
    };
    system.aisles.push(aisle);
    changed = true;
  }

  let bay = system.bays.find(
    (entry) => entry.aisleId === aisle.id && entry.number === 12,
  );
  if (!bay) {
    bay = {
      id: BAY_ALPHA,
      division,
      aisleId: aisle.id,
      number: 12,
      cubeBudgetCubicInches: ALPHA_BAY_BUDGET,
    };
    system.bays.push(bay);
    changed = true;
  }

  if (
    !system.locations.some(
      (location) => location.code === code && divisionOf(location) === division,
    )
  ) {
    const location = sampleLocation(
      LOC_ALPHA,
      code,
      room.id,
      describeSlot({ kind: "pick", height: "A", position: 1 }),
      "rack",
      DEFAULT_RACK_CUBE_CUBIC_INCHES,
      division,
    );
    system.locations.push({
      ...location,
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      side: null,
    });
    changed = true;
  }

  return changed;
}

function ensureBetaCampus(system: InventorySystem): boolean {
  let changed = false;
  const division = "hyperscale" as const;
  const cat6Code = formatBinCode({
    codename: "BETA",
    building: 1,
    zone: "B",
    aisle: 1,
    bay: 1,
    slot: { kind: "pick", height: "A", position: 1 },
  });
  const pduCode = formatBinCode({
    codename: "BETA",
    building: 1,
    zone: "B",
    aisle: 1,
    bay: 1,
    slot: { kind: "pick", height: "A", position: 2 },
  });
  const roomName = `BETA-${padNumber(1, 3)}`;

  let site = system.sites.find(
    (entry) => entry.codename === "BETA" && divisionOf(entry) === division,
  );
  if (!site) {
    site = {
      id: SITE_BETA,
      division,
      codename: "BETA",
      state: "GA",
      city: "Savannah",
      name: "Beta yard",
    };
    system.sites.push(site);
    changed = true;
  }

  let room =
    system.rooms.find((entry) => entry.id === ROOM_BETA) ??
    system.rooms.find((entry) => entry.name === roomName && divisionOf(entry) === division);
  if (!room) {
    room = {
      id: ROOM_BETA,
      division,
      name: roomName,
      description: "Site BETA, building 001",
    };
    system.rooms.push(room);
    changed = true;
  }

  let building = system.buildings.find(
    (entry) => entry.siteId === site.id && entry.number === 1,
  );
  if (!building) {
    building = {
      id: BUILDING_BETA,
      division,
      siteId: site.id,
      number: 1,
      roomId: room.id,
    };
    system.buildings.push(building);
    changed = true;
  }

  let zone = system.zones.find(
    (entry) => entry.buildingId === building.id && entry.letter === "B",
  );
  if (!zone) {
    zone = {
      id: ZONE_BETA,
      division,
      buildingId: building.id,
      letter: "B",
      itemType: "general",
      cubeSize: "medium",
      projectId: null,
      poNumber: null,
      inboundVelocity: "fast",
      outboundVelocity: "slow",
    };
    system.zones.push(zone);
    changed = true;
  }

  let aisle = system.aisles.find((entry) => entry.zoneId === zone.id && entry.number === 1);
  if (!aisle) {
    aisle = { id: AISLE_BETA, division, zoneId: zone.id, number: 1 };
    system.aisles.push(aisle);
    changed = true;
  }

  let bay = system.bays.find((entry) => entry.aisleId === aisle.id && entry.number === 1);
  if (!bay) {
    bay = {
      id: BAY_BETA,
      division,
      aisleId: aisle.id,
      number: 1,
      cubeBudgetCubicInches: ALPHA_BAY_BUDGET,
    };
    system.bays.push(bay);
    changed = true;
  }

  if (
    !system.locations.some(
      (location) => location.code === cat6Code && divisionOf(location) === division,
    )
  ) {
    const location = sampleLocation(
      LOC_BETA,
      cat6Code,
      room.id,
      describeSlot({ kind: "pick", height: "A", position: 1 }),
      "rack",
      DEFAULT_RACK_CUBE_CUBIC_INCHES,
      division,
    );
    system.locations.push({
      ...location,
      siteId: site.id,
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      side: null,
    });
    changed = true;
  }

  if (
    !system.locations.some(
      (location) => location.code === pduCode && divisionOf(location) === division,
    )
  ) {
    const location = sampleLocation(
      LOC_BETA_PDU,
      pduCode,
      room.id,
      describeSlot({ kind: "pick", height: "A", position: 2 }),
      "rack",
      DEFAULT_RACK_CUBE_CUBIC_INCHES,
      division,
    );
    system.locations.push({
      ...location,
      siteId: site.id,
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 2,
      side: null,
    });
    changed = true;
  }

  const cat6Location = system.locations.find(
    (location) => location.code === cat6Code && divisionOf(location) === division,
  );
  if (
    cat6Location &&
    !system.inventoryItems.some(
      (item) => item.id === ITEM_BETA_CAT6 || (item.sku === "CAT6-BLU-1000" && item.locationId === cat6Location.id),
    )
  ) {
    const item = sampleItem(
      "CAT6-BLU-1000",
      "010000000002",
      cat6Location.id,
      8,
      "Cat6 blue 1000ft box",
      null,
      division,
    );
    item.id = ITEM_BETA_CAT6;
    system.inventoryItems.push(item);
    changed = true;
  }

  const pduLocation = system.locations.find(
    (location) => location.code === pduCode && divisionOf(location) === division,
  );
  if (pduLocation && !system.inventoryItems.some((item) => item.sku === "PWR-PDU-30A")) {
    const item = sampleItem(
      "PWR-PDU-30A",
      "010000000201",
      pduLocation.id,
      2,
      "30A rack PDU",
      null,
      division,
    );
    item.id = ITEM_BETA_PDU;
    system.inventoryItems.push(item);
    changed = true;
  }

  return changed;
}

function ensureSierraCampus(system: InventorySystem): boolean {
  let changed = false;
  const division = "security" as const;
  const code = formatBinCode({
    codename: "SIERRA",
    building: 1,
    zone: "A",
    aisle: 1,
    bay: 1,
    slot: { kind: "pick", height: "A", position: 1 },
  });
  const roomName = `SIERRA-${padNumber(1, 3)}`;

  let site = system.sites.find(
    (entry) => entry.codename === "SIERRA" && divisionOf(entry) === division,
  );
  if (!site) {
    site = {
      id: SITE_SIERRA,
      division,
      codename: "SIERRA",
      state: "GA",
      city: "Marietta",
      name: "Sierra cage",
    };
    system.sites.push(site);
    changed = true;
  }

  let room =
    system.rooms.find((entry) => entry.id === ROOM_SIERRA) ??
    system.rooms.find((entry) => entry.name === roomName && divisionOf(entry) === division);
  if (!room) {
    room = {
      id: ROOM_SIERRA,
      division,
      name: roomName,
      description: "Site SIERRA, building 001",
    };
    system.rooms.push(room);
    changed = true;
  }

  let building = system.buildings.find(
    (entry) => entry.siteId === site.id && entry.number === 1,
  );
  if (!building) {
    building = {
      id: BUILDING_SIERRA,
      division,
      siteId: site.id,
      number: 1,
      roomId: room.id,
    };
    system.buildings.push(building);
    changed = true;
  }

  let zone = system.zones.find(
    (entry) => entry.buildingId === building.id && entry.letter === "A",
  );
  if (!zone) {
    zone = {
      id: ZONE_SIERRA,
      division,
      buildingId: building.id,
      letter: "A",
      itemType: "security",
      cubeSize: "medium",
      projectId: null,
      poNumber: null,
      inboundVelocity: "medium",
      outboundVelocity: "medium",
    };
    system.zones.push(zone);
    changed = true;
  }

  let aisle = system.aisles.find((entry) => entry.zoneId === zone.id && entry.number === 1);
  if (!aisle) {
    aisle = { id: AISLE_SIERRA, division, zoneId: zone.id, number: 1 };
    system.aisles.push(aisle);
    changed = true;
  }

  let bay = system.bays.find((entry) => entry.aisleId === aisle.id && entry.number === 1);
  if (!bay) {
    bay = {
      id: BAY_SIERRA,
      division,
      aisleId: aisle.id,
      number: 1,
      cubeBudgetCubicInches: ALPHA_BAY_BUDGET,
    };
    system.bays.push(bay);
    changed = true;
  }

  if (
    !system.locations.some(
      (location) => location.code === code && divisionOf(location) === division,
    )
  ) {
    const location = sampleLocation(
      LOC_SIERRA,
      code,
      room.id,
      describeSlot({ kind: "pick", height: "A", position: 1 }),
      "rack",
      DEFAULT_RACK_CUBE_CUBIC_INCHES,
      division,
    );
    system.locations.push({
      ...location,
      siteId: site.id,
      bayId: bay.id,
      slotKind: "pick",
      height: "A",
      position: 1,
      side: null,
    });
    changed = true;
  }

  return changed;
}

export function ensureSystemDefaults(system: InventorySystem): boolean {
  let changed = false;
  if (!system.transactions) {
    system.transactions = [];
    changed = true;
  }
  if (!system.photos) {
    system.photos = [];
    changed = true;
  }
  if (!system.itemCubes) {
    system.itemCubes = [];
    changed = true;
  }
  if (!system.customerOrders) {
    system.customerOrders = [];
    changed = true;
  }
  if (!system.purchaseDocuments) {
    system.purchaseDocuments = [];
    changed = true;
  }
  if (!system.sites) {
    system.sites = [];
    changed = true;
  }
  if (!system.buildings) {
    system.buildings = [];
    changed = true;
  }
  if (!system.zones) {
    system.zones = [];
    changed = true;
  }
  if (!system.aisles) {
    system.aisles = [];
    changed = true;
  }
  if (!system.bays) {
    system.bays = [];
    changed = true;
  }
  if (!system.trailers) {
    system.trailers = [];
    changed = true;
  }
  if (!system.licensePlates) {
    system.licensePlates = [];
    changed = true;
  }
  if (!system.licensePlateLedger) {
    system.licensePlateLedger = {
      nextOrdinal: 0,
      activeUsers: [],
      reservations: [],
    };
    changed = true;
  }
  if (!system.containers) {
    system.containers = [];
    changed = true;
  }

  if (stampDivision(system.rooms, "hyperscale")) changed = true;
  if (stampDivision(system.locations, "hyperscale")) changed = true;
  if (stampDivision(system.inventoryItems, "hyperscale")) changed = true;
  if (stampDivision(system.transactions, "hyperscale")) changed = true;
  if (stampDivision(system.photos, "hyperscale")) changed = true;
  if (stampDivision(system.purchaseOrders, "hyperscale")) changed = true;
  if (stampDivision(system.purchaseDocuments, "hyperscale")) changed = true;
  if (stampDivision(system.receivingOrders, "hyperscale")) changed = true;
  if (stampDivision(system.shippingOrders, "hyperscale")) changed = true;
  if (stampDivision(system.customerOrders, "hyperscale")) changed = true;
  if (stampDivision(system.itemCubes, "hyperscale")) changed = true;
  if (stampDivision(system.sites, "hyperscale")) changed = true;
  if (stampDivision(system.buildings, "hyperscale")) changed = true;
  if (stampDivision(system.zones, "hyperscale")) changed = true;
  if (stampDivision(system.aisles, "hyperscale")) changed = true;
  if (stampDivision(system.bays, "hyperscale")) changed = true;
  if (stampDivision(system.trailers, "hyperscale")) changed = true;
  if (stampDivision(system.licensePlates, "hyperscale")) changed = true;
  if (stampDivision(system.containers, "hyperscale")) changed = true;

  for (const location of system.locations) {
    if (
      location.code === "DOCK-01" &&
      divisionOf(location) === "hyperscale" &&
      location.storageClass === "rack" &&
      location.cubeCapacityCubicInches === DEFAULT_RACK_CUBE_CUBIC_INCHES
    ) {
      location.storageClass = "staging";
      location.cubeCapacityCubicInches = DEFAULT_STAGING_CUBE_CUBIC_INCHES;
      changed = true;
    }
    if (
      location.code === "DMG-01" &&
      divisionOf(location) === "hyperscale" &&
      location.storageClass === "rack" &&
      location.cubeCapacityCubicInches === DEFAULT_RACK_CUBE_CUBIC_INCHES
    ) {
      location.storageClass = "hold";
      location.cubeCapacityCubicInches = DEFAULT_HOLD_CUBE_CUBIC_INCHES;
      changed = true;
    }
  }

  const warehouse =
    system.rooms.find((room) => room.id === ROOM_WAREHOUSE) ??
    system.rooms.find(
      (room) => room.name === "Warehouse A" && divisionOf(room) === "hyperscale",
    );
  if (
    warehouse &&
    !system.locations.some(
      (location) => location.code === "PLT-01" && divisionOf(location) === "hyperscale",
    )
  ) {
    system.locations.push(
      sampleLocation(
        LOC_PLT01,
        "PLT-01",
        warehouse.id,
        "Full pallet location 1",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
        "hyperscale",
      ),
    );
    changed = true;
  }
  if (
    warehouse &&
    !system.locations.some(
      (location) => location.code === "PLT-02" && divisionOf(location) === "hyperscale",
    )
  ) {
    system.locations.push(
      sampleLocation(
        LOC_PLT02,
        "PLT-02",
        warehouse.id,
        "Full pallet location 2",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
        "hyperscale",
      ),
    );
    changed = true;
  }

  if (!system.rooms.some((room) => room.id === ROOM_DAMAGED)) {
    system.rooms.push({
      id: ROOM_DAMAGED,
      division: "hyperscale",
      name: "Damaged Hold",
      description: "Quarantine for damaged product",
    });
    changed = true;
  }
  if (
    !system.locations.some(
      (location) => location.code === "DMG-01" && divisionOf(location) === "hyperscale",
    )
  ) {
    system.locations.push(
      sampleLocation(
        LOC_DAMAGED,
        "DMG-01",
        ROOM_DAMAGED,
        "Damaged / quarantine cage",
        "hold",
        DEFAULT_HOLD_CUBE_CUBIC_INCHES,
        "hyperscale",
      ),
    );
    changed = true;
  }

  if (ensureSecurityWarehouse(system)) changed = true;
  if (ensureAlphaCampus(system)) changed = true;
  if (ensureBetaCampus(system)) changed = true;
  if (ensureSierraCampus(system)) changed = true;
  if (assignLocationSites(system)) changed = true;
  if (assignUserHomeSites(system)) changed = true;

  return changed;
}

let demoPasswordsChecked = false;

/** Test hook. Demo password checks run once per process so sign-in stays fast. */
export function resetDemoPasswordCheckForTests(): void {
  demoPasswordsChecked = false;
}

export async function ensureDemoUsers(
  system: InventorySystem,
): Promise<boolean> {
  if (!system.users) system.users = [];

  const checkPasswords = !demoPasswordsChecked;
  let changed = false;
  const now = nowIso();
  for (const account of DEMO_ACCOUNTS) {
    const existing = system.users.find((user) => user.email === account.email);
    if (!existing) {
      const usernameTaken = system.users.some(
        (user) => user.username === account.username,
      );
      if (usernameTaken) continue;
      const user: User = {
        id: account.id,
        name: account.name,
        username: account.username,
        email: account.email,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        role: account.role,
        division: divisionForRole(account.role),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      };
      system.users.push(user);
      changed = true;
      continue;
    }

    if (existing.role !== account.role) {
      existing.role = account.role;
      changed = true;
    }
    const division = divisionForRole(account.role);
    if (existing.division !== division) {
      existing.division = division;
      changed = true;
    }
    if (!existing.isActive) {
      existing.isActive = true;
      changed = true;
    }
    if (
      existing.username !== account.username &&
      !system.users.some(
        (user) => user.username === account.username && user.email !== account.email,
      )
    ) {
      existing.username = account.username;
      changed = true;
    }
    if (checkPasswords) {
      const matches = await verifyPassword(DEMO_PASSWORD, existing.passwordHash).catch(
        () => false,
      );
      if (!matches) {
        existing.passwordHash = await hashPassword(DEMO_PASSWORD);
        changed = true;
      }
    }
  }
  if (assignUserHomeSites(system)) changed = true;
  demoPasswordsChecked = true;
  return changed;
}
