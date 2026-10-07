import {
  caseCubicInches,
  cubeExceeds,
  DEFAULT_PALLET_CUBE_CUBIC_INCHES,
  DEFAULT_RACK_CUBE_CUBIC_INCHES,
  formatCubicInches,
  roundCube,
  type StorageClass,
} from "@/lib/cubing/measure";

export type CubeRoute = "pallet" | "rack";

export type CubingCase = {
  id: string;
  sku: string;
  quantity: number;
};

export type CubingProfile = {
  sku: string;
  cubicInches: number;
  unitsPerCase: number;
};

export type CubingLocation = {
  id: string;
  code: string;
  storageClass: StorageClass;
  cubeCapacityCubicInches: number;
  isActive: boolean;
  committedCubicInches: number;
};

export type CubingLoad = {
  route: CubeRoute;
  caseIds: string[];
  caseCount: number;
  cubicInches: number;
  locationId: string | null;
  locationCode: string | null;
};

export type CubingWorkflowStatus =
  | "empty"
  | "missing-cube"
  | "case-too-large"
  | "fits"
  | "break-down";

export type CubingWorkflowResult = {
  status: CubingWorkflowStatus;
  palletCubeLimit: number;
  rackCubeLimit: number;
  totalCubicInches: number;
  missingSkus: string[];
  oversizedSku: string | null;
  loads: CubingLoad[];
  directive: string;
};

type MeasuredCase = CubingCase & { cubicInches: number };

function sumCube(cases: Array<{ cubicInches: number }>): number {
  return roundCube(cases.reduce((sum, item) => sum + item.cubicInches, 0));
}

export function cubeLimits(locations: CubingLocation[]): {
  palletCubeLimit: number;
  rackCubeLimit: number;
} {
  const active = locations.filter((location) => location.isActive);
  const pallet = active
    .filter((location) => location.storageClass === "pallet")
    .map((location) => location.cubeCapacityCubicInches);
  const rack = active
    .filter((location) => location.storageClass === "rack")
    .map((location) => location.cubeCapacityCubicInches);
  return {
    palletCubeLimit:
      pallet.length > 0 ? Math.max(...pallet) : DEFAULT_PALLET_CUBE_CUBIC_INCHES,
    rackCubeLimit:
      rack.length > 0 ? Math.max(...rack) : DEFAULT_RACK_CUBE_CUBIC_INCHES,
  };
}

function takeFittingCases(
  cases: MeasuredCase[],
  limit: number,
): { load: MeasuredCase[]; rest: MeasuredCase[] } {
  const load: MeasuredCase[] = [];
  const rest: MeasuredCase[] = [];
  let used = 0;
  for (const item of cases) {
    if (!cubeExceeds(used + item.cubicInches, limit)) {
      load.push(item);
      used = roundCube(used + item.cubicInches);
    } else {
      rest.push(item);
    }
  }
  return { load, rest };
}

function suggestLocation(
  route: CubeRoute,
  cubicInches: number,
  locations: CubingLocation[],
  remaining: Map<string, number>,
): CubingLocation | null {
  const open = locations
    .filter((location) => location.isActive && location.storageClass === route)
    .filter((location) => !cubeExceeds(cubicInches, remaining.get(location.id) ?? 0))
    .sort((left, right) => {
      const leftRemaining = remaining.get(left.id) ?? 0;
      const rightRemaining = remaining.get(right.id) ?? 0;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
      return left.code.localeCompare(right.code);
    });
  const chosen = open[0];
  if (!chosen) return null;
  remaining.set(
    chosen.id,
    roundCube((remaining.get(chosen.id) ?? 0) - cubicInches),
  );
  return chosen;
}

function routePhrase(route: CubeRoute): string {
  return route === "rack" ? "a racked location" : "a full pallet location";
}

function locationPhrase(load: CubingLoad): string {
  if (load.locationCode) return ` (${load.locationCode})`;
  return load.route === "rack"
    ? " (no open racked location has enough remaining cube)"
    : " (no open full pallet location has enough remaining cube)";
}

function describePlan(
  status: CubingWorkflowStatus,
  total: number,
  limits: { palletCubeLimit: number; rackCubeLimit: number },
  missingSkus: string[],
  oversized: MeasuredCase | null,
  loads: CubingLoad[],
): string {
  if (status === "empty") {
    return "Add cases before this pallet can be cubed.";
  }
  if (status === "missing-cube") {
    return `Cube ${missingSkus.join(", ")} on the Cubing tab before this pallet can be directed. Enter length, width, and height in inches. Each side is rounded up to the nearest quarter inch.`;
  }
  if (status === "case-too-large" && oversized) {
    return `Case ${oversized.sku} is ${formatCubicInches(oversized.cubicInches)}, which exceeds the full pallet cube limit of ${formatCubicInches(limits.palletCubeLimit)}. It cannot be directed to a location.`;
  }
  const primary = loads[0];
  if (!primary) return "This pallet has no cube to direct.";
  if (status === "fits") {
    return `Pallet cube is ${formatCubicInches(total)}, within the full pallet cube limit of ${formatCubicInches(limits.palletCubeLimit)}. Keep the pallet together and direct it to a full pallet location${locationPhrase(primary)}.`;
  }

  let text = `Pallet cube is ${formatCubicInches(total)} and exceeds the full pallet cube limit of ${formatCubicInches(limits.palletCubeLimit)}. Break the pallet down to ${primary.caseCount} ${primary.caseCount === 1 ? "case" : "cases"} (${formatCubicInches(primary.cubicInches)}) for a full pallet location${locationPhrase(primary)}.`;
  const rest = loads.slice(1);
  rest.forEach((load, index) => {
    const last = index === rest.length - 1;
    const lead = last ? "Route the remaining" : "Route the next";
    text += ` ${lead} ${load.caseCount} ${load.caseCount === 1 ? "case" : "cases"} (${formatCubicInches(load.cubicInches)}) to ${routePhrase(load.route)}${locationPhrase(load)}.`;
  });
  return text;
}

