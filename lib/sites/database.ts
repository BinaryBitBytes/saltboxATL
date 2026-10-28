import { z } from "zod";
import { asDivision, divisionOf, scopeSystem } from "@/lib/divisions";
import {
  AisleSchema,
  BaySchema,
  BuildingSchema,
  ContainerSchema,
  DivisionSchema,
  InventoryItemSchema,
  InventorySystemSchema,
  InventoryTransactionSchema,
  LicensePlateSchema,
  LocationSchema,
  RoomSchema,
  TrailerSchema,
  UuidSchema,
  ZoneSchema,
  type Aisle,
  type Bay,
  type Building,
  type Division,
  type InventorySystem,
  type Location,
  type Site,
  type Zone,
} from "@/lib/inventory-schema";
import { padNumber } from "@/lib/locations/nomenclature";

/**
 * Parent order of a warehouse. A site owns the database; every bin hangs
 * under that site through building, zone, aisle, and bay.
 */
export const WAREHOUSE_LEVELS = [
  "site",
  "building",
  "zone",
  "aisle",
  "bay",
  "location",
] as const;

export type WarehouseLevel = (typeof WAREHOUSE_LEVELS)[number];

export type WarehouseNode = {
  level: WarehouseLevel;
  id: string;
  label: string;
  children: WarehouseNode[];
};

type WarehouseTreeSource = Pick<
  InventorySystem,
  "sites" | "buildings" | "zones" | "aisles" | "bays" | "locations"
>;

const DATABASE_NAME = /^saltbox_[a-z0-9_]+$/;

export const SiteDatabaseDocumentSchema = z.object({
  databaseName: z.string().regex(DATABASE_NAME),
  siteId: UuidSchema,
  division: DivisionSchema,
  rooms: z.array(RoomSchema).default([]),
  locations: z.array(LocationSchema).default([]),
  buildings: z.array(BuildingSchema).default([]),
  zones: z.array(ZoneSchema).default([]),
  aisles: z.array(AisleSchema).default([]),
  bays: z.array(BaySchema).default([]),
  trailers: z.array(TrailerSchema).default([]),
  licensePlates: z.array(LicensePlateSchema).default([]),
  containers: z.array(ContainerSchema).default([]),
  inventoryItems: z.array(InventoryItemSchema).default([]),
  transactions: z.array(InventoryTransactionSchema).default([]),
});

export type SiteDatabaseDocument = z.infer<typeof SiteDatabaseDocumentSchema>;

export function isSiteDatabaseName(value: string): boolean {
  return DATABASE_NAME.test(value);
}

export function siteDatabaseName(site: {
  division?: unknown;
  codename: string;
}): string {
  return `saltbox_${asDivision(site.division)}_${site.codename.trim().toLowerCase()}`;
}

export function siteLabel(site: Pick<Site, "name" | "city" | "state">): string {
  return `${site.name} · ${site.city}, ${site.state}`;
}

export function locationSiteId(
  system: Pick<WarehouseTreeSource, "buildings" | "zones" | "aisles" | "bays">,
  location: Location,
): string | null {
  if (location.siteId) return location.siteId;
  if (!location.bayId) return null;
  const bay = (system.bays ?? []).find((entry) => entry.id === location.bayId);
  const aisle = bay
    ? (system.aisles ?? []).find((entry) => entry.id === bay.aisleId)
    : undefined;
  const zone = aisle
    ? (system.zones ?? []).find((entry) => entry.id === aisle.zoneId)
    : undefined;
  const building = zone
    ? (system.buildings ?? []).find((entry) => entry.id === zone.buildingId)
    : undefined;
  return building?.siteId ?? null;
}

export function primarySiteId(
  system: InventorySystem,
  division: Division,
): string | null {
  const sites = (system.sites ?? []).filter((site) => divisionOf(site) === division);
  const preferred = division === "security" ? "SIERRA" : "ALPHA";
  return (
    sites.find((site) => site.codename === preferred)?.id ??
    [...sites].sort((left, right) => left.codename.localeCompare(right.codename))[0]?.id ??
    null
  );
}

