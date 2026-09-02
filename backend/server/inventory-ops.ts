import { createId } from "@/backend/server/helperUtils";
import type {
  CaseItem,
  InventoryItem,
  Pallet,
  ReceivingOrder,
  ShippingPick,
} from "@/lib/inventory-schema";
import { inventoryKey } from "@/lib/inventory/keys";
import {
  assertEnoughOnHand,
  assertFiniteQuantity,
  assertPositiveQuantity,
  assertStockDoesNotGoNegative,
  findInventoryLine,
} from "@/lib/validation/inventory-guards";

export { inventoryKey };

export type StockChange = {
  inventoryItemId: string;
  sku: string;
  upc?: string;
  batch: string | null;
  locationId: string;
  destinationLocationId?: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  description?: string;
};

export function caseItemAttributesFromInbound(
  orders: ReceivingOrder[],
  sku: string,
  batch: string | null,
): { manufacturer: string; color: string | null } {
  let manufacturer = "";
  let color: string | null = null;
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const pallet of order.pallets) {
      for (const item of pallet.cases) {
        if (item.sku !== sku) continue;
        if ((item.batch ?? null) !== (batch ?? null)) continue;
        manufacturer = item.manufacturer ?? "";
        color = item.color ?? null;
      }
    }
  }
  return { manufacturer, color };
}

export function recountPallet(pallet: Pallet): Pallet {
  const skus = new Set(pallet.cases.map((item) => item.sku));
  return {
    ...pallet,
    actualCaseCount: pallet.cases.length,
    actualSkuCount: skus.size,
  };
}

function itemMap(items: InventoryItem[]) {
  return new Map(
    items.map((item) => [
      inventoryKey(item.sku, item.batch, item.locationId),
      item,
    ]),
  );
}

