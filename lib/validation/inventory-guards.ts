import type { InventoryItem, Location, ShippingPick } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";
import { isSku, isUpc } from "@/lib/validation/sanitize";

export function assertFiniteQuantity(quantity: number, label = "Quantity"): void {
  if (!Number.isInteger(quantity) || !Number.isFinite(quantity)) {
    throw new ValidationError(`${label} must be a whole number.`);
  }
  if (quantity < 0) {
    throw new ValidationError(`${label} cannot be negative.`);
  }
  if (quantity > LIMITS.quantityMax) {
    throw new ValidationError(`${label} cannot exceed ${LIMITS.quantityMax}.`);
  }
}

export function assertPositiveQuantity(quantity: number, label = "Quantity"): void {
  assertFiniteQuantity(quantity, label);
  if (quantity < 1) {
    throw new ValidationError(`${label} must be at least 1.`);
  }
}

export function assertEnoughOnHand(
  available: number,
  requested: number,
  sku?: string,
): void {
  if (requested > available) {
    throw new ValidationError(
      sku
        ? `Not enough on-hand quantity for ${sku}. Available: ${available}.`
        : `Not enough on-hand quantity. Available: ${available}.`,
    );
  }
}

export function assertActiveLocation(
  location: Location | undefined,
  action = "this movement",
): Location {
  if (!location) {
    throw new ValidationError("Location was not found.", 404);
  }
  if (!location.isActive) {
    throw new ValidationError(
      `Location ${location.code} is inactive and cannot be used for ${action}.`,
    );
  }
  return location;
}

export function assertSkuCode(sku: string): void {
  if (!isSku(sku)) {
    throw new ValidationError(
      "SKU may only include letters, numbers, dots, underscores, slashes, and hyphens.",
    );
  }
}

export function assertUpcCode(upc: string | undefined): void {
  if (upc && !isUpc(upc)) {
    throw new ValidationError("UPC may only include letters, numbers, and hyphens.");
  }
}

export function assertUniquePicks(picks: ShippingPick[]): void {
  const seen = new Set<string>();
  for (const pick of picks) {
    if (seen.has(pick.inventoryItemId)) {
      throw new ValidationError(
        "Duplicate inventory lines in one shipment are not allowed. Combine quantities on a single pick.",
      );
    }
    seen.add(pick.inventoryItemId);
  }
}

export function assertPutawayReady(
  cases: Array<{ sku: string; putawayLocationId: string | null }>,
): void {
  const missing = cases.filter((item) => !item.putawayLocationId);
  if (missing.length > 0) {
    throw new ValidationError(
      `SKU ${missing[0].sku} is missing a putaway location before receiving can complete.`,
    );
  }
}

export function assertStockDoesNotGoNegative(
  quantityBefore: number,
  quantityAfter: number,
): void {
  if (quantityAfter < 0) {
    throw new ValidationError("Inventory quantity cannot go negative.");
  }
  if (quantityBefore < 0) {
    throw new ValidationError("On-hand quantity is already invalid.");
  }
}

export function findInventoryLine(
  items: InventoryItem[],
  id: string,
): InventoryItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new ValidationError("One of the selected inventory lines no longer exists.");
  }
  return item;
}
