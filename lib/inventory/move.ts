import { moveQuantity, type StockChange } from "@/backend/server/inventory-ops";
import { committedCubeForLocation } from "@/lib/cubing/capacity";
import { inventoryQuantityCubeMessage } from "@/lib/cubing/workflow";
import { divisionOf } from "@/lib/divisions";
import type {
  CustomerOrder,
  InventoryItem,
  ItemCube,
  LicensePlate,
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
  licensePlates?: LicensePlate[];
};

export function findLocationForScan<T extends { code: string }>(
  locations: readonly T[],
  payload: { locationCode?: string; sku?: string; raw: string },
): T | undefined {
  const codes = [payload.locationCode, payload.raw, payload.sku]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return locations.find((location) => codes.includes(location.code.toLowerCase()));
}

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
  if (divisionOf(sourceLocation) !== divisionOf(destination)) {
    throw new ValidationError("Move stock inside one division.");
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
  if (
    input.quantity === source.quantity &&
    ((source.licensePlateId &&
      destinationLine?.licensePlateId &&
      destinationLine.licensePlateId !== source.licensePlateId) ||
      (source.licensePlateNumber &&
        destinationLine?.licensePlateNumber &&
        destinationLine.licensePlateNumber !== source.licensePlateNumber))
  ) {
    throw new ValidationError(
      `Destination bin ${destination.code} already has another license plate.`,
    );
  }
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

  const result = moveQuantity({
    items: system.inventoryItems,
    source,
    destinationLocationId: destination.id,
    quantity: input.quantity,
    now,
  });
  if (input.quantity === source.quantity) {
    const destinationItem = result.items.find(
      (item) => item.id === result.changes[1]?.inventoryItemId,
    );
    const sourceItem = result.items.find((item) => item.id === source.id);
    if (destinationItem && sourceItem) {
      if (source.licensePlateId) {
        destinationItem.licensePlateId = source.licensePlateId;
        destinationItem.containerId = source.containerId ?? null;
        sourceItem.licensePlateId = null;
        sourceItem.containerId = null;
        const plate = (system.licensePlates ?? []).find(
          (entry) => entry.id === source.licensePlateId,
        );
        if (plate) {
          plate.locationId = destination.id;
          plate.trailerId = null;
        }
      }
      if (source.licensePlateNumber) {
        if (!destinationItem.licensePlateNumber) {
          destinationItem.licensePlateNumber = source.licensePlateNumber;
        }
        sourceItem.licensePlateNumber = null;
      }
    }
  }
  return result;
}
