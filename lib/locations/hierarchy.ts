import { createId } from "@/backend/server/helperUtils";
import { allocateLicensePlate } from "@/lib/license-plate/assign";
import { committedCubeForLocation } from "@/lib/cubing/capacity";
import {
  defaultCubeCapacity,
  type StorageClass,
} from "@/lib/cubing/measure";
import { divisionOf } from "@/lib/divisions";
import type {
  Aisle,
  Bay,
  Building,
  Container,
  Division,
  InventorySystem,
  LicensePlate,
  Location,
  Site,
  Trailer,
  Zone,
} from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import {
  CUBE_SIZES,
  describeSlot,
  formatBinCode,
  formatContainerCode,
  isPhoneticCodename,
  formatLicensePlate,
  formatTrailerCode,
  NomenclatureError,
  padNumber,
  parseBinCode,
  slotFitsBayCube,
  TRAILER_STATUSES,
  VELOCITIES,
  type CubeSize,
  type OverheadSide,
  type PickHeight,
  type SlotAddress,
  type TrailerStatus,
  type Velocity,
} from "@/lib/locations/nomenclature";

export { NomenclatureError } from "@/lib/locations/nomenclature";

const DEFAULT_BAY_CUBE_BUDGET = 48 * 18_144;

type WithDivision = { division?: Division | null };

export function addSite(
  system: InventorySystem,
  input: {
    division: Division;
    codename: string;
    state: string;
    city: string;
    name: string;
    id?: string;
  },
): Site {
  const codename = input.codename.trim().toUpperCase();
  const state = input.state.trim().toUpperCase();
  const city = requireText(input.city, "City");
  const name = requireText(input.name, "Site name");
  if (!isPhoneticCodename(codename)) {
    throw new NomenclatureError(
      "Codename must be a phonetic site name such as ALPHA or BETA.",
    );
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new NomenclatureError("State must be a 2-letter code.");
  }
  if (
    sitesOf(system).some(
      (site) => divisionOf(site) === input.division && site.codename === codename,
    )
  ) {
    throw new NomenclatureError(
      `Codename ${codename} is already used in this division.`,
    );
  }
  const site: Site = {
    id: input.id ?? createId(),
    division: input.division,
    codename,
    state,
    city,
    name,
  };
  system.sites = [...sitesOf(system), site];
  return site;
}

export function addBuilding(
  system: InventorySystem,
  input: { division: Division; siteId: string; number: number; id?: string; roomId?: string },
): Building {
  const site = requireOwned(sitesOf(system), input.siteId, input.division, "Site");
  if (!Number.isInteger(input.number) || input.number < 1 || input.number > 100) {
    throw new NomenclatureError("Building numbers run from 001 through 100.");
  }
  if (
    buildingsOf(system).some(
      (building) => building.siteId === site.id && building.number === input.number,
    )
  ) {
    throw new NomenclatureError(
      `Building ${padNumber(input.number, 3)} already exists at this site.`,
    );
  }
  const roomName = `${site.codename}-${formatBuildingCode(input.number)}`;
  const existingRoom = (system.rooms ?? []).find(
    (room) =>
      divisionOf(room) === input.division &&
      room.name.toLowerCase() === roomName.toLowerCase(),
  );
  const roomId = input.roomId ?? existingRoom?.id ?? createId();
  if (!existingRoom) {
    system.rooms = [
      ...(system.rooms ?? []),
      {
        id: roomId,
        division: input.division,
        name: roomName,
        description: `Site ${site.codename}, building ${padNumber(input.number, 3)}`,
      },
    ];
  }
  const building: Building = {
    id: input.id ?? createId(),
    division: input.division,
    siteId: site.id,
    number: input.number,
    roomId,
  };
  system.buildings = [...buildingsOf(system), building];
  return building;
}

