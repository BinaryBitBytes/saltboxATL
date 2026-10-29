import { createId } from "@/backend/server/helperUtils";
import { divisionOf } from "@/lib/divisions";
import { applyInventoryMove } from "@/lib/inventory/move";
import type { InventorySystem, SiteTransfer } from "@/lib/inventory-schema";
import { locationSiteId } from "@/lib/sites/database";
import { ValidationError } from "@/lib/validation/errors";

export function orderSiteTransfer(
  system: InventorySystem,
  input: {
    inventoryItemId: string;
    destinationLocationId: string;
    quantity: number;
    notes?: string | null;
    confirmLargeInput?: boolean;
    confirmationQuantity?: number;
    orderedBy: string;
    now: string;
    id?: string;
  },
): SiteTransfer {
  const sourceItem = system.inventoryItems.find((item) => item.id === input.inventoryItemId);
  if (!sourceItem) throw new ValidationError("Inventory line was not found.", 404);
  const sourceLocation = system.locations.find((location) => location.id === sourceItem.locationId);
  const destination = system.locations.find(
    (location) => location.id === input.destinationLocationId,
  );
  if (!sourceLocation || !destination) {
    throw new ValidationError("Location was not found.", 404);
  }
  const sourceSiteId = locationSiteId(system, sourceLocation);
  const destinationSiteId = locationSiteId(system, destination);
  if (!sourceSiteId || !destinationSiteId) {
    throw new ValidationError("Both locations must belong to a work site.");
  }
  if (sourceSiteId === destinationSiteId) {
    throw new ValidationError("Use an RF move inside one work site.");
  }
  if (divisionOf(sourceLocation) !== divisionOf(destination)) {
    throw new ValidationError("Order transfers inside one division.");
  }

  const moved = applyInventoryMove(
    system,
    {
      inventoryItemId: input.inventoryItemId,
      destinationLocationId: input.destinationLocationId,
      quantity: input.quantity,
      notes: input.notes ?? undefined,
      confirmLargeInput: input.confirmLargeInput ?? false,
      confirmationQuantity: input.confirmationQuantity,
      createdBy: input.orderedBy,
    },
    input.now,
  );
  system.inventoryItems = moved.items;

  const transfer: SiteTransfer = {
    id: input.id ?? createId(),
    division: divisionOf(sourceLocation),
    status: "ordered",
    sku: sourceItem.sku,
    batch: sourceItem.batch ?? null,
    quantity: input.quantity,
    sourceSiteId,
    sourceLocationId: sourceLocation.id,
    destinationSiteId,
    destinationLocationId: destination.id,
    orderedBy: input.orderedBy,
    orderedAt: input.now,
    notes: input.notes ?? undefined,
  };
  system.siteTransfers = [transfer, ...(system.siteTransfers ?? [])];

  const sourceName = system.sites?.find((site) => site.id === sourceSiteId)?.codename ?? "site";
  const destinationName =
    system.sites?.find((site) => site.id === destinationSiteId)?.codename ?? "site";
  for (const change of moved.changes) {
    system.transactions.unshift({
      id: createId(),
      division: divisionOf(sourceLocation),
      type: "site-transfer",
      occurredAt: input.now,
      sku: change.sku,
      upc: change.upc,
      batch: change.batch,
      inventoryItemId: change.inventoryItemId,
      locationId: change.locationId,
      destinationLocationId: change.destinationLocationId ?? destination.id,
      quantityDelta: change.quantityDelta,
      quantityBefore: change.quantityBefore,
      quantityAfter: change.quantityAfter,
      reason: `Site transfer ${sourceName} to ${destinationName}`,
      referenceType: "site-transfer",
      referenceId: transfer.id,
      createdBy: input.orderedBy,
      notes: input.notes ?? undefined,
    });
  }
  return transfer;
}
