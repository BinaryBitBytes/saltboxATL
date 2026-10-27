import {
  caseCubicInches,
  cubeExceeds,
  formatCubicInches,
  roundCube,
} from "@/lib/cubing/measure";
import { compareBinCodes, parseBinCode, type SlotAddress } from "@/lib/locations/nomenclature";
import { ValidationError } from "@/lib/validation/errors";

export type FreightIdentity = {
  poNumber?: string | null;
  jobIdNumber?: string | null;
};

export type BinOccupant = FreightIdentity & {
  sku: string;
  batch?: string | null;
  quantity: number;
};

export type StockCarton = {
  licensePlateNumber: string;
  quantity: number;
};

export type PlacementLocation = {
  id: string;
  code: string;
  isActive: boolean;
  storageClass: string;
  division?: string | null;
  cubeCapacityCubicInches: number;
  committedCubicInches: number;
};

export type OpenLocation = {
  id: string;
  code: string;
};

export type BinPlacement =
  | { ok: true }
  | { ok: false; message: string; suggestion: OpenLocation | null };

export function occupantsByLocation<T extends BinOccupant & { locationId: string }>(
  items: readonly T[],
): Map<string, BinOccupant[]> {
  const grouped = new Map<string, BinOccupant[]>();
  for (const item of items) {
    if (item.quantity <= 0) continue;
    const list = grouped.get(item.locationId) ?? [];
    list.push({
      sku: item.sku,
      batch: item.batch,
      quantity: item.quantity,
      poNumber: item.poNumber,
      jobIdNumber: item.jobIdNumber,
    });
    grouped.set(item.locationId, list);
  }
  return grouped;
}

export function normalizeFreightLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function sharesPurchaseOrderOrJob(
  left: FreightIdentity,
  right: FreightIdentity,
): boolean {
  const leftPo = normalizeFreightLabel(left.poNumber);
  const rightPo = normalizeFreightLabel(right.poNumber);
  const leftJob = normalizeFreightLabel(left.jobIdNumber);
  const rightJob = normalizeFreightLabel(right.jobIdNumber);
  if (leftPo && rightPo && leftPo.toLowerCase() === rightPo.toLowerCase()) return true;
  if (leftJob && rightJob && leftJob.toLowerCase() === rightJob.toLowerCase()) return true;
  return false;
}

function sameUntaggedSku(left: BinOccupant, right: BinOccupant): boolean {
  if (left.sku !== right.sku) return false;
  if ((left.batch ?? null) !== (right.batch ?? null)) return false;
  return (
    !normalizeFreightLabel(left.poNumber) &&
    !normalizeFreightLabel(left.jobIdNumber) &&
    !normalizeFreightLabel(right.poNumber) &&
    !normalizeFreightLabel(right.jobIdNumber)
  );
}

/** Separate items may share a bin only when each one matches the others by PO or job ID. */
export function binMixError(
  incoming: BinOccupant,
  occupants: readonly BinOccupant[],
  locationCode: string,
): string | null {
  const blocked = occupants.filter(
    (occupant) => occupant.quantity > 0 && !sameUntaggedSku(occupant, incoming) && !sharesPurchaseOrderOrJob(incoming, occupant),
  );
  if (blocked.length === 0) return null;
  return `Location ${locationCode} already holds freight that does not share a PO number or job ID with this carton. Separate items in one bin must use the same PO number or the same job ID.`;
}

export function splitIntoCartonQuantities(
  quantity: number,
  unitsPerCase: number | null | undefined,
): number[] {
  if (!Number.isInteger(quantity) || quantity <= 0) return [];
  const size = unitsPerCase && unitsPerCase > 0 ? unitsPerCase : quantity;
  const parts: number[] = [];
  let remaining = quantity;
  while (remaining > 0) {
    const take = Math.min(size, remaining);
    parts.push(take);
    remaining -= take;
  }
  return parts;
}

export function cartonsForQuantity(
  quantity: number,
  unitsPerCase: number | null | undefined,
  existingPlate: string | null | undefined,
  takePlate: () => string,
): StockCarton[] {
  return splitIntoCartonQuantities(quantity, unitsPerCase).map((part, index) => ({
    quantity: part,
    licensePlateNumber: index === 0 && existingPlate ? existingPlate : takePlate(),
  }));
}

export function materializeCartons(
  item: {
    quantity: number;
    licensePlateNumber?: string | null;
    cartons?: StockCarton[] | null;
  },
  unitsPerCase: number | null | undefined,
  takePlate: () => string,
): StockCarton[] {
  if (item.cartons && item.cartons.length > 0) {
    return item.cartons.map((carton) => ({ ...carton }));
  }
  return cartonsForQuantity(item.quantity, unitsPerCase, item.licensePlateNumber, takePlate);
}

/**
 * Move `quantity` units off a carton's license plates.
 * A whole carton keeps its plate. A split remainder keeps the original plate
 * and the piece that leaves gets a new plate for each new carton.
 */
export function takeCartons(
  cartons: readonly StockCarton[],
  quantity: number,
  unitsPerCase: number | null | undefined,
  takePlate: () => string,
): { kept: StockCarton[]; moved: StockCarton[] } {
  const kept: StockCarton[] = [];
  const moved: StockCarton[] = [];
  let remaining = quantity;
  for (const carton of cartons) {
    if (remaining <= 0) {
      kept.push({ ...carton });
      continue;
    }
    if (carton.quantity <= remaining) {
      moved.push({ ...carton });
      remaining -= carton.quantity;
      continue;
    }
    kept.push({
      licensePlateNumber: carton.licensePlateNumber,
      quantity: carton.quantity - remaining,
    });
    for (const part of splitIntoCartonQuantities(remaining, unitsPerCase)) {
      moved.push({ licensePlateNumber: takePlate(), quantity: part });
    }
    remaining = 0;
  }
  return { kept, moved };
}