export function assignLocationSites(system: InventorySystem): boolean {
  let changed = false;
  for (const location of system.locations ?? []) {
    const resolved =
      locationSiteId(system, location) ?? primarySiteId(system, divisionOf(location));
    if (resolved && location.siteId !== resolved) {
      location.siteId = resolved;
      changed = true;
    }
  }
  return changed;
}

export function stampSiteOwnership(system: InventorySystem, siteId: string): void {
  for (const location of system.locations ?? []) {
    if (!location.siteId) location.siteId = siteId;
  }
}

function emptyDocument(site: Site): SiteDatabaseDocument {
  return {
    databaseName:
      site.databaseName && isSiteDatabaseName(site.databaseName)
        ? site.databaseName
        : siteDatabaseName(site),
    siteId: site.id,
    division: divisionOf(site),
    rooms: [],
    locations: [],
    buildings: [],
    zones: [],
    aisles: [],
    bays: [],
    trailers: [],
    licensePlates: [],
    containers: [],
    inventoryItems: [],
    transactions: [],
  };
}

function dedupeById<T extends { id: string }>(records: readonly T[]): T[] {
  const map = new Map<string, T>();
  for (const record of records) map.set(record.id, record);
  return [...map.values()];
}

export function partitionSiteDatabases(system: InventorySystem): SiteDatabaseDocument[] {
  const sites = system.sites ?? [];
  if (sites.length === 0) return [];

  const locationSites = new Map<string, string>();
  for (const location of system.locations ?? []) {
    const siteId =
      locationSiteId(system, location) ?? primarySiteId(system, divisionOf(location));
    if (siteId) locationSites.set(location.id, siteId);
  }

  const docs = new Map<string, SiteDatabaseDocument>();
  for (const site of sites) {
    docs.set(site.id, emptyDocument(site));
  }

  const roomSites = new Map<string, Set<string>>();
  const claimRoom = (roomId: string, siteId: string) => {
    const owners = roomSites.get(roomId) ?? new Set<string>();
    owners.add(siteId);
    roomSites.set(roomId, owners);
  };

  const buildingSite = new Map<string, string>();
  for (const building of system.buildings ?? []) {
    const doc = docs.get(building.siteId);
    if (!doc) continue;
    doc.buildings.push(building);
    buildingSite.set(building.id, building.siteId);
    claimRoom(building.roomId, building.siteId);
  }

  const zoneSite = new Map<string, string>();
  for (const zone of system.zones ?? []) {
    const siteId = buildingSite.get(zone.buildingId);
    if (!siteId) continue;
    zoneSite.set(zone.id, siteId);
    docs.get(siteId)?.zones.push(zone);
  }

  const aisleSite = new Map<string, string>();
  for (const aisle of system.aisles ?? []) {
    const siteId = zoneSite.get(aisle.zoneId);
    if (!siteId) continue;
    aisleSite.set(aisle.id, siteId);
    docs.get(siteId)?.aisles.push(aisle);
  }

  const baySite = new Map<string, string>();
  for (const bay of system.bays ?? []) {
    const siteId = aisleSite.get(bay.aisleId);
    if (!siteId) continue;
    baySite.set(bay.id, siteId);
    docs.get(siteId)?.bays.push(bay);
  }

  for (const location of system.locations ?? []) {
    const siteId = locationSites.get(location.id);
    const doc = siteId ? docs.get(siteId) : undefined;
    if (!siteId || !doc) continue;
    doc.locations.push({ ...location, siteId });
    claimRoom(location.roomId, siteId);
  }

  for (const room of system.rooms ?? []) {
    const owners = roomSites.get(room.id);
    if (!owners || owners.size === 0) {
      const fallback = primarySiteId(system, divisionOf(room));
      if (fallback) docs.get(fallback)?.rooms.push(room);
      continue;
    }
    for (const siteId of owners) docs.get(siteId)?.rooms.push(room);
  }

  const trailerSite = new Map<string, string>();
  for (const trailer of system.trailers ?? []) {
    const doc = docs.get(trailer.siteId);
    if (!doc) continue;
    doc.trailers.push(trailer);
    trailerSite.set(trailer.id, trailer.siteId);
  }

  const plateSite = new Map<string, string>();
  for (const plate of system.licensePlates ?? []) {
    const siteId =
      (plate.locationId ? locationSites.get(plate.locationId) : undefined) ??
      (plate.trailerId ? trailerSite.get(plate.trailerId) : undefined) ??
      primarySiteId(system, divisionOf(plate));
    if (!siteId) continue;
    plateSite.set(plate.id, siteId);
    docs.get(siteId)?.licensePlates.push(plate);
  }

  for (const container of system.containers ?? []) {
    const siteId =
      plateSite.get(container.licensePlateId) ??
      primarySiteId(system, divisionOf(container));
    if (!siteId) continue;
    docs.get(siteId)?.containers.push(container);
  }

  for (const item of system.inventoryItems ?? []) {
    const siteId =
      locationSites.get(item.locationId) ?? primarySiteId(system, divisionOf(item));
    if (!siteId) continue;
    docs.get(siteId)?.inventoryItems.push(item);
  }

  for (const txn of system.transactions ?? []) {
    const siteId =
      (txn.locationId ? locationSites.get(txn.locationId) : undefined) ??
      (txn.destinationLocationId
        ? locationSites.get(txn.destinationLocationId)
        : undefined) ??
      primarySiteId(system, divisionOf(txn));
    if (!siteId) continue;
    docs.get(siteId)?.transactions.push(txn);
  }

  return [...docs.values()].sort((left, right) =>
    left.databaseName.localeCompare(right.databaseName),
  );
}

