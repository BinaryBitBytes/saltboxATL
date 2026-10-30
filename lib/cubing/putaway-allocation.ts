import { binAddressDistance, binMixError, type BinOccupant } from "@/lib/inventory/bin-container";
import { cubeExceeds, roundCube, type StorageClass } from "@/lib/cubing/measure";
import { committedCubeForLocation } from "@/lib/cubing/capacity";
import { locationSiteId } from "@/lib/sites/database";
import { jobIdForPurchaseOrder } from "@/lib/purchase-orders";
import type {
  Aisle,
  Bay,
  Building,
  InventoryItem,
  ItemCube,
  Location,
  PurchaseOrder,
  ReceivingOrder,
  Zone,
} from "@/lib/inventory-schema";

/** Rack locations are the shelved bins. Pallet, staging, and hold are not. */
const SHELVED_CLASS: StorageClass = "rack";

export type PutawaySlot = {
  id: string;
  code: string;
  roomId: string;
  storageClass: StorageClass;
  division: string | null;
  siteId: string | null;
  zoneKey: string | null;
  aisleKey: string | null;
  /** Zone dedicated to one project. Empty when the zone is shared. */
  zoneProjectId: string | null;
  slotKind: "pick" | "overhead" | null;
  isActive: boolean;
  cubeCapacityCubicInches: number;
  committedCubicInches: number;
  occupants: BinOccupant[];
};

export type PutawaySlice = {
  locationId: string;
  locationCode: string;
  roomId: string;
  quantity: number;
  cubicInches: number;
  role: "primary" | "shelf" | "forced";
};

export type PutawayAllocationPlan = {
  ok: true;
  fits: boolean;
  forced: boolean;
  slices: PutawaySlice[];
  verification: string;
};

export type PutawayAllocationResult =
  | PutawayAllocationPlan
  | { ok: false; error: string };

export type PutawayAllocationInput = {
  quantity: number;
  cubicInchesPerUnit: number;
  projectId: string | null;
  poNumber?: string | null;
  sku: string;
  batch?: string | null;
  division: string;
  siteId: string;
  locationId: string;
  locations: readonly PutawaySlot[];
  force?: boolean;
  /** Cube already counted for this quantity at the selected location. */
  reservedCubicInches?: number;
};

function projectKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function sameLabel(home: string, slot: string | null): boolean {
  if (!home || !slot) return true;
  return home === slot;
}

export function locationHomeError(
  slot: Pick<PutawaySlot, "code" | "division" | "siteId">,
  division: string,
  siteId: string,
): string | null {
  if (!sameLabel(division, slot.division)) {
    return `Location ${slot.code} is in another division. Putaway stays in this division and this site.`;
  }
  if (!sameLabel(siteId, slot.siteId)) {
    return `Location ${slot.code} is at another site. Putaway stays in this division and this site.`;
  }
  return null;
}

export function unitsThatFit(openCubicInches: number, cubicInchesPerUnit: number): number {
  const per = roundCube(cubicInchesPerUnit);
  const open = roundCube(Math.max(0, openCubicInches));
  if (per <= 0 || open <= 0) return 0;
  let units = Math.floor((open + 0.001) / per);
  while (units > 0 && cubeExceeds(roundCube(units * per), open)) units -= 1;
  return units;
}

function openCube(slot: PutawaySlot, reservedCubicInches: number): number {
  return roundCube(slot.cubeCapacityCubicInches - slot.committedCubicInches + reservedCubicInches);
}

function occupantProjects(slot: PutawaySlot): string[] {
  const ids = new Set<string>();
  const zone = projectKey(slot.zoneProjectId);
  if (zone) ids.add(zone);
  for (const occupant of slot.occupants) {
    const project = projectKey(occupant.jobIdNumber);
    if (project) ids.add(project);
  }
  return [...ids];
}

function projectConflict(projectId: string | null, slot: PutawaySlot): string | null {
  const incoming = projectKey(projectId);
  const present = occupantProjects(slot);
  if (!incoming) {
    if (present.length === 0) return null;
    return `Location ${slot.code} already holds project ${present[0]}. Untagged inventory cannot be mixed into that project.`;
  }
  const other = present.find((project) => project !== incoming);
  if (!other) return null;
  return `Location ${slot.code} already holds project ${other}. Project ${incoming} stays separate.`;
}

function incomingOccupant(input: PutawayAllocationInput, quantity: number): BinOccupant {
  return {
    sku: input.sku,
    batch: input.batch,
    quantity,
    poNumber: input.poNumber,
    jobIdNumber: input.projectId,
  };
}

