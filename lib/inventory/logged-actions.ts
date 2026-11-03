import { createId, nowIso } from "@/backend/server/helperUtils";
import {
  completeSlotAllocations,
  consumePickAllocations,
  pendingSlotCases,
  planPickAllocation,
  releaseOpenAllocation,
  releaseSlotAllocationForCase,
  releaseSlotAllocationsForOrder,
  syncSlotAllocations,
  upsertSlotAllocation,
  withAllocationHolds,
  type InitiatePickAllocationInput,
  type InitiateSlottingInput,
} from "@/lib/allocation/workflow";
import { allocateReceivingLine, withOpenReceivingReservations } from "@/lib/cubing/receiving-line";
import { formatCubicInches } from "@/lib/cubing/measure";
import { buildPutawaySlots, type PutawaySlice } from "@/lib/cubing/putaway-allocation";
import { divisionOf } from "@/lib/divisions";
import { pushStockHistory, recordAllocationHistory } from "@/lib/inventory/stock-log";
import type {
  BackorderLine,
  CaseItem,
  InventoryAllocation,
  InventorySystem,
  ItemCube,
  Location,
  Pallet,
  ReceivingOrder,
} from "@/lib/inventory-schema";
import { jobIdForPurchaseOrder } from "@/lib/purchase-orders";
import { primarySiteId } from "@/lib/sites/database";
import { ValidationError } from "@/lib/validation/errors";

export function trackAllocations(system: InventorySystem, createdBy?: string) {
  const before = (system.allocations ?? []).map((entry) => ({
    ...entry,
    picks: entry.picks.map((pick) => ({ ...pick })),
  }));
  return () => recordAllocationHistory(system, before, nowIso(), createdBy);
}

function receivingFreight(system: InventorySystem, order: ReceivingOrder) {
  return {
    poNumber: order.poNumber,
    jobIdNumber: jobIdForPurchaseOrder(system.purchaseOrders ?? [], order.poNumber),
  };
}

function casesFromSlices(source: CaseItem, slices: PutawaySlice[]): CaseItem[] {
  return slices.map((slice, index) => ({
    ...source,
    id: index === 0 ? source.id : createId(),
    quantityInCase: slice.quantity,
    putawayRoomId: slice.roomId,
    putawayLocationId: slice.locationId,
    putawayPostedAt: null,
    licensePlateNumber: index === 0 ? source.licensePlateNumber : null,
    cubeForced: slice.role === "forced",
  }));
}

/** Direct one received line and write a stock-log row when the destination changes. */
export function directReceivedCase(
  system: InventorySystem,
  order: ReceivingOrder,
  pallet: Pallet,
  caseItem: CaseItem,
  fullPallet: boolean,
): CaseItem[] {
  const cube = system.itemCubes.find((entry) => entry.sku === caseItem.sku);
  const perUnit = cube && cube.unitsPerCase > 0 ? cube.cubicInches / cube.unitsPerCase : 0;
  const division = divisionOf(order);
  const siteId = primarySiteId(system, division) ?? "";
  const freight = receivingFreight(system, order);
  const exclude = new Set([caseItem.id]);
  const slots = withAllocationHolds(
    withOpenReceivingReservations(
      buildPutawaySlots({
        locations: system.locations,
        bays: system.bays,
        aisles: system.aisles,
        zones: system.zones,
        buildings: system.buildings,
        items: system.inventoryItems,
        orders: system.receivingOrders,
        cubes: system.itemCubes,
        purchaseOrders: system.purchaseOrders,
        excludeCaseIds: exclude,
      }),
      {
        orders: system.receivingOrders,
        cubes: system.itemCubes,
        purchaseOrders: system.purchaseOrders,
        excludeCaseIds: exclude,
      },
    ),
    system.allocations,
    { caseIds: exclude },
  );
  const plan = allocateReceivingLine({
    quantity: caseItem.quantityInCase,
    cubicInchesPerUnit: perUnit,
    fullPallet,
    projectId: freight.jobIdNumber,
    poNumber: freight.poNumber,
    sku: caseItem.sku,
    batch: caseItem.batch,
    division,
    siteId,
    locations: slots,
  });
  if (!plan.ok) throw new ValidationError(plan.error);
  const index = pallet.cases.findIndex((item) => item.id === caseItem.id);
  if (index < 0) return [];
  if (!plan.directed) {
    pallet.cases[index] = {
      ...pallet.cases[index]!,
      fullPallet: null,
      putawayLocationId: null,
      putawayRoomId: null,
    };
    return [pallet.cases[index]!];
  }
  const next = casesFromSlices(
    { ...pallet.cases[index]!, fullPallet: plan.fullPallet },
    plan.slices,
  );
  const unchanged =
    plan.slices.length === 1 &&
    plan.slices[0]?.locationId === caseItem.putawayLocationId &&
    plan.slices[0]?.quantity === caseItem.quantityInCase;
  pallet.cases.splice(index, 1, ...next);
  if (!unchanged) {
    const now = nowIso();
    for (const slice of plan.slices) {
      const place =
        plan.route === "pallet" ? "full pallet zone" : plan.route === "rack" ? "rack slot" : "shelf slot";
      pushStockHistory(system, {
        type: "receiving-direct",
        sku: caseItem.sku,
        upc: caseItem.upc,
        batch: caseItem.batch,
        occurredAt: now,
        quantityDelta: slice.quantity,
        locationId: slice.locationId,
        reason:
          plan.route === "pallet"
            ? `Full pallet of ${caseItem.sku} directed to ${slice.locationCode}.`
            : `${slice.quantity} units of ${caseItem.sku} directed to ${place} ${slice.locationCode}.`,
        createdBy: order.createdBy ?? order.receiverName,
        referenceType: "receiving-order",
        referenceId: order.id,
        division,
        notes: "Directed for putaway. On-hand quantity is unchanged.",
      });
    }
  }
  return next;
}

