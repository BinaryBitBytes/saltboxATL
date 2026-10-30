import { createId } from "@/backend/server/helperUtils";
import { addQuantity, type StockChange } from "@/backend/server/inventory-ops";
import { caseCubicInches } from "@/lib/cubing/measure";
import { committedCubeForLocation } from "@/lib/cubing/capacity";
import { unitsThatFit } from "@/lib/cubing/putaway-allocation";
import { divisionOf } from "@/lib/divisions";
import type {
  FacilityTransfer,
  FacilityTransferLine,
  InventoryItem,
  InventorySystem,
  ItemCube,
  Location,
} from "@/lib/inventory-schema";
import { allocateLicensePlate } from "@/lib/license-plate/assign";
import { parsePlateNumber } from "@/lib/license-plate/sequence";
import { formatTrailerCode, parseTrailerCode } from "@/lib/locations/nomenclature";
import { reservedQuantity } from "@/lib/orders/availability";
import { locationSiteId } from "@/lib/sites/database";
import { routeTransferQuantity, type TransferRouteSlot } from "@/lib/transfers/route";
import {
  lineOpenQuantity,
  stockChangesBalance,
  transferUnitBalance,
} from "@/lib/transfers/math";
import { assertLargeInputConfirmed } from "@/lib/validation/large-input";
import { assertEnoughOnHand, assertPositiveQuantity } from "@/lib/validation/inventory-guards";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

function transfersOf(system: InventorySystem): FacilityTransfer[] {
  return system.facilityTransfers ?? [];
}

function refreshStatus(transfer: FacilityTransfer): void {
  const balance = transferUnitBalance(transfer);
  if (!balance.balanced) {
    throw new ValidationError("Transfer quantities do not balance.");
  }
  if (balance.received === 0) transfer.status = "in-transit";
  else if (balance.inTransit === 0) transfer.status = "received";
  else transfer.status = "partial";
}

function recordTransaction(
  system: InventorySystem,
  input: {
    division: FacilityTransfer["division"];
    type: "transfer-outbound" | "transfer-inbound";
    now: string;
    change: StockChange;
    transferId: string;
    reason: string;
    createdBy: string;
    notes?: string;
    destinationLocationId?: string;
  },
): void {
  if (!stockChangesBalance([input.change])) {
    throw new ValidationError("Transfer quantities do not balance.");
  }
  system.transactions.unshift({
    id: createId(),
    division: input.division,
    type: input.type,
    occurredAt: input.now,
    sku: input.change.sku,
    upc: input.change.upc,
    batch: input.change.batch,
    inventoryItemId: input.change.inventoryItemId,
    locationId: input.change.locationId,
    destinationLocationId: input.destinationLocationId ?? null,
    quantityDelta: input.change.quantityDelta,
    quantityBefore: input.change.quantityBefore,
    quantityAfter: input.change.quantityAfter,
    reason: input.reason,
    referenceType: "facility-transfer",
    referenceId: input.transferId,
    createdBy: input.createdBy,
    notes: input.notes,
  });
}

function upsertTrailer(
  system: InventorySystem,
  siteId: string,
  code: string,
  division: FacilityTransfer["division"],
  status: "departed" | "arrived",
): void {
  const existing = (system.trailers ?? []).find(
    (trailer) => trailer.siteId === siteId && trailer.code === code,
  );
  if (existing) {
    existing.status = status;
    return;
  }
  system.trailers = [
    ...(system.trailers ?? []),
    { id: createId(), division, siteId, code, status },
  ];
}

function cubeForSku(
  system: InventorySystem,
  sku: string,
  division: string,
): ItemCube | undefined {
  return (system.itemCubes ?? []).find(
    (cube) => cube.sku === sku && divisionOf(cube) === division,
  );
}

