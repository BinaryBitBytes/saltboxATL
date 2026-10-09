import { nowIso } from "@/backend/server/helperUtils";
import { appendTransactions, ServiceError } from "@/backend/server/inventory-service";
import { parseWithSchema } from "@/backend/server/safeParsing";
import { updateSystem } from "@/backend/server/store";
import { applyInventoryMove, consolidateInventoryLines } from "@/lib/moves/apply";
import {
  arriveSiteTransfer,
  cancelSiteTransfer,
  createSiteTransferRecord,
  departSiteTransfer,
  loadTransferPallet,
  unloadTransferLine,
} from "@/lib/moves/transfer";
import { reservedQuantity } from "@/lib/orders/availability";
import {
  ConsolidateInventoryInputSchema,
  CreateSiteTransferInputSchema,
  LoadSiteTransferInputSchema,
  MoveInventoryInputSchema,
  SiteTransferStateInputSchema,
  UnloadSiteTransferInputSchema,
  type SiteTransfer,
} from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { assertLargeInputConfirmed } from "@/lib/validation/large-input";

type MoveActor = {
  name?: string;
  approverIsAdmin: boolean;
};

function locationCode(
  locations: Array<{ id: string; code: string }>,
  locationId: string,
): string {
  return locations.find((location) => location.id === locationId)?.code ?? locationId;
}

function requireTransfer(
  transfers: SiteTransfer[] | undefined,
  transferId: string,
): SiteTransfer {
  const transfer = (transfers ?? []).find((entry) => entry.id === transferId);
  if (!transfer) {
    throw new ServiceError("Site transfer was not found.", 404);
  }
  return transfer;
}