export function applyPickAllocation(
  system: InventorySystem,
  input: InitiatePickAllocationInput,
): InventoryAllocation {
  const item = system.inventoryItems.find((entry) => entry.id === input.inventoryItemId);
  if (!item || item.quantity <= 0) {
    throw new ValidationError("Inventory line was not found.", 404);
  }
  const location = system.locations.find((entry) => entry.id === item.locationId);
  if (!location?.isActive) {
    throw new ValidationError("That inventory is not in an active location.");
  }
  if (!system.allocations) system.allocations = [];
  const finish = trackAllocations(system, input.createdBy);
  const plan = planPickAllocation({
    item,
    orders: system.customerOrders ?? [],
    allocations: system.allocations,
    quantity: input.quantity,
    now: nowIso(),
    createdBy: input.createdBy,
    id: createId(),
  });
  if (!plan.ok) throw new ValidationError(plan.error);
  finish();
  return plan.allocation;
}

export function applySlotting(
  system: InventorySystem,
  input: InitiateSlottingInput,
): InventoryAllocation[] {
  const order = system.receivingOrders.find((entry) => entry.id === input.receivingOrderId);
  if (!order) throw new ValidationError("Receiving order was not found.", 404);
  const targets = pendingSlotCases(order, input.caseId);
  if (input.caseId && targets.length === 0) {
    throw new ValidationError("That case is not waiting to be slotted.", 404);
  }
  if (targets.length === 0) {
    throw new ValidationError("This order has no inventory waiting to be slotted.");
  }
  if (!system.allocations) system.allocations = [];
  const finish = trackAllocations(system, input.createdBy);
  const directed: CaseItem[] = [];
  let undirectedSku: string | null = null;
  for (const item of targets) {
    const pallet = order.pallets.find((entry) => entry.cases.some((line) => line.id === item.id));
    if (!pallet) continue;
    const current = pallet.cases.find((line) => line.id === item.id);
    if (!current || current.putawayPostedAt) continue;
    if (current.putawayLocationId) {
      directed.push(current);
      continue;
    }
    const next = directReceivedCase(system, order, pallet, current, current.fullPallet === true);
    for (const line of next) {
      if (line.putawayPostedAt) continue;
      if (!line.putawayLocationId) {
        undirectedSku = line.sku;
        continue;
      }
      directed.push(line);
    }
  }
  if (undirectedSku) {
    throw new ValidationError(
      `Cube ${undirectedSku} on the Cubing tab before this line can be directed to a location.`,
    );
  }
  const results: InventoryAllocation[] = [];
  const seen = new Set<string>();
  for (const line of directed) {
    if (seen.has(line.id) || !line.putawayLocationId) continue;
    seen.add(line.id);
    const outcome = upsertSlotAllocation({
      allocations: system.allocations,
      order,
      caseItem: line,
      locationId: line.putawayLocationId,
      orders: system.customerOrders ?? [],
      now: nowIso(),
      createdBy: input.createdBy,
      id: createId(),
    });
    results.push(outcome.allocation);
  }
  if (results.length === 0) {
    throw new ValidationError("This order has no inventory waiting to be slotted.");
  }
  finish();
  return results;
}

export function releaseAllocationOnSystem(
  system: InventorySystem,
  allocationId: string,
): InventoryAllocation {
  const finish = trackAllocations(system);
  const released = releaseOpenAllocation(system.allocations, allocationId, nowIso());
  finish();
  return released;
}

export function logCompletedReceiving(
  system: InventorySystem,
  order: ReceivingOrder,
  backorderLines: readonly BackorderLine[],
  now: string,
): void {
  for (const item of order.pallets.flatMap((pallet) => pallet.cases)) {
    if (item.putawayPostedAt) continue;
    pushStockHistory(system, {
      type: "receiving",
      sku: item.sku,
      upc: item.upc,
      batch: item.batch,
      occurredAt: now,
      quantityDelta: 0,
      locationId: item.putawayLocationId,
      reason: `Received ${item.quantityInCase} of ${item.sku} on ${order.orderNumber}. On-hand quantity updates at putaway.`,
      createdBy: order.createdBy ?? order.receiverName,
      referenceType: "receiving-order",
      referenceId: order.id,
      division: divisionOf(order),
    });
  }
  for (const line of backorderLines) {
    const sku = line.sku.trim() || order.poNumber;
    const short = Math.max(0, line.expectedQuantity - line.receivedQuantity);
    pushStockHistory(system, {
      type: "receiving",
      sku,
      occurredAt: now,
      quantityDelta: 0,
      reason: `Backorder of ${short} ${sku} recorded on ${order.orderNumber}.`,
      createdBy: order.createdBy ?? order.receiverName,
      referenceType: "receiving-order",
      referenceId: order.id,
      division: divisionOf(order),
      notes: line.description || undefined,
    });
  }
}

