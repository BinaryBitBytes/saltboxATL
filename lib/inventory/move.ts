import { moveQuantity, type StockChange } from "@/backend/server/inventory-ops";
import { committedCubeForLocation } from "@/lib/cubing/capacity";
import { divisionOf } from "@/lib/divisions";
import {
  appendCartons,
  checkBinPlacement,
  incomingCubicInches,
  materializeCartons,
  occupantsByLocation,
  takeCartons,
  type PlacementLocation,
} from "@/lib/inventory/bin-container";
import { allocateLicensePlate } from "@/lib/license-plate/assign";
import type {
  CustomerOrder,
  InventoryItem,
  InventorySystem,
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
    source.licensePlateId &&
    destinationLine?.licensePlateId &&
    destinationLine.licensePlateId !== source.licensePlateId
  ) {
    throw new ValidationError(
      `Destination bin ${destination.code} already has another license plate.`,
    );
  }
  const cube = (system.itemCubes ?? []).find((entry) => entry.sku === source.sku) ?? null;
  const occupants = occupantsByLocation(system.inventoryItems);
  const placementLocations = placementViews(system);
  const destinationView = placementLocations.find((location) => location.id === destination.id);
  if (destinationView) {
    const placement = checkBinPlacement({
      location: destinationView,
      occupants: occupants.get(destination.id) ?? [],
      incoming: {
        sku: source.sku,
        batch: source.batch,
        quantity: input.quantity,
        poNumber: source.poNumber,
        jobIdNumber: source.jobIdNumber,
      },
      incomingCubicInches: incomingCubicInches(input.quantity, cube),
      locations: placementLocations,
      occupantsByLocation: occupants,
      excludeIds: [source.locationId],
    });
    if (!placement.ok) throw new ValidationError(placement.message);
  }

  const result = moveQuantity({
    items: system.inventoryItems,
    source,
    destinationLocationId: destination.id,
    quantity: input.quantity,
    now,
  });
  const destinationItem = result.items.find(
    (item) => item.id === result.changes[1]?.inventoryItemId,
  );
  const sourceItem = result.items.find((item) => item.id === source.id);
  if (destinationItem && sourceItem) {
    if (input.quantity === source.quantity && source.licensePlateId) {
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
    const unitsPerCase = cube?.unitsPerCase ?? null;
    const takePlate = () => allocateLicensePlate(system as InventorySystem, "move").number;
    const { kept, moved } = takeCartons(
      materializeCartons(source, unitsPerCase, takePlate),
      input.quantity,
      unitsPerCase,
      takePlate,
    );
    const priorDestinationQuantity = Math.max(0, destinationItem.quantity - input.quantity);
    const destinationCartons =
      destinationItem.cartons && destinationItem.cartons.length > 0
        ? destinationItem.cartons
        : destinationItem.licensePlateNumber && priorDestinationQuantity > 0
          ? [
              {
                licensePlateNumber: destinationItem.licensePlateNumber,
                quantity: priorDestinationQuantity,
              },
            ]
          : [];
    sourceItem.cartons = kept;
    sourceItem.licensePlateNumber = kept[0]?.licensePlateNumber ?? null;
    destinationItem.cartons = appendCartons(destinationCartons, moved);
    destinationItem.licensePlateNumber =
      destinationItem.licensePlateNumber ?? moved[0]?.licensePlateNumber ?? null;
    destinationItem.poNumber = destinationItem.poNumber ?? source.poNumber ?? null;
    destinationItem.jobIdNumber = destinationItem.jobIdNumber ?? source.jobIdNumber ?? null;
  }
  return result;
}

function placementViews(system: MoveInventorySystem): PlacementLocation[] {
  return system.locations.map((location) => ({
    id: location.id,
    code: location.code,
    isActive: location.isActive,
    storageClass: location.storageClass,
    division: location.division,
    cubeCapacityCubicInches: location.cubeCapacityCubicInches,
    committedCubicInches: committedCubeForLocation(
      location.id,
      system.inventoryItems,
      system.receivingOrders ?? [],
      system.itemCubes ?? [],
    ),
  }));
}
