import type {
  InventoryItem,
  Location,
  Room,
  SiteTransfer,
  SiteTransferLine,
  SiteTransferPallet,
} from "@/lib/inventory-schema";
import { SiteTransferSchema } from "@/lib/inventory-schema";
import { normalizeProjectId } from "@/lib/inventory/keys";
import { ValidationError } from "@/lib/validation/errors";
import { assertActiveLocation } from "@/lib/validation/inventory-guards";
import type { StockChange } from "@/backend/server/inventory-ops";
import { applyInventoryMove } from "@/lib/moves/apply";
import { assertProjectCombineAllowed } from "@/lib/moves/project";

export function nextTransferNumber(
  transfers: Array<{ transferNumber: string }>,
  nowIso: string,
): string {
  const day = nowIso.slice(0, 10).replaceAll("-", "");
  const prefix = `TRF-${day}-`;
  let max = 0;
  for (const transfer of transfers) {
    if (!transfer.transferNumber.startsWith(prefix)) continue;
    const seq = Number(transfer.transferNumber.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function requireTrailer(locations: Location[], trailerLocationId: string): Location {
  const trailer = locations.find((location) => location.id === trailerLocationId);
  const active = assertActiveLocation(trailer, "a site transfer");
  if (active.storageClass !== "container") {
    throw new ValidationError("Choose a transfer trailer. Trailers are container locations.");
  }
  return active;
}

function requireRoom(rooms: Room[], roomId: string, label: string): Room {
  const room = rooms.find((entry) => entry.id === roomId);
  if (!room) throw new ValidationError(`${label} was not found.`);
  return room;
}

export function createSiteTransferRecord(input: {
  transfers: SiteTransfer[];
  locations: Location[];
  rooms: Room[];
  trailerLocationId: string;
  fromRoomId: string;
  toRoomId: string;
  notes?: string;
  createdBy?: string;
  now: string;
}): SiteTransfer {
  const trailer = requireTrailer(input.locations, input.trailerLocationId);
  requireRoom(input.rooms, input.fromRoomId, "Origin site");
  requireRoom(input.rooms, input.toRoomId, "Destination site");
  if (input.fromRoomId === input.toRoomId) {
    throw new ValidationError("Choose a different destination site.");
  }
  if (trailer.roomId !== input.fromRoomId) {
    throw new ValidationError(
      "The trailer has to be at the origin site before it can be loaded.",
    );
  }
  const open = input.transfers.find(
    (transfer) =>
      transfer.trailerLocationId === trailer.id &&
      transfer.status !== "unloaded" &&
      transfer.status !== "cancelled",
  );
  if (open) {
    throw new ValidationError(
      `${trailer.code} is already on transfer ${open.transferNumber}.`,
    );
  }

  return SiteTransferSchema.parse({
    id: crypto.randomUUID(),
    transferNumber: nextTransferNumber(input.transfers, input.now),
    trailerLocationId: trailer.id,
    fromRoomId: input.fromRoomId,
    toRoomId: input.toRoomId,
    status: "loading",
    pallets: [],
    notes: input.notes?.trim() ? input.notes.trim() : undefined,
    createdAt: input.now,
    updatedAt: input.now,
    departedAt: null,
    arrivedAt: null,
    createdBy: input.createdBy,
  });
}

function transferLines(transfer: SiteTransfer): SiteTransferLine[] {
  return transfer.pallets.flatMap((pallet) => pallet.lines);
}

export function loadTransferPallet(input: {
  transfer: SiteTransfer;
  items: InventoryItem[];
  locations: Location[];
  inventoryItemId: string;
  palletNumber: string;
  quantity: number;
  reserved?: number;
  now: string;
  approveProjectCombine?: boolean;
  approverIsAdmin?: boolean;
}): { transfer: SiteTransfer; items: InventoryItem[]; changes: StockChange[] } {
  if (input.transfer.status !== "loading") {
    throw new ValidationError("Pallets can only be loaded while the transfer is loading.");
  }
  const palletNumber = input.palletNumber.trim();
  if (!palletNumber) throw new ValidationError("Enter a pallet number.");
  const trailer = requireTrailer(input.locations, input.transfer.trailerLocationId);
  const source = input.items.find((item) => item.id === input.inventoryItemId);
  if (!source) throw new ValidationError("Inventory line was not found.");

  let items = input.items;
  let changes: StockChange[] = [];
  let inventoryItemId = source.id;
  if (source.locationId !== trailer.id) {
    const moved = applyInventoryMove({
      items,
      locations: input.locations,
      inventoryItemId: source.id,
      quantity: input.quantity,
      destinationLocationId: trailer.id,
      reserved: input.reserved ?? 0,
      now: input.now,
      approveProjectCombine: input.approveProjectCombine,
      approverIsAdmin: input.approverIsAdmin,
    });
    items = moved.items;
    changes = moved.changes;
    inventoryItemId = moved.destinationItemId;
  } else {
    const onTrailer = source.quantity;
    const manifested = transferLines(input.transfer)
      .filter((line) => line.inventoryItemId === source.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (manifested + input.quantity > onTrailer) {
      throw new ValidationError(
        `Only ${Math.max(0, onTrailer - manifested)} more of ${source.sku} on ${trailer.code} can be added to this transfer.`,
      );
    }
  }

  const landed = items.find((item) => item.id === inventoryItemId);
  const line: SiteTransferLine = {
    id: crypto.randomUUID(),
    inventoryItemId,
    sourceInventoryItemId: source.id,
    sourceLocationId: source.locationId,
    sku: source.sku,
    upc: source.upc ?? "",
    description: source.description ?? source.sku,
    batch: source.batch,
    projectId: normalizeProjectId(landed?.projectId ?? source.projectId),
    quantity: input.quantity,
  };

  const pallets: SiteTransferPallet[] = input.transfer.pallets.map((pallet) => ({
    ...pallet,
    lines: [...pallet.lines],
  }));
  const existing = pallets.find(
    (pallet) => pallet.palletNumber.toLowerCase() === palletNumber.toLowerCase(),
  );
  if (existing) {
    existing.lines.push(line);
  } else {
    pallets.push({
      id: crypto.randomUUID(),
      palletNumber,
      lines: [line],
    });
  }

  return {
    items,
    changes,
    transfer: {
      ...input.transfer,
      pallets,
      updatedAt: input.now,
    },
  };
}

export function departSiteTransfer(transfer: SiteTransfer, now: string): SiteTransfer {
  if (transfer.status !== "loading") {
    throw new ValidationError("Only a loading transfer can depart.");
  }
  if (transferLines(transfer).length === 0) {
    throw new ValidationError("Load at least one pallet before the trailer departs.");
  }
  return {
    ...transfer,
    status: "in-transit",
    departedAt: now,
    updatedAt: now,
  };
}

export function arriveSiteTransfer(input: {
  transfer: SiteTransfer;
  locations: Location[];
  now: string;
}): { transfer: SiteTransfer; locations: Location[] } {
  if (input.transfer.status !== "in-transit") {
    throw new ValidationError("The trailer has to be in transit before it can arrive.");
  }
  const locations = input.locations.map((location) =>
    location.id === input.transfer.trailerLocationId
      ? { ...location, roomId: input.transfer.toRoomId }
      : location,
  );
  return {
    locations,
    transfer: {
      ...input.transfer,
      status: "arrived",
      arrivedAt: input.now,
      updatedAt: input.now,
    },
  };
}

export function unloadTransferLine(input: {
  transfer: SiteTransfer;
  items: InventoryItem[];
  locations: Location[];
  lineId: string;
  destinationLocationId: string;
  quantity: number;
  now: string;
  approveProjectCombine?: boolean;
  approverIsAdmin?: boolean;
}): { transfer: SiteTransfer; items: InventoryItem[]; changes: StockChange[] } {
  if (input.transfer.status !== "arrived") {
    throw new ValidationError("Unload the trailer after it arrives at the destination site.");
  }
  const destination = input.locations.find(
    (location) => location.id === input.destinationLocationId,
  );
  const active = assertActiveLocation(destination, "unloading");
  if (active.storageClass === "container") {
    throw new ValidationError("Unload into a location at the destination site.");
  }
  if (active.roomId !== input.transfer.toRoomId) {
    throw new ValidationError("Unload into a location at the destination site.");
  }

  let lineMatch: SiteTransferLine | undefined;
  for (const pallet of input.transfer.pallets) {
    lineMatch = pallet.lines.find((line) => line.id === input.lineId);
    if (lineMatch) break;
  }
  if (!lineMatch) throw new ValidationError("That pallet line is not on this transfer.");
  if (input.quantity > lineMatch.quantity) {
    throw new ValidationError(
      `Only ${lineMatch.quantity} of ${lineMatch.sku} is left on this pallet.`,
    );
  }

  const moved = applyInventoryMove({
    items: input.items,
    locations: input.locations,
    inventoryItemId: lineMatch.inventoryItemId,
    quantity: input.quantity,
    destinationLocationId: active.id,
    now: input.now,
    approveProjectCombine: input.approveProjectCombine,
    approverIsAdmin: input.approverIsAdmin,
  });

  const pallets = input.transfer.pallets
    .map((pallet) => ({
      ...pallet,
      lines: pallet.lines.flatMap((line) => {
        if (line.id !== lineMatch!.id) return [line];
        const remaining = line.quantity - input.quantity;
        if (remaining <= 0) return [];
        return [{ ...line, quantity: remaining, inventoryItemId: line.inventoryItemId }];
      }),
    }))
    .filter((pallet) => pallet.lines.length > 0);
  const remainingLines = pallets.flatMap((pallet) => pallet.lines);

  return {
    items: moved.items,
    changes: moved.changes,
    transfer: {
      ...input.transfer,
      pallets,
      status: remainingLines.length === 0 ? "unloaded" : "arrived",
      updatedAt: input.now,
    },
  };
}

export function cancelSiteTransfer(input: {
  transfer: SiteTransfer;
  items: InventoryItem[];
  locations: Location[];
  now: string;
  approveProjectCombine?: boolean;
  approverIsAdmin?: boolean;
}): { transfer: SiteTransfer; items: InventoryItem[]; changes: StockChange[] } {
  if (input.transfer.status !== "loading") {
    throw new ValidationError("Only a transfer that is still loading can be cancelled.");
  }
  let items = input.items;
  const changes: StockChange[] = [];
  for (const line of transferLines(input.transfer)) {
    const current = items.find((item) => item.id === line.inventoryItemId);
    if (!current || current.locationId === line.sourceLocationId) continue;
    if (normalizeProjectId(line.projectId)) {
      assertProjectCombineAllowed({
        projectIds: [line.projectId],
        approved: input.approveProjectCombine === true,
        approverIsAdmin: input.approverIsAdmin === true,
      });
    }
    const moved = applyInventoryMove({
      items,
      locations: input.locations,
      inventoryItemId: line.inventoryItemId,
      quantity: line.quantity,
      destinationLocationId: line.sourceLocationId,
      now: input.now,
      approveProjectCombine: true,
      approverIsAdmin: true,
    });
    items = moved.items;
    changes.push(...moved.changes);
  }
  return {
    items,
    changes,
    transfer: {
      ...input.transfer,
      status: "cancelled",
      pallets: [],
      updatedAt: input.now,
    },
  };
}
