import type { InventoryItem, Location } from "@/lib/inventory-schema";
import { inventoryKey, normalizeProjectId } from "@/lib/inventory/keys";
import type { StockChange } from "@/backend/server/inventory-ops";
import { caseCubicInches, roundCube } from "@/lib/cubing/measure";
import {
  inventoryQuantityCubeMessage,
  type CubingProfile,
} from "@/lib/cubing/workflow";
import {
  assertActiveLocation,
  assertPositiveQuantity,
  assertStockDoesNotGoNegative,
  findInventoryLine,
} from "@/lib/validation/inventory-guards";
import { ValidationError } from "@/lib/validation/errors";
import {
  assertProjectCombineAllowed,
  resolveCombinedProjectId,
} from "@/lib/moves/project";

export type MoveCubeInput = {
  cubes?: CubingProfile[];
  directedCubicInches?: (locationId: string) => number;
};

export type InventoryMoveResult = {
  items: InventoryItem[];
  changes: StockChange[];
  destinationItemId: string;
  combined: boolean;
};

function lineKey(item: Pick<InventoryItem, "sku" | "batch" | "locationId" | "projectId">) {
  return inventoryKey(item.sku, item.batch, item.locationId, item.projectId);
}

function quantityOf(items: InventoryItem[], sku: string) {
  return items.reduce((sum, item) => (item.sku === sku ? sum + item.quantity : sum), 0);
}

function onHandCube(items: InventoryItem[], locationId: string, cubes: CubingProfile[]) {
  let total = 0;
  for (const item of items) {
    if (item.locationId !== locationId || item.quantity <= 0) continue;
    const cube = cubes.find((entry) => entry.sku === item.sku);
    if (!cube) continue;
    total += caseCubicInches(item.quantity, cube);
  }
  return roundCube(total);
}

function assertDestinationHasRoom(input: {
  items: InventoryItem[];
  locations: Location[];
  sourceLocationId: string;
  destinationLocationId: string;
  sku: string;
  quantity: number;
  destinationQuantityBefore: number;
  cubes?: CubingProfile[];
  directedCubicInches?: (locationId: string) => number;
}) {
  const cube = input.cubes?.find((entry) => entry.sku === input.sku);
  if (!cube) return;
  if (input.sourceLocationId === input.destinationLocationId) return;
  const location = input.locations.find((entry) => entry.id === input.destinationLocationId);
  if (!location) return;
  const directed = input.directedCubicInches?.(location.id) ?? 0;
  const committed = roundCube(onHandCube(input.items, location.id, input.cubes ?? []) + directed);
  const message = inventoryQuantityCubeMessage({
    sku: input.sku,
    locationCode: location.code,
    capacity: location.cubeCapacityCubicInches,
    committedCubicInches: committed,
    cube,
    quantityBefore: input.destinationQuantityBefore,
    quantityAfter: input.destinationQuantityBefore + input.quantity,
  });
  if (message) throw new ValidationError(message);
}

function assertQuantityConserved(
  before: InventoryItem[],
  after: InventoryItem[],
  sku: string,
) {
  if (quantityOf(before, sku) !== quantityOf(after, sku)) {
    throw new ValidationError(
      `Moving ${sku} would duplicate on-hand quantity. The move was not applied.`,
    );
  }
}

function assertSingleLiveIdentity(items: InventoryItem[], key: string, sku: string) {
  const live = items.filter((item) => lineKey(item) === key && item.quantity > 0);
  if (live.length > 1) {
    throw new ValidationError(
      `Moving ${sku} would duplicate inventory for the same SKU, batch, location, and project.`,
    );
  }
}