export function addQuantity(
  items: InventoryItem[],
  input: {
    sku: string;
    upc?: string;
    batch: string | null;
    locationId: string;
    quantity: number;
    description?: string;
    now: string;
  },
): { items: InventoryItem[]; change: StockChange } {
  assertPositiveQuantity(input.quantity);
  const map = itemMap(items);
  const key = inventoryKey(input.sku, input.batch, input.locationId);
  const existing = map.get(key);

  if (existing) {
    const quantityBefore = existing.quantity;
    const quantityAfter = quantityBefore + input.quantity;
    const next: InventoryItem = {
      ...existing,
      quantity: quantityAfter,
      upc: existing.upc ?? input.upc,
      description: existing.description ?? input.description,
      lastMovedAt: input.now,
      updatedAt: input.now,
    };
    map.set(key, next);
    return {
      items: [...map.values()],
      change: {
        inventoryItemId: next.id,
        sku: next.sku,
        upc: next.upc,
        batch: next.batch,
        locationId: next.locationId,
        quantityDelta: input.quantity,
        quantityBefore,
        quantityAfter,
        description: next.description,
      },
    };
  }

  const created: InventoryItem = {
    id: createId(),
    sku: input.sku,
    upc: input.upc,
    batch: input.batch,
    locationId: input.locationId,
    quantity: input.quantity,
    description: input.description,
    lastMovedAt: input.now,
    updatedAt: input.now,
  };
  map.set(key, created);
  return {
    items: [...map.values()],
    change: {
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
  };
}

export function putAwayCases(
  items: InventoryItem[],
  cases: CaseItem[],
  now: string,
): { items: InventoryItem[]; changes: StockChange[] } {
  let next = items;
  const changes: StockChange[] = [];

  for (const caseItem of cases) {
    if (!caseItem.putawayLocationId) {
      throw new Error(
        `SKU ${caseItem.sku} is missing a putaway location. Assign a bin before putting this case away.`,
      );
    }

    const result = addQuantity(next, {
      sku: caseItem.sku,
      upc: caseItem.upc,
      batch: caseItem.batch,
      locationId: caseItem.putawayLocationId,
      quantity: caseItem.quantityInCase,
      description: caseItem.description,
      now,
    });
    next = result.items;
    changes.push(result.change);
  }

  return { items: next, changes };
}

export function setOnHandQuantity(
  items: InventoryItem[],
  input: {
    sku: string;
    upc?: string;
    batch: string | null;
    locationId: string;
    quantity: number;
    description?: string;
    now: string;
  },
): { items: InventoryItem[]; change: StockChange | null } {
  assertFiniteQuantity(input.quantity);
  const map = itemMap(items);
  const key = inventoryKey(input.sku, input.batch, input.locationId);
  const existing = map.get(key);

  if (!existing) {
    if (input.quantity === 0) {
      return { items, change: null };
    }
    const created: InventoryItem = {
      id: createId(),
      sku: input.sku,
      upc: input.upc,
      batch: input.batch,
      locationId: input.locationId,
      quantity: input.quantity,
      description: input.description,
      lastMovedAt: input.now,
      updatedAt: input.now,
    };
    map.set(key, created);
    return {
      items: [...map.values()],
      change: {
        inventoryItemId: created.id,
        sku: created.sku,
        upc: created.upc,
        batch: created.batch,
        locationId: created.locationId,
        quantityDelta: created.quantity,
        quantityBefore: 0,
        quantityAfter: created.quantity,
        description: created.description,
      },
    };
  }

  if (existing.quantity === input.quantity) {
    return { items, change: null };
  }

  const quantityBefore = existing.quantity;
  const next: InventoryItem = {
    ...existing,
    quantity: input.quantity,
    upc: existing.upc ?? input.upc,
    description: existing.description ?? input.description,
    lastMovedAt: input.now,
    updatedAt: input.now,
  };
  map.set(key, next);
  return {
    items: [...map.values()],
    change: {
      inventoryItemId: next.id,
      sku: next.sku,
      upc: next.upc,
      batch: next.batch,
      locationId: next.locationId,
      quantityDelta: input.quantity - quantityBefore,
      quantityBefore,
      quantityAfter: input.quantity,
      description: next.description,
    },
  };
}

export function pickFromInventory(
  items: InventoryItem[],
  picks: ShippingPick[],
  now: string,
): {
  remaining: InventoryItem[];
  shippedCases: CaseItem[];
  changes: StockChange[];
} {
  const remaining = items.map((item) => ({ ...item }));
  const shippedCases: CaseItem[] = [];
  const changes: StockChange[] = [];

  for (const pick of picks) {
    const item = findInventoryLine(remaining, pick.inventoryItemId);
    assertPositiveQuantity(pick.quantity, "Pick quantity");
    assertEnoughOnHand(item.quantity, pick.quantity, item.sku);

    const quantityBefore = item.quantity;
    item.quantity -= pick.quantity;
    assertStockDoesNotGoNegative(quantityBefore, item.quantity);
    item.lastMovedAt = now;
    item.updatedAt = now;

    changes.push({
      inventoryItemId: item.id,
      sku: item.sku,
      upc: item.upc,
      batch: item.batch,
      locationId: item.locationId,
      quantityDelta: -pick.quantity,
      quantityBefore,
      quantityAfter: item.quantity,
      description: item.description,
    });

    shippedCases.push({
      id: createId(),
      upc: item.upc ?? item.sku,
      sku: item.sku,
      batch: item.batch,
      quantityInCase: pick.quantity,
      description: item.description ?? item.sku,
      manufacturer: "",
      color: null,
      fiber: null,
      putawayRoomId: null,
      putawayLocationId: item.locationId,
      putawayPostedAt: null,
    });
  }

  return { remaining, shippedCases, changes };
}

export function applyAdjustment(input: {
  items: InventoryItem[];
  target: InventoryItem;
  type: "overage" | "shortage" | "damage";
  quantity: number;
  now: string;
  damagedLocationId?: string;
}): { items: InventoryItem[]; changes: StockChange[] } {
  const { target, type, quantity, now, damagedLocationId } = input;
  assertPositiveQuantity(quantity, "Adjustment quantity");
  let items = input.items.map((item) =>
    item.id === target.id ? { ...item } : item,
  );
  const current = items.find((item) => item.id === target.id);
  if (!current) {
    throw new Error("Inventory line was not found.");
  }

  if (type !== "overage") {
    assertEnoughOnHand(current.quantity, quantity, current.sku);
  }

  if (type === "overage") {
    const result = addQuantity(items, {
      sku: current.sku,
      upc: current.upc,
      batch: current.batch,
      locationId: current.locationId,
      quantity,
      description: current.description,
      now,
    });
    return { items: result.items, changes: [result.change] };
  }

  const quantityBefore = current.quantity;
  current.quantity -= quantity;
  assertStockDoesNotGoNegative(quantityBefore, current.quantity);
  current.lastMovedAt = now;
  current.updatedAt = now;

  const outbound: StockChange = {
    inventoryItemId: current.id,
    sku: current.sku,
    upc: current.upc,
    batch: current.batch,
    locationId: current.locationId,
    quantityDelta: -quantity,
    quantityBefore,
    quantityAfter: current.quantity,
    description: current.description,
    destinationLocationId:
      type === "damage" ? damagedLocationId : undefined,
  };

  if (type === "damage" && damagedLocationId) {
    const moved = addQuantity(items, {
      sku: current.sku,
      upc: current.upc,
      batch: current.batch,
      locationId: damagedLocationId,
      quantity,
      description: current.description,
      now,
    });
    items = moved.items;
    moved.change.destinationLocationId = damagedLocationId;
    return { items, changes: [outbound, moved.change] };
  }

  return { items, changes: [outbound] };
}
