import type { CustomerOrder } from "@/lib/inventory-schema";
import { ValidationError } from "@/lib/validation/errors";

const OPEN_ORDER_STATUS = "picking";

export function reservedQuantity(
  orders: CustomerOrder[],
  inventoryItemId: string,
): number {
  return orders
    .filter((order) => order.status === OPEN_ORDER_STATUS)
    .flatMap((order) => order.lines)
    .filter((line) => line.inventoryItemId === inventoryItemId)
    .reduce((sum, line) => sum + line.quantity, 0);
}

export function availableToOrder(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}

export function assertAvailableQuantity(
  onHand: number,
  reserved: number,
  requested: number,
  sku: string,
  purpose: "order" | "ship",
): void {
  const available = availableToOrder(onHand, reserved);
  if (requested <= available) return;
  if (reserved > 0) {
    throw new ValidationError(
      purpose === "ship"
        ? `Not enough unreserved quantity for ${sku}. On hand ${onHand}, reserved for open orders ${reserved}.`
        : `Not enough available quantity for ${sku}. On hand ${onHand}, reserved for open orders ${reserved}.`,
    );
  }
  throw new ValidationError(
    `Not enough on-hand quantity for ${sku}. Available: ${available}.`,
  );
}
