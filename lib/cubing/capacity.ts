import { caseCubicInches, roundCube } from "@/lib/cubing/measure";
import type { CubingLocation, CubingProfile } from "@/lib/cubing/workflow";
import type { ItemCube, Location, ReceivingOrder } from "@/lib/inventory-schema";

export function cubeForUnits(
  cube: CubingProfile,
  units: number,
): number {
  return caseCubicInches(units, cube);
}

export function profilesFromCubes(cubes: ItemCube[]): CubingProfile[] {
  return cubes.map((cube) => ({
    sku: cube.sku,
    cubicInches: cube.cubicInches,
    unitsPerCase: cube.unitsPerCase,
  }));
}

export function committedCubeForLocation(
  locationId: string,
  items: Array<{ sku: string; locationId: string; quantity: number }>,
  orders: ReceivingOrder[],
  cubes: ItemCube[],
  excludeCaseIds?: ReadonlySet<string>,
): number {
  const profiles = new Map(cubes.map((cube) => [cube.sku, cube]));
  let total = 0;
  for (const item of items) {
    if (item.locationId !== locationId || item.quantity <= 0) continue;
    const profile = profiles.get(item.sku);
    if (!profile) continue;
    total += caseCubicInches(item.quantity, profile);
  }
  for (const order of orders) {
    if (order.status !== "received") continue;
    for (const pallet of order.pallets) {
      for (const item of pallet.cases) {
        if (item.putawayPostedAt) continue;
        if (item.putawayLocationId !== locationId) continue;
        if (excludeCaseIds?.has(item.id)) continue;
        const profile = profiles.get(item.sku);
        if (!profile) continue;
        total += caseCubicInches(item.quantityInCase, profile);
      }
    }
  }
  return roundCube(total);
}

export function buildCubingLocations(input: {
  locations: Location[];
  items: Array<{ sku: string; locationId: string; quantity: number }>;
  orders: ReceivingOrder[];
  cubes: ItemCube[];
  excludeCaseIds?: ReadonlySet<string>;
}): CubingLocation[] {
  return input.locations.map((location) => ({
    id: location.id,
    code: location.code,
    storageClass: location.storageClass,
    cubeCapacityCubicInches: location.cubeCapacityCubicInches,
    isActive: location.isActive,
    committedCubicInches: committedCubeForLocation(
      location.id,
      input.items,
      input.orders,
      input.cubes,
      input.excludeCaseIds,
    ),
  }));
}

export function incomingCaseCube(
  cases: Array<{ sku: string; quantityInCase: number }>,
  cubes: ItemCube[],
): { cubicInches: number; missingSkus: string[] } {
  const profiles = new Map(cubes.map((cube) => [cube.sku, cube]));
  const missing = new Set<string>();
  let total = 0;
  for (const item of cases) {
    const profile = profiles.get(item.sku);
    if (!profile) {
      missing.add(item.sku);
      continue;
    }
    total += caseCubicInches(item.quantityInCase, profile);
  }
  return { cubicInches: roundCube(total), missingSkus: [...missing] };
}
