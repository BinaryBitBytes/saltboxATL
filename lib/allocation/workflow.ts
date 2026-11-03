import { z } from "zod";
import type { PutawaySlot } from "@/lib/cubing/putaway-allocation";
import {
  InventoryAllocationSchema,
  UuidSchema,
  type AllocationPick,
  type CaseItem,
  type CustomerOrder,
  type InventoryAllocation,
  type InventoryItem,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import { divisionOf } from "@/lib/divisions";
import { reservedQuantity } from "@/lib/orders/availability";
import { assertAvailableQuantity } from "@/lib/orders/availability";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

export const InitiatePickAllocationInputSchema = z.object({
  inventoryItemId: UuidSchema,
  quantity: z.number().int().min(1).max(LIMITS.quantityMax).optional(),
  createdBy: z.string().optional(),
});
export type InitiatePickAllocationInput = z.infer<typeof InitiatePickAllocationInputSchema>;

export const InitiateSlottingInputSchema = z.object({
  receivingOrderId: UuidSchema,
  caseId: UuidSchema.optional(),
  createdBy: z.string().optional(),
});
export type InitiateSlottingInput = z.infer<typeof InitiateSlottingInputSchema>;

export const ReleaseAllocationInputSchema = z.object({
  allocationId: UuidSchema,
});

function batchCompatible(received: string | null | undefined, pick: string | null | undefined): boolean {
  const left = received?.trim();
  const right = pick?.trim();
  if (!left || !right) return true;
  return left.toLowerCase() === right.toLowerCase();
}

function openOrders(orders: readonly CustomerOrder[]): CustomerOrder[] {
  return [...orders]
    .filter((order) => order.status === "picking" && order.pickRequest.status === "open")
    .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
}

/** Open picks whose SKU can be filled from this received quantity, oldest order first. */
export function reportPicksAgainst(input: {
  sku: string;
  batch?: string | null;
  quantity: number;
  orders: readonly CustomerOrder[];
}): AllocationPick[] {
  let remaining = Math.max(0, input.quantity);
  const picks: AllocationPick[] = [];
  for (const order of openOrders(input.orders)) {
    for (const line of order.lines) {
      if (line.sku !== input.sku) continue;
      if (!batchCompatible(input.batch, line.batch)) continue;
      const quantityCovered = Math.min(remaining, line.quantity);
      remaining -= quantityCovered;
      picks.push({
        customerOrderId: order.id,
        orderNumber: order.orderNumber,
        pickRequestNumber: order.pickRequest.requestNumber,
        lineId: line.id,
        sku: line.sku,
        quantityNeeded: line.quantity,
        quantityCovered,
        pickLocationId: line.locationId,
      });
    }
  }
  return picks;
}

export function openLocationHold(
  allocations: readonly InventoryAllocation[] | undefined,
  locationId: string,
): InventoryAllocation | undefined {
  return (allocations ?? []).find(
    (allocation) => allocation.status === "open" && allocation.locationId === locationId,
  );
}

export function locationHeldByOther(
  allocations: readonly InventoryAllocation[] | undefined,
  locationId: string,
  allowCaseIds?: ReadonlySet<string>,
): boolean {
  return (allocations ?? []).some((allocation) => {
    if (allocation.status !== "open" || allocation.locationId !== locationId) return false;
    if (allocation.kind === "slot" && allocation.caseId && allowCaseIds?.has(allocation.caseId)) {
      return false;
    }
    return true;
  });
}

export function reservedSlotMessage(locationCode: string, hold: InventoryAllocation): string {
  const task = hold.kind === "slot" ? "putaway" : "picks";
  return `Location ${locationCode} is reserved for ${task} of ${hold.sku}. Other inventory cannot move into that slot until the allocation is finished.`;
}

export function assertLocationNotReserved(
  allocations: readonly InventoryAllocation[] | undefined,
  locationId: string,
  locationCode: string,
  allowCaseIds?: ReadonlySet<string>,
): void {
  if (!locationHeldByOther(allocations, locationId, allowCaseIds)) return;
  const hold = openLocationHold(allocations, locationId);
  if (!hold) return;
  throw new ValidationError(reservedSlotMessage(locationCode, hold));
}

/** A held slot has no open cube left for a different receipt or move. */
export function withAllocationHolds(
  slots: readonly PutawaySlot[],
  allocations: readonly InventoryAllocation[] | undefined,
  ignore?: { caseIds?: ReadonlySet<string> },
): PutawaySlot[] {
  return slots.map((slot) => {
    if (!locationHeldByOther(allocations, slot.id, ignore?.caseIds)) return slot;
    return {
      ...slot,
      occupants: slot.occupants.map((occupant) => ({ ...occupant })),
      committedCubicInches: Math.max(slot.committedCubicInches, slot.cubeCapacityCubicInches),
    };
  });
}

export function pickAllocatedQuantity(
  allocations: readonly InventoryAllocation[] | undefined,
  inventoryItemId: string,
): number {
  return (allocations ?? [])
    .filter(
      (allocation) =>
        allocation.status === "open" &&
        allocation.kind === "pick" &&
        allocation.inventoryItemId === inventoryItemId,
    )
    .reduce((sum, allocation) => sum + allocation.quantity, 0);
}

export function assertUnallocatedQuantity(input: {
  onHand: number;
  orderReserved: number;
  pickAllocated: number;
  requested: number;
  sku: string;
  purpose: "move" | "ship" | "adjust";
}): void {
  if (input.pickAllocated <= 0) {
    if (input.purpose === "adjust") return;
    assertAvailableQuantity(
      input.onHand,
      input.orderReserved,
      input.requested,
      input.sku,
      input.purpose,
    );
    return;
  }
  const free = Math.max(0, input.onHand - input.orderReserved - input.pickAllocated);
  if (input.requested <= free) return;
  const verb =
    input.purpose === "ship" ? "ship" : input.purpose === "adjust" ? "adjust" : "move";
  throw new ValidationError(
    `Not enough unallocated quantity to ${verb} ${input.sku}. On hand ${input.onHand}, reserved for open orders ${input.orderReserved}, reserved for picks ${input.pickAllocated}.`,
  );
}

export function planPickAllocation(input: {
  item: InventoryItem;
  orders: readonly CustomerOrder[];
  allocations: InventoryAllocation[];
  quantity?: number;
  now: string;
  createdBy?: string;
  id: string;
}): { ok: true; allocation: InventoryAllocation; created: boolean } | { ok: false; error: string } {
  const orderReserved = reservedQuantity([...input.orders], input.item.id);
  const existing = input.allocations.find(
    (allocation) =>
      allocation.status === "open" &&
      allocation.kind === "pick" &&
      allocation.inventoryItemId === input.item.id,
  );
  const available = Math.max(0, input.item.quantity - orderReserved);
  if (available <= 0) {
    return {
      ok: false,
      error: `No unreserved quantity of ${input.item.sku} can be allocated. On hand ${input.item.quantity}, reserved for open orders ${orderReserved}.`,
    };
  }
  const quantity = input.quantity ?? available;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "Allocation quantity must be a positive whole number." };
  }
  if (quantity > available) {
    return {
      ok: false,
      error: `Allocate at most ${available} units of ${input.item.sku}. On hand ${input.item.quantity}, reserved for open orders ${orderReserved}.`,
    };
  }
  const picks = reportPicksAgainst({
    sku: input.item.sku,
    batch: input.item.batch,
    quantity,
    orders: input.orders,
  });
  if (existing) {
    const next = InventoryAllocationSchema.parse({
      ...existing,
      quantity,
      locationId: input.item.locationId,
      sku: input.item.sku,
      batch: input.item.batch ?? null,
      picks,
    });
    Object.assign(existing, next);
    return { ok: true, allocation: existing, created: false };
  }
  const created = InventoryAllocationSchema.parse({
    id: input.id,
    division: divisionOf(input.item),
    kind: "pick",
    status: "open",
    sku: input.item.sku,
    batch: input.item.batch ?? null,
    quantity,
    locationId: input.item.locationId,
    inventoryItemId: input.item.id,
    picks,
    createdAt: input.now,
    createdBy: input.createdBy,
  });
  input.allocations.push(created);
  return { ok: true, allocation: created, created: true };
}