export function logReopenedReceiving(
  system: InventorySystem,
  order: ReceivingOrder,
  actorName: string,
  now: string,
): void {
  pushStockHistory(system, {
    type: "reopen-receiving",
    sku: order.poNumber,
    occurredAt: now,
    quantityDelta: 0,
    reason: `${actorName} reopened ${order.orderNumber} for remaining freight.`,
    createdBy: actorName,
    referenceType: "receiving-order",
    referenceId: order.id,
    division: divisionOf(order),
  });
}

export function logPartialPallet(
  system: InventorySystem,
  order: ReceivingOrder,
  palletId: string,
  partialedBy: string,
  now: string,
): void {
  const pallet = order.pallets.find((entry) => entry.id === palletId);
  pushStockHistory(system, {
    type: "partial-pallet",
    sku: pallet?.cases[0]?.sku || order.poNumber,
    occurredAt: now,
    quantityDelta: 0,
    reason: `${partialedBy} marked pallet ${pallet?.palletNumber ?? palletId} partial on ${order.orderNumber}.`,
    createdBy: partialedBy,
    referenceType: "receiving-order",
    referenceId: order.id,
    division: divisionOf(order),
  });
}

export function applyItemCube(system: InventorySystem, cube: ItemCube): ItemCube {
  const index = system.itemCubes.findIndex((entry) => entry.sku === cube.sku);
  if (index >= 0) system.itemCubes[index] = cube;
  else system.itemCubes.push(cube);
  system.itemCubes.sort((left, right) => left.sku.localeCompare(right.sku));
  pushStockHistory(system, {
    type: "cube",
    sku: cube.sku,
    occurredAt: cube.cubedAt,
    quantityDelta: 0,
    reason: `Cubed ${cube.sku} at ${formatCubicInches(cube.cubicInches)}, ${cube.unitsPerCase} per case.`,
    createdBy: cube.cubedBy,
    referenceType: "item-cube",
    division: divisionOf(cube),
  });
  return cube;
}

export function applyLocationCapacity(
  system: InventorySystem,
  input: {
    id: string;
    storageClass: Location["storageClass"];
    cubeCapacityCubicInches: number;
    createdBy?: string;
  },
): Location {
  const location = system.locations.find((entry) => entry.id === input.id);
  if (!location) throw new ValidationError("Location was not found.", 404);
  location.storageClass = input.storageClass;
  location.cubeCapacityCubicInches = input.cubeCapacityCubicInches;
  pushStockHistory(system, {
    type: "location-capacity",
    sku: location.code,
    occurredAt: nowIso(),
    quantityDelta: 0,
    locationId: location.id,
    reason: `Set ${location.code} to ${location.storageClass} with ${formatCubicInches(location.cubeCapacityCubicInches)}.`,
    createdBy: input.createdBy,
    referenceType: "location",
    referenceId: location.id,
    division: divisionOf(location),
  });
  return location;
}

export function finishSlotHolds(
  system: InventorySystem,
  caseIds: ReadonlySet<string>,
  now: string,
  createdBy?: string,
) {
  const finish = trackAllocations(system, createdBy);
  completeSlotAllocations(system.allocations, caseIds, now);
  return finish();
}

export function consumeAllocatedPicks(
  system: InventorySystem,
  lines: readonly { inventoryItemId: string; quantity: number }[],
  now: string,
  createdBy?: string,
) {
  const finish = trackAllocations(system, createdBy);
  for (const line of lines) {
    consumePickAllocations(system.allocations, line.inventoryItemId, line.quantity, now);
  }
  return finish();
}

export function releaseHoldForCase(system: InventorySystem, caseId: string, now: string, createdBy?: string) {
  const finish = trackAllocations(system, createdBy);
  releaseSlotAllocationForCase(system.allocations, caseId, now);
  return finish();
}

export function releaseHoldsForOrder(
  system: InventorySystem,
  orderId: string,
  now: string,
  createdBy?: string,
) {
  const finish = trackAllocations(system, createdBy);
  releaseSlotAllocationsForOrder(system.allocations, orderId, now);
  return finish();
}

export function syncAllocationHolds(system: InventorySystem, order: ReceivingOrder, now: string, createdBy?: string) {
  const finish = trackAllocations(system, createdBy);
  syncSlotAllocations(system.allocations, order, now);
  return finish();
}