export async function moveInventoryRecord(
  rawData: unknown,
  actor: MoveActor,
): Promise<{ destinationItemId: string }> {
  const parsed = parseWithSchema(MoveInventoryInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  assertLargeInputConfirmed(
    parsed.data.quantity,
    parsed.data,
    LIMITS.largeQuantity,
    "move quantity",
  );

  return updateSystem((system) => {
    const source = system.inventoryItems.find(
      (item) => item.id === parsed.data.inventoryItemId,
    );
    if (!source) throw new ServiceError("Inventory line was not found.", 404);
    const now = nowIso();
    const moved = applyInventoryMove({
      items: system.inventoryItems,
      locations: system.locations,
      inventoryItemId: source.id,
      quantity: parsed.data.quantity,
      destinationLocationId: parsed.data.destinationLocationId,
      reserved: reservedQuantity(system.customerOrders ?? [], source.id),
      now,
      approveProjectCombine: parsed.data.approveProjectCombine,
      approverIsAdmin: actor.approverIsAdmin,
    });
    system.inventoryItems = moved.items;
    const destination = locationCode(
      system.locations,
      parsed.data.destinationLocationId,
    );
    appendTransactions(system, "move", moved.changes, {
      occurredAt: now,
      referenceType: "inventory-move",
      createdBy: actor.name,
      reason: `Move ${source.sku} to ${destination}`,
    });
    return { destinationItemId: moved.destinationItemId };
  });
}

export async function consolidateInventoryRecord(
  rawData: unknown,
  actor: MoveActor,
): Promise<{ destinationItemId: string }> {
  const parsed = parseWithSchema(ConsolidateInventoryInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  const total = parsed.data.lines.reduce((sum, line) => sum + line.quantity, 0);
  assertLargeInputConfirmed(
    total,
    parsed.data,
    LIMITS.largeQuantity,
    "consolidate quantity",
  );

  return updateSystem((system) => {
    const now = nowIso();
    const reservedByItemId = new Map(
      parsed.data.lines.map((line) => [
        line.inventoryItemId,
        reservedQuantity(system.customerOrders ?? [], line.inventoryItemId),
      ]),
    );
    const consolidated = consolidateInventoryLines({
      items: system.inventoryItems,
      locations: system.locations,
      destinationLocationId: parsed.data.destinationLocationId,
      lines: parsed.data.lines,
      resultingProjectId: parsed.data.resultingProjectId,
      reservedByItemId,
      now,
      approveProjectCombine: parsed.data.approveProjectCombine,
      approverIsAdmin: actor.approverIsAdmin,
    });
    system.inventoryItems = consolidated.items;
    const destination = locationCode(
      system.locations,
      parsed.data.destinationLocationId,
    );
    const sku = consolidated.changes[0]?.sku ?? "inventory";
    appendTransactions(system, "move", consolidated.changes, {
      occurredAt: now,
      referenceType: "inventory-move",
      createdBy: actor.name,
      reason: `Consolidate ${sku} into ${destination}`,
    });
    return { destinationItemId: consolidated.destinationItemId };
  });
}

export async function openSiteTransferRecord(
  rawData: unknown,
  actor: MoveActor,
): Promise<SiteTransfer> {
  const parsed = parseWithSchema(CreateSiteTransferInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);

  return updateSystem((system) => {
    if (!system.siteTransfers) system.siteTransfers = [];
    const now = nowIso();
    const transfer = createSiteTransferRecord({
      transfers: system.siteTransfers,
      locations: system.locations,
      rooms: system.rooms,
      trailerLocationId: parsed.data.trailerLocationId,
      fromRoomId: parsed.data.fromRoomId,
      toRoomId: parsed.data.toRoomId,
      notes: parsed.data.notes,
      createdBy: actor.name ?? parsed.data.createdBy,
      now,
    });
    system.siteTransfers.unshift(transfer);
    return transfer;
  });
}

export async function loadSiteTransferRecord(
  rawData: unknown,
  actor: MoveActor,
): Promise<SiteTransfer> {
  const parsed = parseWithSchema(LoadSiteTransferInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  assertLargeInputConfirmed(
    parsed.data.quantity,
    parsed.data,
    LIMITS.largeQuantity,
    "load quantity",
  );

  return updateSystem((system) => {
    const transfer = requireTransfer(system.siteTransfers, parsed.data.transferId);
    const now = nowIso();
    const loaded = loadTransferPallet({
      transfer,
      items: system.inventoryItems,
      locations: system.locations,
      inventoryItemId: parsed.data.inventoryItemId,
      palletNumber: parsed.data.palletNumber,
      quantity: parsed.data.quantity,
      reserved: reservedQuantity(
        system.customerOrders ?? [],
        parsed.data.inventoryItemId,
      ),
      now,
      approveProjectCombine: parsed.data.approveProjectCombine,
      approverIsAdmin: actor.approverIsAdmin,
    });
    system.inventoryItems = loaded.items;
    const index = system.siteTransfers.findIndex((entry) => entry.id === transfer.id);
    system.siteTransfers[index] = loaded.transfer;
    appendTransactions(system, "move", loaded.changes, {
      occurredAt: now,
      referenceType: "site-transfer",
      referenceId: transfer.id,
      createdBy: actor.name,
      reason: `Load ${transfer.transferNumber}`,
    });
    return loaded.transfer;
  });
}

export async function departSiteTransferRecord(
  rawData: unknown,
): Promise<SiteTransfer> {
  const parsed = parseWithSchema(SiteTransferStateInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    const transfer = requireTransfer(system.siteTransfers, parsed.data.transferId);
    const updated = departSiteTransfer(transfer, nowIso());
    const index = system.siteTransfers.findIndex((entry) => entry.id === transfer.id);
    system.siteTransfers[index] = updated;
    return updated;
  });
}

export async function arriveSiteTransferRecord(
  rawData: unknown,
): Promise<SiteTransfer> {
  const parsed = parseWithSchema(SiteTransferStateInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    const transfer = requireTransfer(system.siteTransfers, parsed.data.transferId);
    const arrived = arriveSiteTransfer({
      transfer,
      locations: system.locations,
      now: nowIso(),
    });
    system.locations = arrived.locations;
    const index = system.siteTransfers.findIndex((entry) => entry.id === transfer.id);
    system.siteTransfers[index] = arrived.transfer;
    return arrived.transfer;
  });
}

export async function unloadSiteTransferRecord(
  rawData: unknown,
  actor: MoveActor,
): Promise<SiteTransfer> {
  const parsed = parseWithSchema(UnloadSiteTransferInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  assertLargeInputConfirmed(
    parsed.data.quantity,
    parsed.data,
    LIMITS.largeQuantity,
    "unload quantity",
  );
  return updateSystem((system) => {
    const transfer = requireTransfer(system.siteTransfers, parsed.data.transferId);
    const now = nowIso();
    const unloaded = unloadTransferLine({
      transfer,
      items: system.inventoryItems,
      locations: system.locations,
      lineId: parsed.data.lineId,
      destinationLocationId: parsed.data.destinationLocationId,
      quantity: parsed.data.quantity,
      now,
      approveProjectCombine: parsed.data.approveProjectCombine,
      approverIsAdmin: actor.approverIsAdmin,
    });
    system.inventoryItems = unloaded.items;
    const index = system.siteTransfers.findIndex((entry) => entry.id === transfer.id);
    system.siteTransfers[index] = unloaded.transfer;
    const destination = locationCode(
      system.locations,
      parsed.data.destinationLocationId,
    );
    appendTransactions(system, "move", unloaded.changes, {
      occurredAt: now,
      referenceType: "site-transfer",
      referenceId: transfer.id,
      createdBy: actor.name,
      reason: `Unload ${transfer.transferNumber} to ${destination}`,
    });
    return unloaded.transfer;
  });
}

export async function cancelSiteTransferRecord(
  rawData: unknown,
  actor: MoveActor,
): Promise<SiteTransfer> {
  const parsed = parseWithSchema(SiteTransferStateInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    const transfer = requireTransfer(system.siteTransfers, parsed.data.transferId);
    const now = nowIso();
    const cancelled = cancelSiteTransfer({
      transfer,
      items: system.inventoryItems,
      locations: system.locations,
      now,
      approveProjectCombine: parsed.data.approveProjectCombine,
      approverIsAdmin: actor.approverIsAdmin,
    });
    system.inventoryItems = cancelled.items;
    const index = system.siteTransfers.findIndex((entry) => entry.id === transfer.id);
    system.siteTransfers[index] = cancelled.transfer;
    appendTransactions(system, "move", cancelled.changes, {
      occurredAt: now,
      referenceType: "site-transfer",
      referenceId: transfer.id,
      createdBy: actor.name,
      reason: `Cancel ${transfer.transferNumber}`,
    });
    return cancelled.transfer;
  });
}