export function upsertSlotAllocation(input: {
  allocations: InventoryAllocation[];
  order: ReceivingOrder;
  caseItem: CaseItem;
  locationId: string;
  orders: readonly CustomerOrder[];
  now: string;
  createdBy?: string;
  id: string;
}): { allocation: InventoryAllocation; created: boolean } {
  const picks = reportPicksAgainst({
    sku: input.caseItem.sku,
    batch: input.caseItem.batch,
    quantity: input.caseItem.quantityInCase,
    orders: input.orders,
  });
  const existing = input.allocations.find(
    (allocation) =>
      allocation.status === "open" &&
      allocation.kind === "slot" &&
      allocation.caseId === input.caseItem.id,
  );
  if (existing) {
    const next = InventoryAllocationSchema.parse({
      ...existing,
      sku: input.caseItem.sku,
      batch: input.caseItem.batch ?? null,
      quantity: input.caseItem.quantityInCase,
      locationId: input.locationId,
      picks,
    });
    Object.assign(existing, next);
    return { allocation: existing, created: false };
  }
  const created = InventoryAllocationSchema.parse({
    id: input.id,
    division: divisionOf(input.order),
    kind: "slot",
    status: "open",
    sku: input.caseItem.sku,
    batch: input.caseItem.batch ?? null,
    quantity: input.caseItem.quantityInCase,
    locationId: input.locationId,
    receivingOrderId: input.order.id,
    caseId: input.caseItem.id,
    picks,
    createdAt: input.now,
    createdBy: input.createdBy,
  });
  input.allocations.push(created);
  return { allocation: created, created: true };
}