export function applyInventoryMove(input: {
  items: InventoryItem[];
  locations: Location[];
  inventoryItemId: string;
  quantity: number;
  destinationLocationId: string;
  reserved?: number;
  projectId?: string | null;
  now: string;
  approveProjectCombine?: boolean;
  approverIsAdmin?: boolean;
  cubes?: CubingProfile[];
  directedCubicInches?: (locationId: string) => number;
}): InventoryMoveResult {
  assertPositiveQuantity(input.quantity, "Move quantity");
  const items = input.items.map((item) => ({ ...item }));
  const source = findInventoryLine(items, input.inventoryItemId);
  assertActiveLocation(
    input.locations.find((location) => location.id === input.destinationLocationId),
    "an inventory move",
  );

  const reserved = input.reserved ?? 0;
  const available = Math.max(0, source.quantity - reserved);
  if (input.quantity > available) {
    throw new ValidationError(
      reserved > 0
        ? `Only ${available} of ${source.sku} can move. ${reserved} are reserved for open orders.`
        : `Not enough on-hand quantity for ${source.sku}. Available: ${available}.`,
    );
  }

  const sourceProject = normalizeProjectId(source.projectId);
  const destinationProject =
    input.projectId !== undefined ? normalizeProjectId(input.projectId) : sourceProject;
  if (
    source.locationId === input.destinationLocationId &&
    destinationProject === sourceProject
  ) {
    throw new ValidationError("Choose a different location to move this inventory.");
  }
  const destinationKey = inventoryKey(
    source.sku,
    source.batch,
    input.destinationLocationId,
    destinationProject,
  );
  const destination = items.find(
    (item) => item.id !== source.id && lineKey(item) === destinationKey,
  );
  const mergesLiveStock = Boolean(destination && destination.quantity > 0);
  const reassignsProject = destinationProject !== sourceProject;
  const combined = mergesLiveStock || reassignsProject;
  assertDestinationHasRoom({
    items,
    locations: input.locations,
    sourceLocationId: source.locationId,
    destinationLocationId: input.destinationLocationId,
    sku: source.sku,
    quantity: input.quantity,
    destinationQuantityBefore: destination?.quantity ?? 0,
    cubes: input.cubes,
    directedCubicInches: input.directedCubicInches,
  });
  if (combined) {
    assertProjectCombineAllowed({
      projectIds: [sourceProject, destinationProject, destination?.projectId],
      approved: input.approveProjectCombine === true,
      approverIsAdmin: input.approverIsAdmin === true,
    });
  }

  const quantityBefore = source.quantity;
  source.quantity -= input.quantity;
  assertStockDoesNotGoNegative(quantityBefore, source.quantity);
  source.lastMovedAt = input.now;
  source.updatedAt = input.now;

  const outbound: StockChange = {
    inventoryItemId: source.id,
    sku: source.sku,
    upc: source.upc,
    batch: source.batch,
    locationId: source.locationId,
    destinationLocationId: input.destinationLocationId,
    quantityDelta: -input.quantity,
    quantityBefore,
    quantityAfter: source.quantity,
    description: source.description,
  };

  if (destination) {
    const before = destination.quantity;
    destination.quantity += input.quantity;
    destination.lastMovedAt = input.now;
    destination.updatedAt = input.now;
    if (!destination.upc) destination.upc = source.upc;
    if (!destination.description) destination.description = source.description;
    assertQuantityConserved(input.items, items, source.sku);
    assertSingleLiveIdentity(items, destinationKey, source.sku);
    return {
      items,
      destinationItemId: destination.id,
      combined,
      changes: [
        outbound,
        {
          inventoryItemId: destination.id,
          sku: destination.sku,
          upc: destination.upc,
          batch: destination.batch,
          locationId: destination.locationId,
          quantityDelta: input.quantity,
          quantityBefore: before,
          quantityAfter: destination.quantity,
          description: destination.description,
        },
      ],
    };
  }

  const created: InventoryItem = {
    ...source,
    id: crypto.randomUUID(),
    locationId: input.destinationLocationId,
    projectId: destinationProject,
    quantity: input.quantity,
    lastMovedAt: input.now,
    updatedAt: input.now,
  };
  items.push(created);
  assertQuantityConserved(input.items, items, source.sku);
  assertSingleLiveIdentity(items, destinationKey, source.sku);
  return {
    items,
    destinationItemId: created.id,
    combined,
    changes: [
      outbound,
      {
        inventoryItemId: created.id,
        sku: created.sku,
        upc: created.upc,
        batch: created.batch,
        locationId: created.locationId,
        quantityDelta: input.quantity,
        quantityBefore: 0,
        quantityAfter: created.quantity,
        description: created.description,
      },
    ],
  };
}