function slotsForReceipt(
  system: InventorySystem,
  destinationSiteId: string,
  division: string,
  sku: string,
  extraCube: Map<string, number>,
): TransferRouteSlot[] {
  const cube = cubeForSku(system, sku, division);
  const perUnit = cube ? caseCubicInches(1, cube) : 0;
  const locations = (system.locations ?? [])
    .filter((location) => {
      if (!location.isActive || location.storageClass === "hold") return false;
      if (divisionOf(location) !== division) return false;
      return locationSiteId(system, location) === destinationSiteId;
    })
    .sort((left, right) => left.code.localeCompare(right.code));

  return locations.map((location) => ({
    locationId: location.id,
    locationCode: location.code,
    openUnits: openUnitsAt(system, location, perUnit, extraCube),
  }));
}

function openUnitsAt(
  system: InventorySystem,
  location: Location,
  perUnit: number,
  extraCube: Map<string, number>,
): number {
  if (perUnit <= 0) return Number.MAX_SAFE_INTEGER;
  const committed =
    committedCubeForLocation(
      location.id,
      system.inventoryItems,
      system.receivingOrders ?? [],
      system.itemCubes ?? [],
    ) + (extraCube.get(location.id) ?? 0);
  return unitsThatFit(location.cubeCapacityCubicInches - committed, perUnit);
}

function rememberSlice(
  extraCube: Map<string, number>,
  locationId: string,
  quantity: number,
  perUnit: number,
): void {
  if (perUnit <= 0) return;
  const used = caseCubicInches(quantity, { cubicInches: perUnit, unitsPerCase: 1 });
  extraCube.set(locationId, (extraCube.get(locationId) ?? 0) + used);
}

function stampPlate(item: InventoryItem, plate: string, division: FacilityTransfer["division"]): void {
  if (!item.division) item.division = division;
  if (!parsePlateNumber(item.licensePlateNumber)) {
    item.licensePlateNumber = plate;
  }
}

export function nextTrailerCode(system: InventorySystem): string {
  let max = 0;
  const consider = (value: string | null | undefined) => {
    const code = value ? parseTrailerCode(value) : null;
    if (!code) return;
    max = Math.max(max, Number(code.slice(2)));
  };
  for (const trailer of system.trailers ?? []) consider(trailer.code);
  for (const transfer of transfersOf(system)) consider(transfer.trailerCode);
  return formatTrailerCode(Math.min(999_999, max + 1));
}