export function addZone(
  system: InventorySystem,
  input: {
    division: Division;
    buildingId: string;
    letter: string;
    itemType: string;
    cubeSize: CubeSize;
    projectId?: string | null;
    poNumber?: string | null;
    inboundVelocity: Velocity;
    outboundVelocity: Velocity;
    id?: string;
  },
): Zone {
  const building = requireOwned(
    buildingsOf(system),
    input.buildingId,
    input.division,
    "Building",
  );
  const letter = input.letter.trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) {
    throw new NomenclatureError("Zone must be a single letter.");
  }
  if (
    zonesOf(system).some(
      (zone) => zone.buildingId === building.id && zone.letter === letter,
    )
  ) {
    throw new NomenclatureError(`Zone ${letter} already exists in this building.`);
  }
  if (!CUBE_SIZES.includes(input.cubeSize)) {
    throw new NomenclatureError("Cube size must be small, medium, large, or pallet.");
  }
  const zone: Zone = {
    id: input.id ?? createId(),
    division: input.division,
    buildingId: building.id,
    letter,
    itemType: requireText(input.itemType, "Item type"),
    cubeSize: input.cubeSize,
    projectId: optionalLabel(input.projectId, "Project ID"),
    poNumber: optionalLabel(input.poNumber, "PO number"),
    inboundVelocity: requireVelocity(input.inboundVelocity, "Inbound velocity"),
    outboundVelocity: requireVelocity(input.outboundVelocity, "Outbound velocity"),
  };
  system.zones = [...zonesOf(system), zone];
  return zone;
}

export function addAisle(
  system: InventorySystem,
  input: { division: Division; zoneId: string; number: number; id?: string },
): Aisle {
  const zone = requireOwned(zonesOf(system), input.zoneId, input.division, "Zone");
  assertSegment(input.number, "Aisle");
  if (aislesOf(system).some((aisle) => aisle.zoneId === zone.id && aisle.number === input.number)) {
    throw new NomenclatureError(
      `Aisle ${padNumber(input.number, 2)} already exists in this zone.`,
    );
  }
  const aisle: Aisle = {
    id: input.id ?? createId(),
    division: input.division,
    zoneId: zone.id,
    number: input.number,
  };
  system.aisles = [...aislesOf(system), aisle];
  return aisle;
}

export function addBay(
  system: InventorySystem,
  input: {
    division: Division;
    aisleId: string;
    number: number;
    cubeBudgetCubicInches?: number;
    id?: string;
  },
): Bay {
  const aisle = requireOwned(aislesOf(system), input.aisleId, input.division, "Aisle");
  assertSegment(input.number, "Bay");
  if (baysOf(system).some((bay) => bay.aisleId === aisle.id && bay.number === input.number)) {
    throw new NomenclatureError(
      `Bay ${padNumber(input.number, 2)} already exists in this aisle.`,
    );
  }
  const budget = input.cubeBudgetCubicInches ?? DEFAULT_BAY_CUBE_BUDGET;
  if (!Number.isFinite(budget) || budget <= 0 || budget > 10_000_000) {
    throw new NomenclatureError("Bay cube budget must be a positive number of cubic inches.");
  }
  const bay: Bay = {
    id: input.id ?? createId(),
    division: input.division,
    aisleId: aisle.id,
    number: input.number,
    cubeBudgetCubicInches: budget,
  };
  system.bays = [...baysOf(system), bay];
  return bay;
}

