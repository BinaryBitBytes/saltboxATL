import type { CustomerOrder, InventoryItem } from "@/lib/inventory-schema";
import { pickFromInventory, type StockChange } from "@/backend/server/inventory-ops";
import { ValidationError } from "@/lib/validation/errors";

export function applyOrderFulfillment(input: {
  order: CustomerOrder;
  items: InventoryItem[];
  now: string;
  completedBy: string;
}): {
  order: CustomerOrder;
  items: InventoryItem[];
  changes: StockChange[];
} {
  if (input.order.status !== "picking" || input.order.pickRequest.status !== "open") {
    throw new ValidationError("This pick request is not open.");
  }

  const { remaining, changes } = pickFromInventory(
    input.items,
    input.order.lines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      quantity: line.quantity,
    })),
    input.now,
  );

  return {
    items: remaining,
    changes,
    order: {
      ...input.order,
      status: "fulfilled",
      updatedAt: input.now,
      pickRequest: {
        ...input.order.pickRequest,
        status: "completed",
        completedAt: input.now,
        completedBy: input.completedBy,
      },
    },
  };
}