/**
 * Receiving and inventory both call this to decide whether a pallet fits a
 * location, how many cases to leave on it, and where the overage goes.
 */
export function cubingWorkflow(input: {
  cases: CubingCase[];
  cubes: CubingProfile[];
  locations: CubingLocation[];
}): CubingWorkflowResult {
  const limits = cubeLimits(input.locations);
  const profiles = new Map(input.cubes.map((cube) => [cube.sku, cube]));
  const missingSkus = [
    ...new Set(
      input.cases
        .filter((item) => !profiles.has(item.sku))
        .map((item) => item.sku),
    ),
  ];

  if (input.cases.length === 0) {
    return {
      status: "empty",
      ...limits,
      totalCubicInches: 0,
      missingSkus: [],
      oversizedSku: null,
      loads: [],
      directive: describePlan("empty", 0, limits, [], null, []),
    };
  }

  if (missingSkus.length > 0) {
    return {
      status: "missing-cube",
      ...limits,
      totalCubicInches: 0,
      missingSkus,
      oversizedSku: null,
      loads: [],
      directive: describePlan("missing-cube", 0, limits, missingSkus, null, []),
    };
  }

  const measured: MeasuredCase[] = input.cases.map((item) => {
    const profile = profiles.get(item.sku);
    return {
      ...item,
      cubicInches: profile ? caseCubicInches(item.quantity, profile) : 0,
    };
  });
  const totalCubicInches = sumCube(measured);
  const oversized = measured.find((item) =>
    cubeExceeds(item.cubicInches, limits.palletCubeLimit),
  );
  if (oversized) {
    return {
      status: "case-too-large",
      ...limits,
      totalCubicInches,
      missingSkus: [],
      oversizedSku: oversized.sku,
      loads: [],
      directive: describePlan(
        "case-too-large",
        totalCubicInches,
        limits,
        [],
        oversized,
        [],
      ),
    };
  }

  const remainingByLocation = new Map(
    input.locations.map((location) => [
      location.id,
      roundCube(location.cubeCapacityCubicInches - location.committedCubicInches),
    ]),
  );

  const rawLoads: Array<{ route: CubeRoute; cases: MeasuredCase[] }> = [];
  let pending = measured;
  let guard = 0;
  while (pending.length > 0 && guard < 1000) {
    guard += 1;
    const { load, rest } = takeFittingCases(pending, limits.palletCubeLimit);
    if (load.length === 0) break;
    const isFirst = rawLoads.length === 0;
    const isLast = rest.length === 0;
    let route: CubeRoute = "pallet";
    if (!isFirst && isLast) {
      route = cubeExceeds(sumCube(load), limits.rackCubeLimit) ? "pallet" : "rack";
    }
    rawLoads.push({ route, cases: load });
    pending = rest;
  }

  const loads: CubingLoad[] = rawLoads.map((load) => {
    const cubicInches = sumCube(load.cases);
    const suggested = suggestLocation(
      load.route,
      cubicInches,
      input.locations,
      remainingByLocation,
    );
    return {
      route: load.route,
      caseIds: load.cases.map((item) => item.id),
      caseCount: load.cases.length,
      cubicInches,
      locationId: suggested?.id ?? null,
      locationCode: suggested?.code ?? null,
    };
  });

  const status: CubingWorkflowStatus = loads.length > 1 ? "break-down" : "fits";
  return {
    status,
    ...limits,
    totalCubicInches,
    missingSkus: [],
    oversizedSku: null,
    loads,
    directive: describePlan(status, totalCubicInches, limits, [], null, loads),
  };
}

export function inventoryQuantityCubeMessage(input: {
  sku: string;
  locationCode: string;
  capacity: number;
  committedCubicInches: number;
  cube: CubingProfile | null;
  quantityBefore: number;
  quantityAfter: number;
}): string | null {
  if (!input.cube || input.quantityAfter <= input.quantityBefore) return null;
  const beforeCube = caseCubicInches(input.quantityBefore, input.cube);
  const afterCube = caseCubicInches(input.quantityAfter, input.cube);
  const projected = roundCube(
    input.committedCubicInches - beforeCube + afterCube,
  );
  if (!cubeExceeds(projected, input.capacity)) return null;
  const open = roundCube(input.capacity - (input.committedCubicInches - beforeCube));
  const perUnit = input.cube.cubicInches / input.cube.unitsPerCase;
  const unitsThatFit = perUnit > 0 ? Math.max(0, Math.floor(open / perUnit)) : 0;
  const additional = Math.max(0, unitsThatFit - input.quantityBefore);
  return `Location ${input.locationCode} can hold ${formatCubicInches(input.capacity)} and this change would put ${formatCubicInches(projected)} of ${input.sku} and other stock there. That quantity is too large for the location. It can take ${additional} more ${additional === 1 ? "unit" : "units"} of ${input.sku}.`;
}