export function addStructuredLocation(
  system: InventorySystem,
  input: {
    bayId: string;
    slotKind: "pick" | "overhead";
    height: string;
    position?: number | null;
    side?: string | null;
    description?: string;
    storageClass?: StorageClass;
    cubeCapacityCubicInches?: number;
    id?: string;
  },
): Location {
  const bay = baysOf(system).find((entry) => entry.id === input.bayId);
  if (!bay) throw new NomenclatureError("Bay was not found.");
  const division = divisionOf(bay);
  const aisle = requireOwned(aislesOf(system), bay.aisleId, division, "Aisle");
  const zone = requireOwned(zonesOf(system), aisle.zoneId, division, "Zone");
  const building = requireOwned(buildingsOf(system), zone.buildingId, division, "Building");
  const site = requireOwned(sitesOf(system), building.siteId, division, "Site");
  const slot = slotFromInput(input);
  const code = formatBinCode({
    codename: site.codename,
    building: building.number,
    zone: zone.letter,
    aisle: aisle.number,
    bay: bay.number,
    slot,
  });
  if (
    (system.locations ?? []).some(
      (location) => divisionOf(location) === division && location.code.toLowerCase() === code.toLowerCase(),
    )
  ) {
    throw new NomenclatureError("A location with that code already exists.");
  }
  if (
    (system.locations ?? []).some(
      (location) =>
        location.bayId === bay.id &&
        location.slotKind === slot.kind &&
        location.height === slotHeight(slot) &&
        (location.position ?? null) === (slot.kind === "pick" ? slot.position : null) &&
        (location.side ?? null) === (slot.kind === "overhead" ? slot.side : null),
    )
  ) {
    throw new NomenclatureError(`Slot ${formatSlotLabel(slot)} already exists in this bay.`);
  }
  const storageClass = input.storageClass ?? "rack";
  const capacity = input.cubeCapacityCubicInches ?? defaultCubeCapacity(storageClass);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new NomenclatureError("Slot cube must be a positive number of cubic inches.");
  }
  assertBayHasRoom(system, bay, capacity);
  const location: Location = {
    id: input.id ?? createId(),
    division,
    code,
    roomId: building.roomId,
    description: input.description?.trim() || describeSlot(slot),
    isActive: true,
    storageClass,
    cubeCapacityCubicInches: capacity,
    bayId: bay.id,
    slotKind: slot.kind,
    height: slotHeight(slot),
    position: slot.kind === "pick" ? slot.position : null,
    side: slot.kind === "overhead" ? slot.side : null,
  };
  if (!parseBinCode(location.code)) {
    throw new NomenclatureError("Generated location code is not a valid bin address.");
  }
  system.locations = [...(system.locations ?? []), location];
  return location;
}

export function addTrailer(
  system: InventorySystem,
  input: {
    division: Division;
    siteId: string;
    number: number;
    status?: TrailerStatus;
    id?: string;
  },
): Trailer {
  const site = requireOwned(sitesOf(system), input.siteId, input.division, "Site");
  const code = formatTrailerCode(input.number);
  if (
    trailersOf(system).some(
      (trailer) => divisionOf(trailer) === input.division && trailer.code === code,
    )
  ) {
    throw new NomenclatureError(`Trailer ${code} is already checked in for this division.`);
  }
  const status = input.status ?? "arrived";
  if (!TRAILER_STATUSES.includes(status)) {
    throw new NomenclatureError("Trailer status must be expected, arrived, or departed.");
  }
  const trailer: Trailer = {
    id: input.id ?? createId(),
    division: input.division,
    siteId: site.id,
    code,
    status,
  };
  system.trailers = [...trailersOf(system), trailer];
  return trailer;
}

export function addLicensePlate(
  system: InventorySystem,
  input: {
    division: Division;
    locationId?: string | null;
    trailerId?: string | null;
    id?: string;
    code?: string;
    issuedBy?: string | null;
  },
): LicensePlate {
  const hasLocation = Boolean(input.locationId);
  const hasTrailer = Boolean(input.trailerId);
  if (hasLocation === hasTrailer) {
    throw new NomenclatureError("A license plate sits in one bin or on one trailer.");
  }
  if (input.locationId) {
    const location = (system.locations ?? []).find((entry) => entry.id === input.locationId);
    if (!location || divisionOf(location) !== input.division) {
      throw new NomenclatureError("Location was not found in this division.");
    }
  }
  if (input.trailerId) {
    requireOwned(trailersOf(system), input.trailerId, input.division, "Trailer");
  }
  const id = input.id ?? createId();
  const code = input.code
    ? formatLicensePlate(input.code)
    : allocateLicensePlate(system, input.issuedBy ?? "hierarchy").code;
  if (
    platesOf(system).some(
      (plate) => divisionOf(plate) === input.division && plate.code === code,
    )
  ) {
    throw new NomenclatureError(`License plate ${code} already exists in this division.`);
  }
  const plate: LicensePlate = {
    id,
    division: input.division,
    code,
    locationId: input.locationId ?? null,
    trailerId: input.trailerId ?? null,
  };
  system.licensePlates = [...platesOf(system), plate];
  return plate;
}

