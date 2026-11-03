import { reservedQuantity } from "@/lib/orders/availability";
import { pushStockHistory } from "@/lib/inventory/stock-log";
import type { CaseItem, InventoryAllocation, InventorySystem, ReceivingOrder } from "@/lib/inventory-schema";

/**
 * Persisted allocation rows are the only thing that reduces available quantity
 * and fills a location's cube between requests. Heal them against the inventory
 * and receiving lines that are actually loaded so a stale row cannot keep
 * blocking moves, shipping, adjustments, putaway, receiving, or transfers.
 *
 * A pick hold whose location is not in this system is left alone. Callers that
 * save the result must pass every site in the division: a missing line is
 * released when its saved location is loaded, which is only safe once the
 * other sites' inventory is loaded too.
 *
 * Stock-log rows added here are kept in front of the existing history. The
 * per-site log cap must not drop another site's rows when this runs on a
 * combined division copy that is about to be saved.
 */
export function reconcilePersistedAllocations(system: InventorySystem, now: string): boolean {
  const allocations = system.allocations ?? [];
  if (allocations.length === 0) return false;

  const priorTransactions = [...(system.transactions ?? [])];
  const priorIds = new Set(priorTransactions.map((entry) => entry.id));
  const locations = new Map((system.locations ?? []).map((location) => [location.id, location]));
  const items = new Map((system.inventoryItems ?? []).map((item) => [item.id, item]));
  const cases = indexCases(system.receivingOrders);
  let changed = false;

  for (const allocation of allocations) {
    if (allocation.status !== "open") continue;
    if (allocation.kind === "slot") {
      if (healSlot(system, allocation, cases, now)) changed = true;
      continue;
    }
    if (healPick(system, allocation, locations, items, now)) changed = true;
  }

  changed = capPickHolds(system, items, now) || changed;
  const created = (system.transactions ?? []).filter((entry) => !priorIds.has(entry.id));
  if (created.length > 0 || (system.transactions?.length ?? 0) !== priorTransactions.length) {
    system.transactions = [...created, ...priorTransactions];
  }
  return changed;
}

function indexCases(
  orders: readonly ReceivingOrder[] | undefined,
): Map<string, { order: ReceivingOrder; item: CaseItem }> | null {
  if (!orders) return null;
  const cases = new Map<string, { order: ReceivingOrder; item: CaseItem }>();
  for (const order of orders) {
    for (const pallet of order.pallets) {
      for (const item of pallet.cases) {
        cases.set(item.id, { order, item });
      }
    }
  }
  return cases;
}

function locationCode(system: InventorySystem, locationId: string | null | undefined): string {
  if (!locationId) return "an open location";
  return system.locations?.find((location) => location.id === locationId)?.code ?? locationId;
}

function releaseHold(
  system: InventorySystem,
  allocation: InventoryAllocation,
  now: string,
  reason: string,
): void {
  const quantity = allocation.quantity;
  allocation.status = "released";
  allocation.releasedAt = now;
  pushStockHistory(system, {
    type: "allocation-release",
    sku: allocation.sku,
    batch: allocation.batch,
    occurredAt: now,
    quantityDelta: -quantity,
    locationId: allocation.locationId,
    inventoryItemId: allocation.inventoryItemId,
    reason,
    createdBy: "system",
    referenceType: "allocation",
    referenceId: allocation.id,
    division: allocation.division,
    notes: "Persisted allocation no longer matches inventory.",
  });
}

function shrinkHold(
  system: InventorySystem,
  allocation: InventoryAllocation,
  nextQuantity: number,
  now: string,
  reason: string,
): void {
  if (nextQuantity <= 0) {
    releaseHold(system, allocation, now, reason);
    return;
  }
  const removed = allocation.quantity - nextQuantity;
  allocation.quantity = nextQuantity;
  pushStockHistory(system, {
    type: "allocation-release",
    sku: allocation.sku,
    batch: allocation.batch,
    occurredAt: now,
    quantityDelta: -removed,
    locationId: allocation.locationId,
    inventoryItemId: allocation.inventoryItemId,
    reason,
    createdBy: "system",
    referenceType: "allocation",
    referenceId: allocation.id,
    division: allocation.division,
    notes: "Persisted allocation no longer matches inventory.",
  });
}

