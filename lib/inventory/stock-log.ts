import { createId } from "@/backend/server/helperUtils";
import { damageLogHighlight } from "@/lib/inventory/damage";
import {
  INVENTORY_TRANSACTION_TYPES,
  type InventoryAllocation,
  type InventorySystem,
  type InventoryTransaction,
  type InventoryTransactionType,
} from "@/lib/inventory-schema";

/** Light blue row for a new or updated allocation hold. */
export const ALLOCATION_LOG_HIGHLIGHT =
  "border-sky-400/80 bg-sky-100/90 dark:border-sky-300/60 dark:bg-sky-950/60";

/** Light yellow row when an allocation hold is released or finished. */
export const RELEASE_LOG_HIGHLIGHT =
  "border-yellow-400/80 bg-yellow-100/90 dark:border-yellow-200/60 dark:bg-yellow-950/60";

const STOCK_LOG_LIMIT = 5000;

const STOCK_LOG_TYPE_LABELS = {
  receiving: "Receiving",
  "receiving-direct": "Receiving direction",
  "partial-pallet": "Partial pallet",
  "reopen-receiving": "Reopen receiving",
  allocation: "Allocation",
  "allocation-release": "Allocation release",
  putaway: "Putaway",
  move: "Move",
  shipping: "Shipping",
  pick: "Pick",
  cube: "Cubing",
  zone: "Zoning",
  "zone-locations": "Zone locations",
  "location-capacity": "Location capacity",
  overage: "Overage",
  shortage: "Shortage",
  damage: "Damage",
  import: "Import",
  "site-transfer": "Site transfer",
  "transfer-outbound": "Outbound transfer",
  "transfer-inbound": "Inbound transfer",
  "inbound-po-cancel": "Inbound PO cancel",
  "dock-freight-delete": "Dock freight delete",
  "check-in": "Check-in",
} as const satisfies Record<InventoryTransactionType, string>;

export const STOCK_LOG_TYPE_OPTIONS: ReadonlyArray<{ value: InventoryTransactionType; label: string }> =
  INVENTORY_TRANSACTION_TYPES.map((value) => ({
    value,
    label: STOCK_LOG_TYPE_LABELS[value],
  }));

export function stockLogHighlight(type: string): string | undefined {
  if (type === "allocation") return ALLOCATION_LOG_HIGHLIGHT;
  if (type === "allocation-release") return RELEASE_LOG_HIGHLIGHT;
  return damageLogHighlight(type);
}

type HistorySystem = {
  transactions?: InventoryTransaction[];
};

export function pushStockHistory(
  system: HistorySystem,
  input: {
    type: string;
    sku: string;
    occurredAt: string;
    quantityDelta?: number;
    locationId?: string | null;
    destinationLocationId?: string | null;
    inventoryItemId?: string | null;
    reason: string;
    createdBy?: string;
    referenceType?: string;
    referenceId?: string;
    notes?: string;
    upc?: string;
    batch?: string | null;
    division?: string;
    quantityBefore?: number;
    quantityAfter?: number;
  },
): InventoryTransaction {
  const sku = input.sku.trim();
  const entry: InventoryTransaction = {
    id: createId(),
    division: input.division === "security" ? "security" : input.division ? "hyperscale" : undefined,
    type: input.type,
    occurredAt: input.occurredAt,
    sku: sku || "STOCK",
    upc: input.upc,
    batch: input.batch ?? null,
    inventoryItemId: input.inventoryItemId ?? null,
    locationId: input.locationId ?? null,
    destinationLocationId: input.destinationLocationId ?? null,
    quantityDelta: input.quantityDelta ?? 0,
    quantityBefore: input.quantityBefore,
    quantityAfter: input.quantityAfter,
    reason: input.reason,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    createdBy: input.createdBy,
    notes: input.notes,
  };
  if (!system.transactions) system.transactions = [];
  system.transactions.unshift(entry);
  if (system.transactions.length > STOCK_LOG_LIMIT) {
    system.transactions.length = STOCK_LOG_LIMIT;
  }
  return entry;
}

export type AllocationHistoryEvent = {
  type: "allocation" | "allocation-release";
  allocation: InventoryAllocation;
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
};

