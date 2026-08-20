import { createId } from "@/backend/server/helperUtils";
import type {
  CaseItem,
  InventoryItem,
  Pallet,
  ShippingPick,
} from "@/lib/inventory-schema";

export function inventoryKey(
  sku: string,
  batch: string | null,
  locationId: string,
): string {
  return `${sku}::${batch ?? ""}::${locationId}`;
}

export function recountPallet(pallet: Pallet): Pallet {
  const skus = new Set(pallet.cases.map((item) => item.sku));
  return {
    ...pallet,
    actualCaseCount: pallet.cases.length,
    actualSkuCount: skus.size,
  };
}

export function putAwayCases(
  items: InventoryItem[],
  cases: CaseItem[],
  now: string,
): InventoryItem[] {
  const map = new Map(
    items.map((item) => [
      inventoryKey(item.sku, item.batch, item.locationId),
      item,
    ]),
  );

  for (const caseItem of cases) {
    if (!caseItem.putawayLocationId) {
      throw new Error(
        `SKU ${caseItem.sku} is missing a putaway location before receiving can complete.`,
      );
    }

    const key = inventoryKey(
      caseItem.sku,
      caseItem.batch,
      caseItem.putawayLocationId,
    );
    const existing = map.get(key);

    if (existing) {
      map.set(key, {
        ...existing,
        quantity: existing.quantity + caseItem.quantityInCase,
        upc: existing.upc ?? caseItem.upc,
        description: existing.description ?? caseItem.description,
        lastMovedAt: now,
        updatedAt: now,
      });
    } else {
      map.set(key, {
        id: createId(),
        sku: caseItem.sku,
        upc: caseItem.upc,
        batch: caseItem.batch,
        locationId: caseItem.putawayLocationId,
        quantity: caseItem.quantityInCase,
        description: caseItem.description,
        lastMovedAt: now,
        updatedAt: now,
      });
    }
  }

  return [...map.values()];
}

export function pickFromInventory(
  items: InventoryItem[],
  picks: ShippingPick[],
  now: string,
): { remaining: InventoryItem[]; shippedCases: CaseItem[] } {
  const remaining = items.map((item) => ({ ...item }));
  const byId = new Map(remaining.map((item) => [item.id, item]));
  const shippedCases: CaseItem[] = [];

  for (const pick of picks) {
    const item = byId.get(pick.inventoryItemId);
    if (!item) {
      throw new Error("One of the selected inventory lines no longer exists.");
    }
    if (pick.quantity > item.quantity) {
      throw new Error(
        `Not enough quantity for SKU ${item.sku} at this location. Available: ${item.quantity}.`,
      );
    }

    item.quantity -= pick.quantity;
    item.lastMovedAt = now;
    item.updatedAt = now;

    shippedCases.push({
      id: createId(),
      upc: item.upc ?? item.sku,
      sku: item.sku,
      batch: item.batch,
      quantityInCase: pick.quantity,
      description: item.description ?? item.sku,
      fiber: null,
      putawayRoomId: null,
      putawayLocationId: item.locationId,
    });
  }

  return {
    remaining: remaining.filter((item) => item.quantity > 0),
    shippedCases,
  };
}