export function appendCartons(
  existing: readonly StockCarton[] | null | undefined,
  incoming: readonly StockCarton[],
): StockCarton[] {
  const next = (existing ?? []).map((carton) => ({ ...carton }));
  for (const carton of incoming) {
    if (next.some((entry) => entry.licensePlateNumber === carton.licensePlateNumber)) continue;
    next.push({ ...carton });
  }
  return next;
}

function slotOrder(slot: SlotAddress): number {
  if (slot.kind === "pick") {
    return slot.height.charCodeAt(0) * 20 + slot.position;
  }
  return 1_000 + slot.height * 2 + (slot.side === "B" ? 1 : 0);
}

export function binAddressDistance(from: string, to: string): number {
  const left = parseBinCode(from);
  const right = parseBinCode(to);
  if (left && right && left.codename === right.codename) {
    return (
      Math.abs(left.building - right.building) * 1_000_000 +
      Math.abs(left.zone.charCodeAt(0) - right.zone.charCodeAt(0)) * 10_000 +
      Math.abs(left.aisle - right.aisle) * 100 +
      Math.abs(left.bay - right.bay) * 10 +
      Math.abs(slotOrder(left.slot) - slotOrder(right.slot))
    );
  }
  if (left && right) return 10_000_000 + Math.abs(left.codename.localeCompare(right.codename));
  return 100_000_000 + Math.abs(compareBinCodes(from, to));
}

export function nearestOpenLocation(input: {
  origin: PlacementLocation;
  incoming: BinOccupant;
  incomingCubicInches: number;
  locations: readonly PlacementLocation[];
  occupantsByLocation: ReadonlyMap<string, readonly BinOccupant[]>;
  excludeIds?: readonly string[];
}): OpenLocation | null {
  const sameClass = input.locations.filter(
    (location) => location.storageClass === input.origin.storageClass,
  );
  const pool = sameClass.length > 0 ? sameClass : input.locations;
  const fits = pool.filter((location) => {
    if (!location.isActive || location.id === input.origin.id) return false;
    if (input.excludeIds?.includes(location.id)) return false;
    if (
      input.origin.division &&
      location.division &&
      location.division !== input.origin.division
    ) {
      return false;
    }
    if (
      cubeExceeds(
        location.committedCubicInches + input.incomingCubicInches,
        location.cubeCapacityCubicInches,
      )
    ) {
      return false;
    }
    const occupants = input.occupantsByLocation.get(location.id) ?? [];
    return binMixError(input.incoming, occupants, location.code) == null;
  });
  fits.sort((left, right) => {
    const distance =
      binAddressDistance(input.origin.code, left.code) -
      binAddressDistance(input.origin.code, right.code);
    if (distance !== 0) return distance;
    return left.code.localeCompare(right.code);
  });
  const chosen = fits[0];
  return chosen ? { id: chosen.id, code: chosen.code } : null;
}

function cubeProblem(input: {
  locationCode: string;
  capacity: number;
  committedCubicInches: number;
  incomingCubicInches: number;
}): string | null {
  const projected = roundCube(input.committedCubicInches + input.incomingCubicInches);
  if (!cubeExceeds(projected, input.capacity)) return null;
  return `Location ${input.locationCode} can hold ${formatCubicInches(input.capacity)} and these cartons would put ${formatCubicInches(projected)} in the bin. That cube is too large for the slot.`;
}

export function checkBinPlacement(input: {
  location: PlacementLocation;
  occupants: readonly BinOccupant[];
  incoming: BinOccupant;
  incomingCubicInches: number | null;
  locations: readonly PlacementLocation[];
  occupantsByLocation: ReadonlyMap<string, readonly BinOccupant[]>;
  excludeIds?: readonly string[];
}): BinPlacement {
  const mix = binMixError(input.incoming, input.occupants, input.location.code);
  const cube =
    input.incomingCubicInches == null
      ? null
      : cubeProblem({
          locationCode: input.location.code,
          capacity: input.location.cubeCapacityCubicInches,
          committedCubicInches: input.location.committedCubicInches,
          incomingCubicInches: input.incomingCubicInches,
        });
  if (!mix && !cube) return { ok: true };
  const suggestion = nearestOpenLocation({
    origin: input.location,
    incoming: input.incoming,
    incomingCubicInches: input.incomingCubicInches ?? 0,
    locations: input.locations,
    occupantsByLocation: input.occupantsByLocation,
    excludeIds: input.excludeIds,
  });
  const message = suggestion
    ? `${mix ?? cube} Nearest open location is ${suggestion.code}.`
    : (mix ?? cube ?? "This bin cannot take these cartons.");
  return { ok: false, message, suggestion };
}

export function requireBinPlacement(
  input: Parameters<typeof checkBinPlacement>[0],
): void {
  const result = checkBinPlacement(input);
  if (!result.ok) throw new ValidationError(result.message);
}

export function incomingCubicInches(
  quantity: number,
  cube: { cubicInches: number; unitsPerCase: number } | null | undefined,
): number | null {
  if (!cube) return null;
  return caseCubicInches(quantity, cube);
}
