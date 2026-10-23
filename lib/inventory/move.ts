import { moveQuantity, type StockChange } from "@/backend/server/inventory-ops";
import { committedCubeForLocation } from "@/lib/cubing/capacity";
import { inventoryQuantityCubeMessage } from "@/lib/cubing/workflow";
import type {
  CustomerOrder,
  InventoryItem,
  ItemCube,
  Location,
  MoveInventoryInput,
  ReceivingOrder,
} from "@/lib/inventory-schema";
import { assertAvailableQuantity, reservedQuantity } from "@/lib/orders/availability";
import { assertActiveLocation } from "@/lib/validation/inventory-guards";
import { assertLargeInputConfirmed } from "@/lib/validation/large-input";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

export type MoveInventorySystem = {
  inventoryItems: InventoryItem[];
  locations: Location[];
  itemCubes?: ItemCube[];
  receivingOrders?: ReceivingOrder[];
  customerOrders?: CustomerOrder[];
};

export function applyInventoryMove(
  system: MoveInventorySystem,
  input: MoveInventoryInput,
  now: string,
): { items: InventoryItem[]; changes: StockChange[] } {
  const source = system.inventoryItems.find((item) => item.id === input.inventoryItemId);
  if (!source) {
    throw new ValidationError("Inventory line was not found.", 404);
  }
  const sourceLocation = assertActiveLocation(
    system.locations.find((location) => location.id === source.locationId),
    "an RF move",
  );
  const destination = assertActiveLocation(
    system.locations.find((location) => location.id === input.destinationLocationId),
    "an RF move",
  );
  if (sourceLocation.id === destination.id) {
    throw new ValidationError("Scan a different destination bin.");
  }

  assertAvailableQuantity(
    source.quantity,
    reservedQuantity(system.customerOrders ?? [], source.id),
    input.quantity,
    source.sku,
    "move",
  );
  assertLargeInputConfirmed(
    input.quantity,
    input,
    LIMITS.largeQuantity,
    "move quantity",
  );

  const destinationLine = system.inventoryItems.find(
    (item) =>
      item.locationId === destination.id &&
      item.sku === source.sku &&
      (item.batch ?? null) === (source.batch ?? null),
  );
  const quantityBefore = destinationLine?.quantity ?? 0;
  const cube = (system.itemCubes ?? []).find((entry) => entry.sku === source.sku) ?? null;
  const message = inventoryQuantityCubeMessage({
    sku: source.sku,
    locationCode: destination.code,
    capacity: destination.cubeCapacityCubicInches,
    committedCubicInches: committedCubeForLocation(
      destination.id,
      system.inventoryItems,
      system.receivingOrders ?? [],
      system.itemCubes ?? [],
    ),
    cube: cube
      ? {
          sku: cube.sku,
          cubicInches: cube.cubicInches,
          unitsPerCase: cube.unitsPerCase,
        }
      : null,
    quantityBefore,
    quantityAfter: quantityBefore + input.quantity,
  });
  if (message) {
    throw new ValidationError(message);
  }

  return moveQuantity({
    items: system.inventoryItems,
    source,
    destinationLocationId: destination.id,
    quantity: input.quantity,
    now,
  });
}
