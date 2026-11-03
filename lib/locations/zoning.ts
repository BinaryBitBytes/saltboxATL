import { committedCubeForLocation } from "@/lib/cubing/capacity";
import {
  defaultCubeCapacity,
  measureCaseCube,
  roundCube,
  type StorageClass,
} from "@/lib/cubing/measure";
import { divisionOf } from "@/lib/divisions";
import type {
  Bay,
  CategorizeInventoryLinesInput,
  Division,
  GenerateZoneLocationsInput,
  InventorySystem,
  Location,
  Zone,
} from "@/lib/inventory-schema";
import { DEFAULT_BAY_CUBE_BUDGET, addAisle, addBay, addStructuredLocation, addZone } from "@/lib/locations/hierarchy";
import {
  NomenclatureError,
  formatBinCode,
  padNumber,
  slotFitsBayCube,
  type OverheadSide,
  type PickHeight,
  type SlotAddress,
} from "@/lib/locations/nomenclature";
import { locationSiteId } from "@/lib/sites/database";

export { NomenclatureError } from "@/lib/locations/nomenclature";

/** One submit stays inside a single bay face of pick and overhead slots. */
export const MAX_ZONE_LOCATIONS = 480;

const PICK_ORDER: readonly PickHeight[] = ["A", "B", "C", "D"];

export type ZoneSlotDraft = {
  aisleNumber: number;
  bayNumber: number;
  slot: SlotAddress;
  code: string;
  exists: boolean;
};

export type ZoneBayPlan = {
  aisleNumber: number;
  bayNumber: number;
  budget: number;
  incoming: number;
  drafts: ZoneSlotDraft[];
};

export type ZoneLocationPlan = {
  buildingId: string;
  zoneId: string | null;
  letter: string;
  storageClass: StorageClass;
  cubeCapacityCubicInches: number;
  drafts: ZoneSlotDraft[];
  bays: ZoneBayPlan[];
};

export type ZoneGenerationResult = {
  created: number;
  skipped: number;
  zoneId: string;
  cubeCapacityCubicInches: number;
  storageClass: StorageClass;
  firstCode: string | null;
  lastCode: string | null;
};

type ZoneWarehouse = Pick<
  InventorySystem,
  | "sites"
  | "buildings"
  | "zones"
  | "aisles"
  | "bays"
  | "locations"
  | "inventoryItems"
  | "receivingOrders"
  | "itemCubes"
>;

export function resolveZoneCube(input: {
  storageClass: StorageClass;
  lengthInches?: number;
  widthInches?: number;
  heightInches?: number;
  cubeCapacityCubicInches?: number;
}): { storageClass: StorageClass; cubeCapacityCubicInches: number } {
  const measured = [input.lengthInches, input.widthInches, input.heightInches];
  const anyDimension = measured.some((value) => value != null);
  const allDimensions = measured.every((value) => value != null);
  if (anyDimension && !allDimensions) {
    throw new NomenclatureError("Enter length, width, and height together, in inches.");
  }
  if (anyDimension && input.cubeCapacityCubicInches != null) {
    throw new NomenclatureError("Set a measured case or a cubic-inch capacity, not both.");
  }
  if (anyDimension) {
    try {
      const cube = measureCaseCube(
        input.lengthInches ?? 0,
        input.widthInches ?? 0,
        input.heightInches ?? 0,
      );
      return { storageClass: input.storageClass, cubeCapacityCubicInches: cube.cubicInches };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Each dimension must be a positive number of inches.";
      throw new NomenclatureError(message);
    }
  }
  if (input.cubeCapacityCubicInches != null) {
    if (
      !Number.isFinite(input.cubeCapacityCubicInches) ||
      input.cubeCapacityCubicInches <= 0 ||
      input.cubeCapacityCubicInches > 10_000_000
    ) {
      throw new NomenclatureError("Cube capacity must be a positive number of cubic inches.");
    }
    return {
      storageClass: input.storageClass,
      cubeCapacityCubicInches: roundCube(input.cubeCapacityCubicInches),
    };
  }
  return {
    storageClass: input.storageClass,
    cubeCapacityCubicInches: defaultCubeCapacity(input.storageClass),
  };
}