export function consolidateInventoryLines(input: {
  items: InventoryItem[];
  locations: Location[];
  destinationLocationId: string;
  lines: Array<{ inventoryItemId: string; quantity: number }>;
  resultingProjectId?: string | null;
  reservedByItemId?: Map<string, number>;
  now: string;
  approveProjectCombine?: boolean;
  approverIsAdmin?: boolean;
  cubes?: CubingProfile[];
  directedCubicInches?: (locationId: string) => number;
}): InventoryMoveResult {
  if (input.lines.length < 2) {
    throw new ValidationError("Select at least two inventory lines to consolidate.");
  }
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.inventoryItemId)) {
      throw new ValidationError("Each inventory line can only be consolidated once.");
    }
    seen.add(line.inventoryItemId);
  }

  const sources = input.lines.map((line) => {
    const item = input.items.find((entry) => entry.id === line.inventoryItemId);
    if (!item) {
      throw new ValidationError("One of the selected inventory lines no longer exists.");
    }
    return { item, quantity: line.quantity };
  });
  const sku = sources[0]!.item.sku;
  const batch = sources[0]!.item.batch ?? null;
  if (sources.some((source) => source.item.sku !== sku || (source.item.batch ?? null) !== batch)) {
    throw new ValidationError("Consolidate lines that share a SKU and batch.");
  }

  const resultingProjectId = resolveCombinedProjectId(
    sources.map((source) => source.item.projectId),
    input.resultingProjectId,
  );
  if (
    sources.some((source) => normalizeProjectId(source.item.projectId) != null) ||
    resultingProjectId != null
  ) {
    assertProjectCombineAllowed({
      projectIds: [
        ...sources.map((source) => source.item.projectId),
        resultingProjectId,
      ],
      approved: input.approveProjectCombine === true,
      approverIsAdmin: input.approverIsAdmin === true,
    });
  }

  const destinationKey = inventoryKey(
    sku,
    batch,
    input.destinationLocationId,
    resultingProjectId,
  );
  const isAlreadyThere = (source: (typeof sources)[number]) =>
    source.item.locationId === input.destinationLocationId &&
    normalizeProjectId(source.item.projectId) === resultingProjectId;
  const staying = sources.find(isAlreadyThere);
  const incoming = sources.filter((source) => !isAlreadyThere(source));
  const alreadyAtDestination = incoming
    .filter((source) => source.item.locationId === input.destinationLocationId)
    .reduce((sum, source) => sum + source.quantity, 0);
  const arriving = incoming
    .filter((source) => source.item.locationId !== input.destinationLocationId)
    .reduce((sum, source) => sum + source.quantity, 0);
  const existingDestination = input.items.find((item) => lineKey(item) === destinationKey);
  assertDestinationHasRoom({
    items: input.items,
    locations: input.locations,
    sourceLocationId: "",
    destinationLocationId: input.destinationLocationId,
    sku,
    quantity: arriving,
    destinationQuantityBefore: (existingDestination?.quantity ?? 0) + alreadyAtDestination,
    cubes: input.cubes,
    directedCubicInches: input.directedCubicInches,
  });

  let items = input.items;
  const changes: StockChange[] = [];
  let destinationItemId = staying?.item.id ?? existingDestination?.id ?? "";
  let combined = false;
  for (const source of incoming) {
    const moved = applyInventoryMove({
      items,
      locations: input.locations,
      inventoryItemId: source.item.id,
      quantity: source.quantity,
      destinationLocationId: input.destinationLocationId,
      reserved: input.reservedByItemId?.get(source.item.id) ?? 0,
      projectId: resultingProjectId,
      now: input.now,
      approveProjectCombine: true,
      approverIsAdmin: true,
      cubes: input.cubes,
      directedCubicInches: input.directedCubicInches,
    });
    items = moved.items;
    destinationItemId = moved.destinationItemId;
    combined = combined || moved.combined;
    changes.push(...moved.changes);
  }
  if (!destinationItemId) {
    throw new ValidationError("Enter a quantity to consolidate.");
  }
  assertQuantityConserved(input.items, items, sku);
  assertSingleLiveIdentity(items, destinationKey, sku);
  const net = changes.reduce((sum, change) => sum + change.quantityDelta, 0);
  if (net !== 0) {
    throw new ValidationError(
      `Consolidating ${sku} would duplicate on-hand quantity. The consolidation was not applied.`,
    );
  }
  return { items, changes, destinationItemId, combined };
}