export function withoutSiteInventory(system: InventorySystem): InventorySystem {
  const next = structuredClone(system);
  next.rooms = [];
  next.locations = [];
  next.buildings = [];
  next.zones = [];
  next.aisles = [];
  next.bays = [];
  next.trailers = [];
  next.licensePlates = [];
  next.containers = [];
  next.inventoryItems = [];
  next.transactions = [];
  return next;
}

export function mergeSiteDocument(
  system: InventorySystem,
  document: SiteDatabaseDocument,
): InventorySystem {
  const next = structuredClone(system);
  next.rooms = dedupeById([...(next.rooms ?? []), ...document.rooms]);
  next.locations = dedupeById([...(next.locations ?? []), ...document.locations]);
  next.buildings = dedupeById([...(next.buildings ?? []), ...document.buildings]);
  next.zones = dedupeById([...(next.zones ?? []), ...document.zones]);
  next.aisles = dedupeById([...(next.aisles ?? []), ...document.aisles]);
  next.bays = dedupeById([...(next.bays ?? []), ...document.bays]);
  next.trailers = dedupeById([...(next.trailers ?? []), ...document.trailers]);
  next.licensePlates = dedupeById([
    ...(next.licensePlates ?? []),
    ...document.licensePlates,
  ]);
  next.containers = dedupeById([...(next.containers ?? []), ...document.containers]);
  next.inventoryItems = dedupeById([
    ...(next.inventoryItems ?? []),
    ...document.inventoryItems,
  ]);
  next.transactions = dedupeById([
    ...(next.transactions ?? []),
    ...document.transactions,
  ]);
  return next;
}

export function applySiteDocuments(
  system: InventorySystem,
  documents: readonly SiteDatabaseDocument[],
): InventorySystem {
  return documents.reduce(
    (current, document) => mergeSiteDocument(current, document),
    withoutSiteInventory(system),
  );
}

export function parseSiteDatabase(value: unknown): SiteDatabaseDocument {
  return SiteDatabaseDocumentSchema.parse(value);
}

export function emptySiteDatabase(site: Site): SiteDatabaseDocument {
  return emptyDocument(site);
}

function replaceDivisionRecords<T extends { division?: unknown }>(
  current: readonly T[] | undefined,
  next: readonly T[] | undefined,
  division: Division,
): T[] {
  const kept = (current ?? []).filter((record) => divisionOf(record) !== division);
  const updated = (next ?? []).map((record) => ({ ...record, division }));
  return [...kept, ...updated];
}