export function allocationHistorySince(
  before: readonly InventoryAllocation[],
  after: readonly InventoryAllocation[],
): AllocationHistoryEvent[] {
  const prior = new Map(before.map((entry) => [entry.id, entry]));
  const events: AllocationHistoryEvent[] = [];
  for (const next of after) {
    const previous = prior.get(next.id);
    if (!previous) {
      if (next.status === "open") {
        events.push({
          type: "allocation",
          allocation: next,
          quantity: next.quantity,
          fromLocationId: null,
          toLocationId: next.locationId,
        });
      }
      continue;
    }
    if (previous.status === "open" && next.status !== "open") {
      events.push({
        type: "allocation-release",
        allocation: next,
        quantity: previous.quantity,
        fromLocationId: previous.locationId,
        toLocationId: next.locationId,
      });
      continue;
    }
    if (previous.status !== "open" || next.status !== "open") continue;
    if (next.quantity > previous.quantity) {
      events.push({
        type: "allocation",
        allocation: next,
        quantity: next.quantity - previous.quantity,
        fromLocationId: previous.locationId,
        toLocationId: next.locationId,
      });
    } else if (next.quantity < previous.quantity) {
      events.push({
        type: "allocation-release",
        allocation: next,
        quantity: previous.quantity - next.quantity,
        fromLocationId: previous.locationId,
        toLocationId: next.locationId,
      });
    } else if (next.locationId !== previous.locationId) {
      events.push({
        type: "allocation",
        allocation: next,
        quantity: 0,
        fromLocationId: previous.locationId,
        toLocationId: next.locationId,
      });
    }
  }
  return events;
}

export function describeAllocationHistory(
  event: AllocationHistoryEvent,
  locationCode: (locationId: string | null) => string,
): string {
  const sku = event.allocation.sku;
  const place = locationCode(event.toLocationId);
  const from = locationCode(event.fromLocationId);
  if (event.quantity === 0 && event.fromLocationId && event.fromLocationId !== event.toLocationId) {
    return `Allocation for ${sku} moved from ${from} to ${place}. ${event.allocation.quantity} units stay reserved.`;
  }
  if (event.type === "allocation") {
    if (event.allocation.kind === "slot") {
      return `Slotted ${event.quantity} of ${sku} for putaway at ${place}. On-hand quantity is unchanged.`;
    }
    return `Allocated ${event.quantity} of ${sku} for picks at ${place}. On-hand quantity is unchanged.`;
  }
  if (event.allocation.status === "completed" && event.allocation.kind === "slot") {
    return `Putaway finished the slot reservation of ${event.quantity} ${sku} at ${place}.`;
  }
  if (event.allocation.status === "completed") {
    return `Pick finished the allocation of ${event.quantity} ${sku} at ${place}.`;
  }
  return `Released ${event.quantity} of ${sku} from the allocation at ${place}.`;
}

export function recordAllocationHistory(
  system: InventorySystem,
  before: readonly InventoryAllocation[],
  now: string,
  createdBy?: string,
): InventoryTransaction[] {
  const codes = new Map((system.locations ?? []).map((location) => [location.id, location.code]));
  const locationCode = (locationId: string | null) =>
    (locationId && codes.get(locationId)) || locationId || "an open location";
  const written: InventoryTransaction[] = [];
  for (const event of allocationHistorySince(before, system.allocations ?? [])) {
    written.push(
      pushStockHistory(system, {
        type: event.type,
        sku: event.allocation.sku,
        batch: event.allocation.batch,
        occurredAt: now,
        quantityDelta: event.type === "allocation" ? event.quantity : -event.quantity,
        locationId: event.toLocationId,
        destinationLocationId:
          event.fromLocationId && event.fromLocationId !== event.toLocationId
            ? event.fromLocationId
            : null,
        inventoryItemId: event.allocation.inventoryItemId,
        reason: describeAllocationHistory(event, locationCode),
        createdBy: createdBy ?? event.allocation.createdBy,
        referenceType: "allocation",
        referenceId: event.allocation.id,
        division: event.allocation.division,
        notes: "On-hand quantity is unchanged.",
      }),
    );
  }
  return written;
}