function healSlot(
  system: InventorySystem,
  allocation: InventoryAllocation,
  cases: Map<string, { order: ReceivingOrder; item: CaseItem }> | null,
  now: string,
): boolean {
  if (!cases) return false;
  const found = allocation.caseId ? cases.get(allocation.caseId) : undefined;
  const place = locationCode(system, allocation.locationId);
  if (!found || found.order.status === "cancelled" || found.order.status === "completed" || found.item.putawayPostedAt) {
    releaseHold(
      system,
      allocation,
      now,
      `Released the slot reservation of ${allocation.quantity} ${allocation.sku} at ${place} because that case is no longer waiting for putaway.`,
    );
    return true;
  }
  let changed = false;
  const directed = found.item.putawayLocationId;
  if (directed && directed !== allocation.locationId) {
    allocation.locationId = directed;
    changed = true;
  }
  if (found.item.quantityInCase !== allocation.quantity) {
    if (found.item.quantityInCase < allocation.quantity) {
      shrinkHold(
        system,
        allocation,
        found.item.quantityInCase,
        now,
        `Released ${allocation.quantity - found.item.quantityInCase} of ${allocation.sku} from the slot reservation at ${locationCode(system, allocation.locationId)} because the case is smaller.`,
      );
    } else {
      allocation.quantity = found.item.quantityInCase;
    }
    changed = true;
  }
  if (found.item.sku !== allocation.sku) {
    allocation.sku = found.item.sku;
    changed = true;
  }
  return changed;
}

function healPick(
  system: InventorySystem,
  allocation: InventoryAllocation,
  locations: Map<string, { id: string; isActive: boolean; code: string }>,
  items: Map<string, { id: string; sku: string; quantity: number; locationId: string }>,
  now: string,
): boolean {
  const place = locationCode(system, allocation.locationId);
  if (!allocation.inventoryItemId) {
    releaseHold(
      system,
      allocation,
      now,
      `Released ${allocation.quantity} of ${allocation.sku} at ${place} because the pick allocation has no inventory line.`,
    );
    return true;
  }
  const item = items.get(allocation.inventoryItemId);
  const locationLoaded = locations.has(allocation.locationId);
  if (!item) {
    if (!locationLoaded) return false;
    releaseHold(
      system,
      allocation,
      now,
      `Released ${allocation.quantity} of ${allocation.sku} at ${place} because that inventory line is no longer on hand.`,
    );
    return true;
  }
  const location = locations.get(item.locationId);
  if (location && !location.isActive) {
    releaseHold(
      system,
      allocation,
      now,
      `Released ${allocation.quantity} of ${item.sku} at ${location.code} because that location is inactive.`,
    );
    return true;
  }
  let changed = false;
  if (item.locationId !== allocation.locationId) {
    const from = locationCode(system, allocation.locationId);
    allocation.locationId = item.locationId;
    pushStockHistory(system, {
      type: "allocation",
      sku: item.sku,
      batch: allocation.batch,
      occurredAt: now,
      quantityDelta: 0,
      locationId: item.locationId,
      inventoryItemId: item.id,
      reason: `Persisted pick allocation for ${item.sku} moved from ${from} to ${locationCode(system, item.locationId)}.`,
      createdBy: "system",
      referenceType: "allocation",
      referenceId: allocation.id,
      division: allocation.division,
      notes: "Persisted allocation no longer matches inventory.",
    });
    changed = true;
  }
  if (item.sku !== allocation.sku) {
    allocation.sku = item.sku;
    changed = true;
  }
  if (item.quantity <= 0) {
    releaseHold(
      system,
      allocation,
      now,
      `Released ${allocation.quantity} of ${item.sku} because that inventory line no longer has on-hand quantity.`,
    );
    return true;
  }
  return changed;
}

function capPickHolds(
  system: InventorySystem,
  items: Map<string, { id: string; sku: string; quantity: number; locationId: string }>,
  now: string,
): boolean {
  const open = (system.allocations ?? [])
    .filter((allocation) => allocation.status === "open" && allocation.kind === "pick" && allocation.inventoryItemId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const groups = new Map<string, InventoryAllocation[]>();
  for (const allocation of open) {
    const id = allocation.inventoryItemId!;
    if (!items.has(id)) continue;
    const list = groups.get(id) ?? [];
    list.push(allocation);
    groups.set(id, list);
  }
  let changed = false;
  for (const [itemId, holds] of groups) {
    const item = items.get(itemId)!;
    const cap = Math.max(0, item.quantity - reservedQuantity(system.customerOrders ?? [], itemId));
    let used = 0;
    for (const allocation of holds) {
      const room = cap - used;
      if (room <= 0) {
        releaseHold(
          system,
          allocation,
          now,
          `Released ${allocation.quantity} of ${item.sku} at ${locationCode(system, allocation.locationId)} because on-hand quantity is already reserved.`,
        );
        changed = true;
        continue;
      }
      if (allocation.quantity > room) {
        shrinkHold(
          system,
          allocation,
          room,
          now,
          `Released ${allocation.quantity - room} of ${item.sku} at ${locationCode(system, allocation.locationId)} so the persisted pick hold matches on-hand quantity.`,
        );
        changed = true;
      }
      used += Math.min(allocation.quantity, room);
    }
  }
  return changed;
}