export function planZoneLocations(
  system: ZoneWarehouse,
  division: Division,
  input: GenerateZoneLocationsInput,
): ZoneLocationPlan {
  const cube = resolveZoneCube(input);
  const slots = expandSlots(input);
  assertSpan(input.aisleFrom, input.aisleTo, "Aisle");
  assertSpan(input.bayFrom, input.bayTo, "Bay");
  const aisleCount = input.aisleTo - input.aisleFrom + 1;
  const bayCount = input.bayTo - input.bayFrom + 1;
  const total = aisleCount * bayCount * slots.length;
  if (total > MAX_ZONE_LOCATIONS) {
    throw new NomenclatureError(
      `That range builds ${total} locations. Submit ${MAX_ZONE_LOCATIONS} or fewer at a time.`,
    );
  }

  const building = (system.buildings ?? []).find(
    (entry) => entry.id === input.buildingId && divisionOf(entry) === division,
  );
  if (!building) throw new NomenclatureError("Building was not found in this division.");
  const site = (system.sites ?? []).find(
    (entry) => entry.id === building.siteId && divisionOf(entry) === division,
  );
  if (!site) throw new NomenclatureError("Site was not found in this division.");

  const zones = (system.zones ?? []).filter((zone) => divisionOf(zone) === division);
  let letter: string;
  let zoneId: string | null = null;
  if (input.zoneId) {
    const zone = zones.find((entry) => entry.id === input.zoneId);
    if (!zone) throw new NomenclatureError("Zone was not found in this division.");
    if (zone.buildingId !== building.id) {
      throw new NomenclatureError("That zone is not in this building.");
    }
    letter = zone.letter;
    zoneId = zone.id;
  } else {
    if (
      !input.letter ||
      !input.itemType ||
      !input.cubeSize ||
      !input.inboundVelocity ||
      !input.outboundVelocity
    ) {
      throw new NomenclatureError(
        "A new zone needs a letter, item type, cube size, and velocities.",
      );
    }
    letter = input.letter;
    if (zones.some((zone) => zone.buildingId === building.id && zone.letter === letter)) {
      throw new NomenclatureError(`Zone ${letter} already exists in this building.`);
    }
  }

  const existingCodes = new Set(
    (system.locations ?? [])
      .filter((location) => divisionOf(location) === division)
      .map((location) => location.code.toUpperCase()),
  );

  const drafts: ZoneSlotDraft[] = [];
  for (let aisle = input.aisleFrom; aisle <= input.aisleTo; aisle += 1) {
    for (let bay = input.bayFrom; bay <= input.bayTo; bay += 1) {
      for (const slot of slots) {
        const code = formatBinCode({
          codename: site.codename,
          building: building.number,
          zone: letter,
          aisle,
          bay,
          slot,
        });
        drafts.push({
          aisleNumber: aisle,
          bayNumber: bay,
          slot,
          code,
          exists: existingCodes.has(code),
        });
      }
    }
  }

  const bays: ZoneBayPlan[] = [];
  for (let aisle = input.aisleFrom; aisle <= input.aisleTo; aisle += 1) {
    for (let bay = input.bayFrom; bay <= input.bayTo; bay += 1) {
      const bayDrafts = drafts.filter(
        (draft) =>
          draft.aisleNumber === aisle && draft.bayNumber === bay && !draft.exists,
      );
      if (bayDrafts.length === 0) continue;
      const incoming = roundCube(bayDrafts.length * cube.cubeCapacityCubicInches);
      const existingBay = findBay(system, division, zoneId, aisle, bay);
      const budget = budgetForBay(
        system,
        existingBay,
        bayDrafts.map(() => cube.cubeCapacityCubicInches),
        input.bayCubeBudgetCubicInches,
        aisle,
        bay,
      );
      bays.push({
        aisleNumber: aisle,
        bayNumber: bay,
        budget,
        incoming,
        drafts: bayDrafts,
      });
    }
  }

  return {
    buildingId: building.id,
    zoneId,
    letter,
    storageClass: cube.storageClass,
    cubeCapacityCubicInches: cube.cubeCapacityCubicInches,
    drafts,
    bays,
  };
}

export function applyZoneLocations(
  system: InventorySystem,
  division: Division,
  input: GenerateZoneLocationsInput,
): ZoneGenerationResult {
  const plan = planZoneLocations(system, division, input);
  if (plan.bays.length === 0) {
    throw new NomenclatureError("Every location in that range already exists.");
  }

  return withZoneTransaction(system, () => writePlannedLocations(system, division, input, plan));
}