function shelfAccepts(slot: PutawaySlot, input: PutawayAllocationInput, quantity: number): boolean {
  if (!slot.isActive || slot.storageClass !== SHELVED_CLASS) return false;
  if (locationHomeError(slot, input.division, input.siteId)) return false;
  if (projectConflict(input.projectId, slot)) return false;
  return binMixError(incomingOccupant(input, quantity), slot.occupants, slot.code) == null;
}

function shelfRank(origin: PutawaySlot, slot: PutawaySlot): [number, number, number, string] {
  const place =
    origin.aisleKey && slot.aisleKey === origin.aisleKey
      ? 0
      : origin.zoneKey && slot.zoneKey === origin.zoneKey
        ? 1
        : 2;
  const shelf = slot.slotKind === "pick" ? 0 : slot.slotKind === "overhead" ? 1 : 2;
  return [place, shelf, binAddressDistance(origin.code, slot.code), slot.code];
}

function compareRank(left: [number, number, number, string], right: [number, number, number, string]): number {
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  if (left[2] !== right[2]) return left[2] - right[2];
  return left[3].localeCompare(right[3]);
}

function sliceCube(quantity: number, perUnit: number): number {
  return roundCube(quantity * perUnit);
}

function describePlan(slices: PutawaySlice[], forced: boolean): string {
  const primary = slices[0];
  if (!primary) return "Nothing was allocated.";
  if (forced) {
    return `Force ${primary.quantity} units into ${primary.locationCode}. This exceeds the location cube and will be highlighted on reports.`;
  }
  if (slices.length === 1) {
    return `${primary.quantity} units fit in ${primary.locationCode}.`;
  }
  const shelves = slices.filter((slice) => slice.role === "shelf");
  const shelfText = shelves
    .map((slice) => `${slice.quantity} units to shelved bin ${slice.locationCode}`)
    .join(", ");
  if (primary.role === "primary" && primary.quantity > 0) {
    return `${primary.quantity} units fit in ${primary.locationCode}. The remaining load is ${shelfText}.`;
  }
  return `None of this quantity fits in the selected location. The remaining load is ${shelfText}.`;
}

/**
 * Fill the selected location up to its open cube, then put the remainder on
 * shelved bins in the same division and site. Same aisle is preferred, then
 * the same zone. Other divisions, sites, and project IDs are never used.
 */
export function allocatePutawayQuantity(input: PutawayAllocationInput): PutawayAllocationResult {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: "Putaway quantity must be a positive whole number." };
  }
  const perUnit = roundCube(input.cubicInchesPerUnit);
  if (perUnit <= 0) {
    return {
      ok: false,
      error: `Cube ${input.sku} on the Cubing tab before directing this quantity. Enter length, width, and height in inches.`,
    };
  }

  const primary = input.locations.find((slot) => slot.id === input.locationId);
  if (!primary || !primary.isActive) {
    return { ok: false, error: "Putaway location was not found." };
  }
  const homeError = locationHomeError(primary, input.division, input.siteId);
  if (homeError) return { ok: false, error: homeError };
  const mix = projectConflict(input.projectId, primary);
  if (mix) return { ok: false, error: mix };
  const binMix = binMixError(
    incomingOccupant(input, input.quantity),
    primary.occupants,
    primary.code,
  );
  if (binMix) return { ok: false, error: binMix };

  const reserved =
    input.reservedCubicInches && input.reservedCubicInches > 0 ? input.reservedCubicInches : 0;
  const fitting = unitsThatFit(openCube(primary, reserved), perUnit);
  const primaryQuantity = Math.min(input.quantity, fitting);

  if (input.force && primaryQuantity < input.quantity) {
    const forced: PutawaySlice = {
      locationId: primary.id,
      locationCode: primary.code,
      roomId: primary.roomId,
      quantity: input.quantity,
      cubicInches: sliceCube(input.quantity, perUnit),
      role: "forced",
    };
    return {
      ok: true,
      fits: false,
      forced: true,
      slices: [forced],
      verification: describePlan([forced], true),
    };
  }

  const slices: PutawaySlice[] = [];
  if (primaryQuantity > 0) {
    slices.push({
      locationId: primary.id,
      locationCode: primary.code,
      roomId: primary.roomId,
      quantity: primaryQuantity,
      cubicInches: sliceCube(primaryQuantity, perUnit),
      role: "primary",
    });
  }

  let remaining = input.quantity - primaryQuantity;
  if (remaining === 0) {
    return {
      ok: true,
      fits: true,
      forced: false,
      slices,
      verification: describePlan(slices, false),
    };
  }

  const shelves = input.locations
    .filter((slot) => slot.id !== primary.id && shelfAccepts(slot, input, 1))
    .sort((left, right) => compareRank(shelfRank(primary, left), shelfRank(primary, right)));

  for (const shelf of shelves) {
    if (remaining <= 0) break;
    const fit = unitsThatFit(openCube(shelf, 0), perUnit);
    if (fit <= 0) continue;
    if (!shelfAccepts(shelf, input, Math.min(remaining, fit))) continue;
    const take = Math.min(remaining, fit);
    slices.push({
      locationId: shelf.id,
      locationCode: shelf.code,
      roomId: shelf.roomId,
      quantity: take,
      cubicInches: sliceCube(take, perUnit),
      role: "shelf",
    });
    remaining -= take;
  }

  if (remaining > 0) {
    return {
      ok: false,
      error: `No shelved bin in this division and site can hold the remaining ${remaining} units of ${input.sku} without mixing project IDs. Putaway will not move them to another division or site.`,
    };
  }

  return {
    ok: true,
    fits: false,
    forced: false,
    slices,
    verification: describePlan(slices, false),
  };
}