export function releaseOpenAllocation(
  allocations: InventoryAllocation[] | undefined,
  allocationId: string,
  now: string,
): InventoryAllocation {
  const allocation = (allocations ?? []).find((entry) => entry.id === allocationId);
  if (!allocation) {
    throw new ValidationError("Allocation was not found.", 404);
  }
  if (allocation.status !== "open") {
    throw new ValidationError("That allocation is already finished.");
  }
  allocation.status = "released";
  allocation.releasedAt = now;
  return allocation;
}

export function releaseSlotAllocationForCase(
  allocations: InventoryAllocation[] | undefined,
  caseId: string,
  now: string,
): void {
  for (const allocation of allocations ?? []) {
    if (allocation.status !== "open" || allocation.kind !== "slot" || allocation.caseId !== caseId) {
      continue;
    }
    allocation.status = "released";
    allocation.releasedAt = now;
  }
}

export function releaseSlotAllocationsForOrder(
  allocations: InventoryAllocation[] | undefined,
  receivingOrderId: string,
  now: string,
): void {
  for (const allocation of allocations ?? []) {
    if (allocation.status !== "open" || allocation.kind !== "slot") continue;
    if (allocation.receivingOrderId !== receivingOrderId) continue;
    allocation.status = "released";
    allocation.releasedAt = now;
  }
}

export function syncSlotAllocations(
  allocations: InventoryAllocation[] | undefined,
  order: ReceivingOrder,
  now: string,
): void {
  const cases = new Map(
    order.pallets.flatMap((pallet) => pallet.cases).map((item) => [item.id, item]),
  );
  for (const allocation of allocations ?? []) {
    if (allocation.status !== "open" || allocation.kind !== "slot") continue;
    if (allocation.receivingOrderId !== order.id || !allocation.caseId) continue;
    const item = cases.get(allocation.caseId);
    if (!item || item.putawayPostedAt || !item.putawayLocationId) {
      allocation.status = "released";
      allocation.releasedAt = now;
      continue;
    }
    allocation.locationId = item.putawayLocationId;
    allocation.quantity = item.quantityInCase;
    allocation.sku = item.sku;
    allocation.batch = item.batch ?? null;
  }
}

export function completeSlotAllocations(
  allocations: InventoryAllocation[] | undefined,
  caseIds: ReadonlySet<string>,
  now: string,
): void {
  for (const allocation of allocations ?? []) {
    if (allocation.status !== "open" || allocation.kind !== "slot" || !allocation.caseId) continue;
    if (!caseIds.has(allocation.caseId)) continue;
    allocation.status = "completed";
    allocation.completedAt = now;
  }
}

export function consumePickAllocations(
  allocations: InventoryAllocation[] | undefined,
  inventoryItemId: string,
  quantity: number,
  now: string,
): void {
  let remaining = quantity;
  const ordered = (allocations ?? [])
    .filter(
      (allocation) =>
        allocation.status === "open" &&
        allocation.kind === "pick" &&
        allocation.inventoryItemId === inventoryItemId,
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const allocation of ordered) {
    if (remaining <= 0) break;
    if (allocation.quantity <= remaining) {
      remaining -= allocation.quantity;
      allocation.status = "completed";
      allocation.completedAt = now;
      continue;
    }
    allocation.quantity -= remaining;
    remaining = 0;
  }
}

export function pendingSlotCases(order: ReceivingOrder, caseId?: string): CaseItem[] {
  if (order.status === "cancelled" || order.status === "completed") return [];
  return order.pallets.flatMap((pallet) =>
    pallet.cases.filter((item) => {
      if (item.putawayPostedAt) return false;
      if (caseId && item.id !== caseId) return false;
      return true;
    }),
  );
}