function writePlannedLocations(
  system: InventorySystem,
  division: Division,
  input: GenerateZoneLocationsInput,
  plan: ZoneLocationPlan,
): ZoneGenerationResult {
  const zone = plan.zoneId
    ? requireZone(system, division, plan.zoneId)
    : addZone(system, {
        division,
        buildingId: plan.buildingId,
        letter: plan.letter,
        itemType: input.itemType ?? "",
        cubeSize: input.cubeSize ?? "medium",
        projectId: input.projectId,
        poNumber: input.poNumber,
        inboundVelocity: input.inboundVelocity ?? "medium",
        outboundVelocity: input.outboundVelocity ?? "medium",
      });

  const created: Location[] = [];
  for (const bayPlan of plan.bays) {
    let aisle = (system.aisles ?? []).find(
      (entry) =>
        entry.zoneId === zone.id &&
        entry.number === bayPlan.aisleNumber &&
        divisionOf(entry) === division,
    );
    if (!aisle) {
      aisle = addAisle(system, { division, zoneId: zone.id, number: bayPlan.aisleNumber });
    }
    let bay = (system.bays ?? []).find(
      (entry) => entry.aisleId === aisle.id && entry.number === bayPlan.bayNumber,
    );
    if (!bay) {
      bay = addBay(system, {
        division,
        aisleId: aisle.id,
        number: bayPlan.bayNumber,
        cubeBudgetCubicInches: bayPlan.budget,
      });
    } else if (bay.cubeBudgetCubicInches + 0.001 < bayPlan.budget) {
      bay.cubeBudgetCubicInches = bayPlan.budget;
    }
    for (const draft of bayPlan.drafts) {
      created.push(
        addStructuredLocation(system, {
          bayId: bay.id,
          slotKind: draft.slot.kind,
          height: draft.slot.kind === "pick" ? draft.slot.height : padNumber(draft.slot.height, 2),
          position: draft.slot.kind === "pick" ? draft.slot.position : undefined,
          side: draft.slot.kind === "overhead" ? draft.slot.side : undefined,
          storageClass: plan.storageClass,
          cubeCapacityCubicInches: plan.cubeCapacityCubicInches,
        }),
      );
    }
  }

  const skipped = plan.drafts.length - created.length;
  return {
    created: created.length,
    skipped,
    zoneId: zone.id,
    cubeCapacityCubicInches: plan.cubeCapacityCubicInches,
    storageClass: plan.storageClass,
    firstCode: created[0]?.code ?? null,
    lastCode: created[created.length - 1]?.code ?? null,
  };
}

export function categorizeInventoryLines(
  system: InventorySystem,
  division: Division,
  input: CategorizeInventoryLinesInput,
): number {
  const ids = [...new Set(input.inventoryItemIds)];
  if (ids.length === 0) {
    throw new NomenclatureError("Choose at least one inventory line.");
  }
  if (ids.length > 500) {
    throw new NomenclatureError("Categorize 500 lines or fewer at a time.");
  }

  let zoneSite: string | null = null;
  if (input.zoneId) {
    const zone = requireZone(system, division, input.zoneId);
    const building = (system.buildings ?? []).find((entry) => entry.id === zone.buildingId);
    zoneSite = building?.siteId ?? null;
  }

  let updated = 0;
  for (const id of ids) {
    const item = (system.inventoryItems ?? []).find((entry) => entry.id === id);
    if (!item || divisionOf(item) !== division) {
      throw new NomenclatureError("Inventory line was not found in this division.");
    }
    if (input.zoneId && zoneSite) {
      const location = (system.locations ?? []).find((entry) => entry.id === item.locationId);
      const itemSite = location ? locationSiteId(system, location) : null;
      if (itemSite && itemSite !== zoneSite) {
        throw new NomenclatureError("That zone is in another site.");
      }
    }
    const next = input.zoneId;
    if ((item.zoneId ?? null) !== next) {
      item.zoneId = next;
      updated += 1;
    }
  }
  return updated;
}

function expandSlots(input: GenerateZoneLocationsInput): SlotAddress[] {
  const slots: SlotAddress[] = [];
  if (input.includePick) {
    const heights = heightsBetween(input.pickHeightFrom, input.pickHeightTo);
    if (input.pickPositionFrom > input.pickPositionTo) {
      throw new NomenclatureError("Pick position starts at or before where it ends.");
    }
    for (const height of heights) {
      for (let position = input.pickPositionFrom; position <= input.pickPositionTo; position += 1) {
        slots.push({ kind: "pick", height, position });
      }
    }
  }
  if (input.includeOverhead) {
    if (input.overheadFrom > input.overheadTo) {
      throw new NomenclatureError("Overhead height starts at or before where it ends.");
    }
    const sides: OverheadSide[] =
      input.overheadSides === "both" ? ["A", "B"] : [input.overheadSides];
    for (let height = input.overheadFrom; height <= input.overheadTo; height += 1) {
      for (const side of sides) {
        slots.push({ kind: "overhead", height, side });
      }
    }
  }
  if (slots.length === 0) {
    throw new NomenclatureError("Choose a pick range, an overhead range, or both.");
  }
  return slots;
}