export function loadFacilityTransfer(
  system: InventorySystem,
  input: {
    actingSiteId: string;
    inventoryItemId: string;
    destinationSiteId: string;
    trailerCode: string;
    quantity: number;
    notes?: string | null;
    confirmLargeInput?: boolean;
    confirmationQuantity?: number;
    loadedBy: string;
    now: string;
  },
): FacilityTransfer {
  if (!input.actingSiteId) {
    throw new ValidationError("Choose a work site before transferring freight.");
  }
  const trailerCode = parseTrailerCode(input.trailerCode);
  if (!trailerCode) {
    throw new ValidationError("Trailer numbers look like TN000142.");
  }
  const source = system.inventoryItems.find((item) => item.id === input.inventoryItemId);
  if (!source) throw new ValidationError("Inventory line was not found.", 404);
  const sourceLocation = system.locations.find((location) => location.id === source.locationId);
  if (!sourceLocation) throw new ValidationError("Location was not found.", 404);
  const sourceSiteId = locationSiteId(system, sourceLocation);
  if (!sourceSiteId) {
    throw new ValidationError("Both facilities must belong to a work site.");
  }
  if (sourceSiteId !== input.actingSiteId) {
    throw new ValidationError("Load freight from the site that holds this stock.");
  }
  const destination = (system.sites ?? []).find((site) => site.id === input.destinationSiteId);
  const sourceSite = (system.sites ?? []).find((site) => site.id === sourceSiteId);
  if (!destination || !sourceSite) {
    throw new ValidationError("Destination facility was not found.", 404);
  }
  if (destination.id === sourceSiteId) {
    throw new ValidationError("Choose a different destination facility.");
  }
  if (divisionOf(sourceLocation) !== divisionOf(destination)) {
    throw new ValidationError("Transfer freight inside one division.");
  }

  assertPositiveQuantity(input.quantity, "Load quantity");
  const available = Math.max(
    0,
    source.quantity - reservedQuantity(system.customerOrders ?? [], source.id),
  );
  assertEnoughOnHand(available, input.quantity, source.sku);
  assertLargeInputConfirmed(
    input.quantity,
    input,
    LIMITS.largeQuantity,
    "load quantity",
  );

  const conflict = transfersOf(system).find(
    (transfer) =>
      transfer.trailerCode === trailerCode &&
      transfer.status !== "received" &&
      (transfer.sourceSiteId !== sourceSiteId ||
        transfer.destinationSiteId !== destination.id),
  );
  if (conflict) {
    throw new ValidationError("That trailer is already in transit to another facility.");
  }

  const division = divisionOf(sourceLocation);
  const plate = allocateLicensePlate(system, input.loadedBy).number;
  const quantityBefore = source.quantity;
  source.quantity -= input.quantity;
  source.lastMovedAt = input.now;
  source.updatedAt = input.now;
  const change: StockChange = {
    inventoryItemId: source.id,
    sku: source.sku,
    upc: source.upc,
    batch: source.batch,
    locationId: source.locationId,
    quantityDelta: -input.quantity,
    quantityBefore,
    quantityAfter: source.quantity,
    description: source.description,
  };

  const line: FacilityTransferLine = {
    id: createId(),
    inventoryItemId: source.id,
    sku: source.sku,
    upc: source.upc,
    batch: source.batch ?? null,
    description: source.description ?? source.sku,
    manufacturer: source.manufacturer ?? "",
    color: source.color ?? null,
    quantityLoaded: input.quantity,
    quantityReceived: 0,
    sourceLocationId: source.locationId,
    outboundLicensePlateNumber: plate,
    routes: [],
  };

  let transfer = transfersOf(system).find(
    (entry) =>
      entry.trailerCode === trailerCode &&
      entry.sourceSiteId === sourceSiteId &&
      entry.destinationSiteId === destination.id &&
      entry.status !== "received",
  );
  if (!transfer) {
    transfer = {
      id: createId(),
      division,
      status: "in-transit",
      trailerCode,
      sourceSiteId,
      destinationSiteId: destination.id,
      sourceNomenclature: sourceSite.codename,
      destinationNomenclature: destination.codename,
      loadedBy: input.loadedBy,
      loadedAt: input.now,
      notes: input.notes ?? undefined,
      lines: [line],
    };
    system.facilityTransfers = [transfer, ...transfersOf(system)];
  } else {
    transfer.lines = [...transfer.lines, line];
    if (input.notes) transfer.notes = input.notes;
  }

  upsertTrailer(system, sourceSiteId, trailerCode, division, "departed");
  refreshStatus(transfer);
  recordTransaction(system, {
    division,
    type: "transfer-outbound",
    now: input.now,
    change,
    transferId: transfer.id,
    reason: `Outbound transfer ${trailerCode} to ${destination.codename}`,
    createdBy: input.loadedBy,
    notes: input.notes ?? undefined,
  });
  return transfer;
}