export function commitWorkingCopy(
  catalog: InventorySystem,
  working: InventorySystem,
  division: Division,
  siteId: string,
): { catalog: InventorySystem; sites: SiteDatabaseDocument[] } {
  stampSiteOwnership(working, siteId);
  const next = structuredClone(catalog);
  next.purchaseOrders = replaceDivisionRecords(
    catalog.purchaseOrders,
    working.purchaseOrders,
    division,
  );
  next.purchaseDocuments = replaceDivisionRecords(
    catalog.purchaseDocuments,
    working.purchaseDocuments,
    division,
  );
  next.receivingOrders = replaceDivisionRecords(
    catalog.receivingOrders,
    working.receivingOrders,
    division,
  );
  next.shippingOrders = replaceDivisionRecords(
    catalog.shippingOrders,
    working.shippingOrders,
    division,
  );
  next.customerOrders = replaceDivisionRecords(
    catalog.customerOrders,
    working.customerOrders,
    division,
  );
  next.photos = replaceDivisionRecords(catalog.photos, working.photos, division);
  next.itemCubes = replaceDivisionRecords(catalog.itemCubes, working.itemCubes, division);
  next.siteTransfers = replaceDivisionRecords(
    catalog.siteTransfers,
    working.siteTransfers,
    division,
  );
  next.users = working.users;
  if (working.licensePlateLedger) next.licensePlateLedger = working.licensePlateLedger;

  const siteMap = new Map((catalog.sites ?? []).map((site) => [site.id, { ...site }]));
  for (const site of working.sites ?? []) {
    const previous = siteMap.get(site.id);
    siteMap.set(site.id, {
      ...previous,
      ...site,
      division: divisionOf(site),
      databaseName:
        site.databaseName ?? previous?.databaseName ?? siteDatabaseName(site),
    });
  }
  for (const site of siteMap.values()) {
    if (!site.databaseName || !isSiteDatabaseName(site.databaseName)) {
      site.databaseName = siteDatabaseName(site);
    }
  }
  next.sites = [...siteMap.values()];

  const stripped = withoutSiteInventory(next);
  const extracted = partitionSiteDatabases(working).map((document) =>
    SiteDatabaseDocumentSchema.parse(document),
  );
  if (!extracted.some((document) => document.siteId === siteId)) {
    const active = siteMap.get(siteId);
    if (active) extracted.push(SiteDatabaseDocumentSchema.parse(emptyDocument(active)));
  }
  return {
    catalog: InventorySystemSchema.parse(stripped),
    sites: extracted,
  };
}

export function openSiteWorkingCopy(
  catalog: InventorySystem,
  division: Division,
  document: SiteDatabaseDocument,
): InventorySystem {
  const scoped = scopeSystem(withoutSiteInventory(catalog), division);
  const merged = mergeSiteDocument(scoped, document);
  merged.sites = (catalog.sites ?? []).filter((site) => site.id === document.siteId);
  return merged;
}

export function openDivisionWorkingCopy(
  catalog: InventorySystem,
  division: Division,
  documents: readonly SiteDatabaseDocument[],
): InventorySystem {
  const scoped = scopeSystem(withoutSiteInventory(catalog), division);
  const merged = documents
    .filter((document) => document.division === division)
    .reduce((current, document) => mergeSiteDocument(current, document), scoped);
  merged.sites = (catalog.sites ?? []).filter((site) => divisionOf(site) === division);
  return merged;
}

export function mergeSite(
  target: InventorySystem,
  scoped: InventorySystem,
  siteId: string,
): InventorySystem {
  stampSiteOwnership(scoped, siteId);
  const others = partitionSiteDatabases(target).filter((document) => document.siteId !== siteId);
  const active = partitionSiteDatabases(scoped);
  const rebuilt = applySiteDocuments(target, [...others, ...active]);
  rebuilt.purchaseOrders = scoped.purchaseOrders;
  rebuilt.purchaseDocuments = scoped.purchaseDocuments ?? [];
  rebuilt.receivingOrders = scoped.receivingOrders;
  rebuilt.shippingOrders = scoped.shippingOrders;
  rebuilt.customerOrders = scoped.customerOrders ?? [];
  rebuilt.photos = scoped.photos ?? [];
  rebuilt.itemCubes = scoped.itemCubes ?? [];
  rebuilt.siteTransfers = scoped.siteTransfers ?? [];
  rebuilt.users = scoped.users;
  if (scoped.licensePlateLedger) rebuilt.licensePlateLedger = scoped.licensePlateLedger;
  const siteMap = new Map((target.sites ?? []).map((site) => [site.id, site]));
  for (const site of scoped.sites ?? []) {
    const previous = siteMap.get(site.id);
    siteMap.set(site.id, {
      ...previous,
      ...site,
      databaseName: site.databaseName ?? previous?.databaseName ?? siteDatabaseName(site),
    });
  }
  rebuilt.sites = [...siteMap.values()];
  return rebuilt;
}