function heightsBetween(from: PickHeight, to: PickHeight): PickHeight[] {
  const start = PICK_ORDER.indexOf(from);
  const end = PICK_ORDER.indexOf(to);
  if (start < 0 || end < 0 || start > end) {
    throw new NomenclatureError("Pick height starts at or below where it ends.");
  }
  return PICK_ORDER.slice(start, end + 1);
}

function assertSpan(from: number, to: number, label: "Aisle" | "Bay"): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 99) {
    throw new NomenclatureError(`${label} numbers run from 01 through 99.`);
  }
  if (from > to) {
    throw new NomenclatureError(
      `${label} from must be at or before ${label.toLowerCase()} to.`,
    );
  }
}

function findBay(
  system: ZoneWarehouse,
  division: Division,
  zoneId: string | null,
  aisleNumber: number,
  bayNumber: number,
): Bay | undefined {
  if (!zoneId) return undefined;
  const aisle = (system.aisles ?? []).find(
    (entry) =>
      entry.zoneId === zoneId &&
      entry.number === aisleNumber &&
      divisionOf(entry) === division,
  );
  if (!aisle) return undefined;
  return (system.bays ?? []).find(
    (entry) => entry.aisleId === aisle.id && entry.number === bayNumber,
  );
}

function bayCubeParts(system: ZoneWarehouse, bayId: string): { reserved: number; stored: number } {
  const siblings = (system.locations ?? []).filter((location) => location.bayId === bayId);
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
  return { reserved, stored };
}

/**
 * Replay the same one-slot cube check `addStructuredLocation` uses. A batch is
 * accepted only when every new slot still fits after the slots before it are
 * reserved. Stored cube counts only while it is larger than the reserved total,
 * so a slot is not rejected twice.
 */
function slotsFitBudget(
  budget: number,
  reserved: number,
  stored: number,
  slotCubes: readonly number[],
): boolean {
  let reservedNow = reserved;
  for (const slotCube of slotCubes) {
    if (
      !slotFitsBayCube({
        bayCubeBudgetCubicInches: budget,
        committedCubicInches: Math.max(reservedNow, stored),
        incomingCubicInches: slotCube,
      })
    ) {
      return false;
    }
    reservedNow += slotCube;
  }
  return true;
}

function budgetForBay(
  system: ZoneWarehouse,
  existing: Bay | undefined,
  slotCubes: readonly number[],
  requested: number | undefined,
  aisleNumber: number,
  bayNumber: number,
): number {
  const parts = existing ? bayCubeParts(system, existing.id) : { reserved: 0, stored: 0 };
  const incoming = slotCubes.reduce((sum, slotCube) => sum + slotCube, 0);
  const budget =
    existing == null
      ? (requested ?? Math.max(DEFAULT_BAY_CUBE_BUDGET, incoming))
      : requested == null
        ? existing.cubeBudgetCubicInches
        : Math.max(existing.cubeBudgetCubicInches, requested);
  if (!slotsFitBudget(budget, parts.reserved, parts.stored, slotCubes)) {
    throw new NomenclatureError(
      `Bay ${padNumber(bayNumber, 2)} in aisle ${padNumber(aisleNumber, 2)} cannot hold this cube setting.`,
    );
  }
  return budget;
}

function withZoneTransaction<T>(system: InventorySystem, work: () => T): T {
  const zones = (system.zones ?? []).map((zone) => ({ ...zone }));
  const aisles = (system.aisles ?? []).map((aisle) => ({ ...aisle }));
  const bays = (system.bays ?? []).map((bay) => ({ ...bay }));
  const locations = (system.locations ?? []).map((location) => ({ ...location }));
  try {
    return work();
  } catch (error) {
    system.zones = zones;
    system.aisles = aisles;
    system.bays = bays;
    system.locations = locations;
    throw error;
  }
}

function requireZone(system: ZoneWarehouse, division: Division, zoneId: string): Zone {
  const zone = (system.zones ?? []).find((entry) => entry.id === zoneId);
  if (!zone || divisionOf(zone) !== division) {
    throw new NomenclatureError("Zone was not found in this division.");
  }
  return zone;
}