export function receiveFacilityTransfer(
  system: InventorySystem,
  input: {
    actingSiteId: string;
    transferId: string;
    verified: boolean;
    lines: Array<{ lineId: string; quantity: number }>;
    confirmLargeInput?: boolean;
    confirmationQuantity?: number;
    receivedBy: string;
    now: string;
  },
): FacilityTransfer {
  if (!input.actingSiteId) {
    throw new ValidationError("Choose a work site before transferring freight.");
  }
  if (!input.verified) {
    throw new ValidationError(
      "Verify the receipt before routing this trailer into the facility.",
    );
  }
  const transfer = transfersOf(system).find((entry) => entry.id === input.transferId);
  if (!transfer) throw new ValidationError("Transfer trailer was not found.", 404);
  if (transfer.status === "received") {
    throw new ValidationError("This transfer is already received.");
  }
  if (transfer.destinationSiteId !== input.actingSiteId) {
    throw new ValidationError(
      `Receive this trailer at ${transfer.destinationNomenclature}.`,
    );
  }
  if (input.lines.length === 0) {
    throw new ValidationError("Enter the quantity received on this trailer.");
  }

  const seen = new Set<string>();
  let receiptUnits = 0;
  for (const request of input.lines) {
    if (seen.has(request.lineId)) {
      throw new ValidationError("Each transfer line can be received once.");
    }
    seen.add(request.lineId);
    assertPositiveQuantity(request.quantity, "Receipt quantity");
    const line = transfer.lines.find((entry) => entry.id === request.lineId);
    if (!line) throw new ValidationError("That transfer line is not on this trailer.");
    const open = lineOpenQuantity(line);
    if (request.quantity > open) {
      throw new ValidationError(
        `Received quantity is greater than the freight still on the trailer. Open: ${open}.`,
      );
    }
    receiptUnits += request.quantity;
  }
  assertLargeInputConfirmed(
    receiptUnits,
    input,
    LIMITS.largeQuantity,
    "receipt quantity",
  );

  const division = divisionOf(transfer);
  const extraCube = new Map<string, number>();
  const planned = input.lines.map((request) => {
    const line = transfer.lines.find((entry) => entry.id === request.lineId);
    if (!line) throw new ValidationError("That transfer line is not on this trailer.");
    const cube = cubeForSku(system, line.sku, division);
    const perUnit = cube ? caseCubicInches(1, cube) : 0;
    const slots = slotsForReceipt(
      system,
      transfer.destinationSiteId,
      division,
      line.sku,
      extraCube,
    );
    if (slots.length === 0) {
      throw new ValidationError("This facility has no active location for the transfer.");
    }
    const slices = routeTransferQuantity(request.quantity, slots);
    for (const slice of slices) {
      rememberSlice(extraCube, slice.locationId, slice.quantity, perUnit);
    }
    return { line, slices };
  });

  for (const plan of planned) {
    for (const slice of plan.slices) {
      const plate = allocateLicensePlate(system, input.receivedBy).number;
      const added = addQuantity(system.inventoryItems, {
        sku: plan.line.sku,
        upc: plan.line.upc,
        batch: plan.line.batch,
        locationId: slice.locationId,
        quantity: slice.quantity,
        description: plan.line.description,
        details: {
          manufacturer: plan.line.manufacturer ?? "",
          color: plan.line.color ?? null,
        },
        now: input.now,
      });
      system.inventoryItems = added.items;
      const stored = system.inventoryItems.find(
        (item) => item.id === added.change.inventoryItemId,
      );
      if (stored) stampPlate(stored, plate, division);
      plan.line.routes = [
        ...plan.line.routes,
        {
          locationId: slice.locationId,
          locationCode: slice.locationCode,
          quantity: slice.quantity,
          licensePlateNumber: plate,
        },
      ];
      plan.line.quantityReceived += slice.quantity;
      recordTransaction(system, {
        division,
        type: "transfer-inbound",
        now: input.now,
        change: added.change,
        transferId: transfer.id,
        reason: `Inbound transfer ${transfer.trailerCode} from ${transfer.sourceNomenclature} routed to ${slice.locationCode}`,
        createdBy: input.receivedBy,
        notes: transfer.notes,
        destinationLocationId: slice.locationId,
      });
    }
  }

  transfer.receivedBy = input.receivedBy;
  transfer.receivedAt = input.now;
  upsertTrailer(
    system,
    transfer.destinationSiteId,
    transfer.trailerCode,
    division,
    "arrived",
  );
  refreshStatus(transfer);
  return transfer;
}