export function scopeToSite(system: InventorySystem, siteId: string): InventorySystem {
  const document = partitionSiteDatabases(system).find((entry) => entry.siteId === siteId);
  const cleared = withoutSiteInventory(system);
  const merged = document ? mergeSiteDocument(cleared, document) : cleared;
  merged.sites = (system.sites ?? []).filter((site) => site.id === siteId);
  return merged;
}

export function buildWarehouseTree(system: WarehouseTreeSource): WarehouseNode[] {
  const sites = [...(system.sites ?? [])].sort((left, right) =>
    left.codename.localeCompare(right.codename),
  );
  return sites.map((site) => {
    const buildings = (system.buildings ?? [])
      .filter((building) => building.siteId === site.id)
      .sort((left, right) => left.number - right.number);
    const placed = new Set<string>();
    const buildingNodes = buildings.map((building) =>
      buildingNode(system, building, placed),
    );
    const loose = (system.locations ?? [])
      .filter(
        (location) => locationSiteId(system, location) === site.id && !placed.has(location.id),
      )
      .sort((left, right) => left.code.localeCompare(right.code));
    return {
      level: "site" as const,
      id: site.id,
      label: site.codename,
      children: [
        ...buildingNodes,
        ...loose.map((location) => locationNode(location)),
      ],
    };
  });
}

function buildingNode(
  system: WarehouseTreeSource,
  building: Building,
  placed: Set<string>,
): WarehouseNode {
  const zones = (system.zones ?? [])
    .filter((zone) => zone.buildingId === building.id)
    .sort((left, right) => left.letter.localeCompare(right.letter));
  return {
    level: "building",
    id: building.id,
    label: `Building ${padNumber(building.number, 3)}`,
    children: zones.map((zone) => zoneNode(system, zone, placed)),
  };
}

function zoneNode(system: WarehouseTreeSource, zone: Zone, placed: Set<string>): WarehouseNode {
  const aisles = (system.aisles ?? [])
    .filter((aisle) => aisle.zoneId === zone.id)
    .sort((left, right) => left.number - right.number);
  return {
    level: "zone",
    id: zone.id,
    label: `Zone ${zone.letter}`,
    children: aisles.map((aisle) => aisleNode(system, aisle, placed)),
  };
}

function aisleNode(system: WarehouseTreeSource, aisle: Aisle, placed: Set<string>): WarehouseNode {
  const bays = (system.bays ?? [])
    .filter((bay) => bay.aisleId === aisle.id)
    .sort((left, right) => left.number - right.number);
  return {
    level: "aisle",
    id: aisle.id,
    label: `Aisle ${padNumber(aisle.number, 2)}`,
    children: bays.map((bay) => bayNode(system, bay, placed)),
  };
}

function bayNode(system: WarehouseTreeSource, bay: Bay, placed: Set<string>): WarehouseNode {
  const locations = (system.locations ?? [])
    .filter((location) => location.bayId === bay.id)
    .sort((left, right) => left.code.localeCompare(right.code));
  for (const location of locations) placed.add(location.id);
  return {
    level: "bay",
    id: bay.id,
    label: `Bay ${padNumber(bay.number, 2)}`,
    children: locations.map((location) => locationNode(location)),
  };
}

function locationNode(location: Location): WarehouseNode {
  return {
    level: "location",
    id: location.id,
    label: location.code,
    children: [],
  };
}

export function collectLevels(node: WarehouseNode, into: WarehouseLevel[] = []): WarehouseLevel[] {
  into.push(node.level);
  for (const child of node.children) collectLevels(child, into);
  return into;
}