export function addContainer(
  system: InventorySystem,
  input: { division: Division; licensePlateId: string; id?: string; code?: string },
): Container {
  requireOwned(platesOf(system), input.licensePlateId, input.division, "License plate");
  const id = input.id ?? createId();
  const code = input.code ? formatContainerCode(input.code) : formatContainerCode(id);
  if (
    containersOf(system).some(
      (container) => divisionOf(container) === input.division && container.code === code,
    )
  ) {
    throw new NomenclatureError(`Container ${code} already exists in this division.`);
  }
  const container: Container = {
    id,
    division: input.division,
    licensePlateId: input.licensePlateId,
    code,
  };
  system.containers = [...containersOf(system), container];
  return container;
}

function assertBayHasRoom(system: InventorySystem, bay: Bay, incoming: number): void {
  const siblings = (system.locations ?? []).filter((location) => location.bayId === bay.id);
  const reserved = siblings.reduce(
    (sum, location) => sum + location.cubeCapacityCubicInches,
    0,
  );
  const stored = siblings.reduce(
    (sum, location) =>
      sum +
      committedCubeForLocation(
        location.id,
        system.inventoryItems ?? [],
        system.receivingOrders ?? [],
        system.itemCubes ?? [],
      ),
    0,
  );
  const committed = Math.max(reserved, stored);
  if (
    !slotFitsBayCube({
      bayCubeBudgetCubicInches: bay.cubeBudgetCubicInches,
      committedCubicInches: committed,
      incomingCubicInches: incoming,
    })
  ) {
    throw new NomenclatureError(
      "This slot's cube plus the cube already committed in the bay exceeds the bay budget.",
    );
  }
}

function slotFromInput(input: {
  slotKind: "pick" | "overhead";
  height: string;
  position?: number | null;
  side?: string | null;
}): SlotAddress {
  if (input.slotKind === "pick") {
    return {
      kind: "pick",
      height: input.height as PickHeight,
      position: input.position ?? 0,
    };
  }
  return {
    kind: "overhead",
    height: Number(input.height),
    side: (input.side ?? "") as OverheadSide,
  };
}

function slotHeight(slot: SlotAddress): string {
  return slot.kind === "pick" ? slot.height : padNumber(slot.height, 2);
}

function formatSlotLabel(slot: SlotAddress): string {
  return slot.kind === "pick"
    ? `${slot.height}${padNumber(slot.position, 2)}`
    : `${padNumber(slot.height, 2)}${slot.side}`;
}

function assertSegment(value: number, label: "Aisle" | "Bay"): void {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new NomenclatureError(`${label} numbers run from 01 through 99.`);
  }
}

function requireVelocity(value: string, label: string): Velocity {
  if (!VELOCITIES.includes(value as Velocity)) {
    throw new NomenclatureError(`${label} must be fast, medium, or slow.`);
  }
  return value as Velocity;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > LIMITS.text || /[<>]/.test(trimmed)) {
    throw new NomenclatureError(`${label} is required and cannot contain markup.`);
  }
  return trimmed;
}

function optionalLabel(value: string | null | undefined, label: string): string | null {
  if (value == null || value.trim() === "") return null;
  return requireText(value, label);
}

function requireOwned<T extends WithDivision & { id: string }>(
  records: T[],
  id: string,
  division: Division,
  label: string,
): T {
  const found = records.find((record) => record.id === id);
  if (!found || divisionOf(found) !== division) {
    throw new NomenclatureError(`${label} was not found in this division.`);
  }
  return found;
}

function sitesOf(system: InventorySystem): Site[] {
  return system.sites ?? [];
}
function buildingsOf(system: InventorySystem): Building[] {
  return system.buildings ?? [];
}
function zonesOf(system: InventorySystem): Zone[] {
  return system.zones ?? [];
}
function aislesOf(system: InventorySystem): Aisle[] {
  return system.aisles ?? [];
}
function baysOf(system: InventorySystem): Bay[] {
  return system.bays ?? [];
}
function trailersOf(system: InventorySystem): Trailer[] {
  return system.trailers ?? [];
}
function platesOf(system: InventorySystem): LicensePlate[] {
  return system.licensePlates ?? [];
}
function containersOf(system: InventorySystem): Container[] {
  return system.containers ?? [];
}

export function formatBuildingCode(number: number): string {
  return padNumber(number, 3);
}