function zoneAndAisle(
  location: Location,
  bays: readonly Bay[],
  aisles: readonly Aisle[],
  zones: readonly Zone[],
): { zoneKey: string | null; aisleKey: string | null; zoneProjectId: string | null } {
  const bay = location.bayId ? bays.find((entry) => entry.id === location.bayId) : undefined;
  const aisle = bay ? aisles.find((entry) => entry.id === bay.aisleId) : undefined;
  const zone = aisle ? zones.find((entry) => entry.id === aisle.zoneId) : undefined;
  if (zone && aisle) {
    return {
      zoneKey: zone.letter,
      aisleKey: `${zone.letter}-${aisle.number}`,
      zoneProjectId: zone.projectId ?? null,
    };
  }
  return { zoneKey: null, aisleKey: null, zoneProjectId: null };
}

export function buildPutawaySlots(input: {
  locations: Location[];
  bays?: Bay[];
  aisles?: Aisle[];
  zones?: Zone[];
  buildings?: Building[];
  items: InventoryItem[];
  orders: ReceivingOrder[];
  cubes: ItemCube[];
  purchaseOrders?: PurchaseOrder[];
  excludeCaseIds?: ReadonlySet<string>;
}): PutawaySlot[] {
  const bays = input.bays ?? [];
  const aisles = input.aisles ?? [];
  const zones = input.zones ?? [];
  const buildings = input.buildings ?? [];
  const tree = { bays, aisles, zones, buildings };
  const occupants = new Map<string, BinOccupant[]>();

  for (const item of input.items) {
    if (item.quantity <= 0) continue;
    const list = occupants.get(item.locationId) ?? [];
    list.push({
      sku: item.sku,
      batch: item.batch,
      quantity: item.quantity,
      poNumber: item.poNumber,
      jobIdNumber: item.jobIdNumber,
    });
    occupants.set(item.locationId, list);
  }

  for (const order of input.orders) {
    if (order.status !== "received") continue;
    const projectId = jobIdForPurchaseOrder(input.purchaseOrders ?? [], order.poNumber);
    for (const pallet of order.pallets) {
      for (const item of pallet.cases) {
        if (item.putawayPostedAt || !item.putawayLocationId) continue;
        if (input.excludeCaseIds?.has(item.id)) continue;
        const list = occupants.get(item.putawayLocationId) ?? [];
        list.push({
          sku: item.sku,
          batch: item.batch,
          quantity: item.quantityInCase,
          poNumber: order.poNumber,
          jobIdNumber: projectId,
        });
        occupants.set(item.putawayLocationId, list);
      }
    }
  }

  return input.locations.map((location) => {
    const address = zoneAndAisle(location, bays, aisles, zones);
    return {
      id: location.id,
      code: location.code,
      roomId: location.roomId,
      storageClass: location.storageClass,
      division: location.division ?? null,
      siteId: locationSiteId(tree, location),
      zoneKey: address.zoneKey,
      aisleKey: address.aisleKey,
      zoneProjectId: address.zoneProjectId,
      slotKind: location.slotKind ?? null,
      isActive: location.isActive,
      cubeCapacityCubicInches: location.cubeCapacityCubicInches,
      committedCubicInches: committedCubeForLocation(
        location.id,
        input.items,
        input.orders as ReceivingOrder[],
        input.cubes as ItemCube[],
        input.excludeCaseIds,
      ),
      occupants: occupants.get(location.id) ?? [],
    };
  });
}
