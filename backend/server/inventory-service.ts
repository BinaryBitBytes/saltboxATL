import {
  CaseItemInputSchema,
  CreateAdjustmentInputSchema,
  MoveInventoryInputSchema,
  CreateLocationInputSchema,
  CreateStructuredLocationInputSchema,
  CreateReceivingOrderInputSchema,
  CreateRoomInputSchema,
  CreateCustomerOrderInputSchema,
  CreateShippingOrderInputSchema,
  CubeItemInputSchema,
  RecordDeliveryScanInputSchema,
  CancelInboundPurchaseOrderInputSchema,
  DeleteInboundPurchaseOrderInputSchema,
  SaveBuyerPurchaseOrderInputSchema,
  SaveDeliveryNotesInputSchema,
  SetPurchaseOrderJobIdInputSchema,
  UpdateInboundPurchaseOrderInputSchema,
  PalletInputSchema,
  PutawayLocationInputSchema,
  ReopenReceivingInputSchema,
  UpdateLocationCapacityInputSchema,
  isAwaitingPutaway,
  isReceivingEditable,
  type CaseItem,
  type ItemCube,
  type InventoryItem,
  type InventoryRow,
  type InventorySystem,
  type WarehouseSnapshot,
  type InventoryTransaction,
  type InventoryTransactionRow,
  type Location,
  type Pallet,
  type DeliveryRecord,
  type PurchaseOrder,
  type ReceivingOrder,
  type Room,
  type CustomerOrder,
  type ShippingOrder,
} from "@/lib/inventory-schema";
import { applyDeliveryNotes, applyDeliveryScan, DeliveryCheckInError } from "@/lib/delivery/check-in";
import {
  assignPurchaseOrderJobId,
  findPurchaseOrder,
  jobIdForPurchaseOrder,
  saveBuyerPurchaseOrder,
  upsertPurchaseOrder,
} from "@/lib/purchase-orders";
import {
  binMixError,
  cartonsForQuantity,
  checkBinPlacement,
  nearestOpenLocation,
  occupantsByLocation,
  type BinOccupant,
  type PlacementLocation,
} from "@/lib/inventory/bin-container";
import { allocateLicensePlate } from "@/lib/license-plate/assign";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { divisionOf } from "@/lib/divisions";
import { primarySiteId } from "@/lib/sites/database";
import {
  allocatePutawayQuantity,
  buildPutawaySlots,
  locationHomeError,
  type PutawaySlice,
} from "@/lib/cubing/putaway-allocation";
import { deleteInboundEntry, refreshExpectedLoad, updateInboundEntry } from "@/lib/inbound/entry";
import {
  applyPartialInboundPallet,
  cancelEnteredInboundPurchaseOrder,
  expectedLinesFromPurchaseOrder,
  finishReceivingShipment,
  inboundCancelApplies,
} from "@/lib/inbound/receiving-transactions";
import { PersonNameSchema } from "@/lib/validation/fields";
import { parseWithSchema } from "@/backend/server/safeParsing";
import {
  addQuantity,
  applyAdjustment,
  caseItemAttributesFromInbound,
  pickFromInventory,
  putAwayCases,
  recountPallet,
  setOnHandQuantity,
  type StockChange,
} from "@/backend/server/inventory-ops";
import { readSystem, updateSystem } from "@/backend/server/store";
import { matchesScan, parseScanCode } from "@/lib/scan-code";
import {
  addStructuredLocation,
  NomenclatureError,
} from "@/lib/locations/hierarchy";
import {
  assertDamageReportedOnTab,
  buildDamageReport,
  resolveDamageHoldLocation,
  type DamageReport,
  type DamageReportSource,
} from "@/lib/inventory/damage";
import { photosForReference } from "@/lib/photos/query";
import { LIMITS } from "@/lib/validation/limits";
import {
  assertLargeInputConfirmed,
  sumQuantities,
} from "@/lib/validation/large-input";
import {
  assertActiveLocation,
  assertPutawayReady,
  assertUniquePicks,
} from "@/lib/validation/inventory-guards";
import {
  collectKnownProducts,
  resolveReceivingProductCodes,
} from "@/lib/codes/product-codes";
import {
  applyReopenAsPartial,
  casesPendingPutaway,
  hasPostedPutaway,
  isCasePutawayPosted,
} from "@/lib/receiving/reopen";
import { caseCubicInches, defaultCubeCapacity, measureCaseCube, roundCube } from "@/lib/cubing/measure";
import {
  buildCubingLocations,
  committedCubeForLocation,
  incomingCaseCube,
  profilesFromCubes,
} from "@/lib/cubing/capacity";
import {
  cubingWorkflow,
  inventoryQuantityCubeMessage,
  type CubeRoute,
} from "@/lib/cubing/workflow";
import {
  parseInventorySpreadsheet,
  planInventoryImport,
  assertImportPlanReady,
  type SpreadsheetImportMode,
  type SpreadsheetImportPlan,
} from "@/lib/inventory/spreadsheet";
import {
  applyInventoryDetails,
  attributesFromReceiving,
  backfillOnHandAttributes,
} from "@/lib/inventory/details";
import { assertAvailableQuantity, reservedQuantity } from "@/lib/orders/availability";
import { applyInventoryMove } from "@/lib/inventory/move";
import { warehouseLabelPrinterName } from "@/lib/orders/documents";
import {
  assignHandlingPlate,
  reserveLicensePlateBuffers,
  stampInventoryLines,
} from "@/lib/license-plate/assign";
import {
  queryLicensePlate,
  type LicensePlateHit,
} from "@/lib/license-plate/query";
import { applyOrderFulfillment } from "@/lib/orders/fulfill";
import {
  acknowledgeWarehousePrint,
  cancelRemoteOrder,
  placeRemoteOrder,
} from "@/lib/orders/release";

export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function enrichInventory(
  system: WarehouseSnapshot,
): InventoryRow[] {
  const rooms = new Map(system.rooms.map((room) => [room.id, room]));
  const locations = new Map(
    system.locations.map((location) => [location.id, location]),
  );

  const plates = new Map((system.licensePlates ?? []).map((plate) => [plate.id, plate]));
  const containers = new Map(
    (system.containers ?? []).map((container) => [container.id, container]),
  );
  const trailers = new Map((system.trailers ?? []).map((trailer) => [trailer.id, trailer]));

  return system.inventoryItems.map((item) => {
    const location = locations.get(item.locationId);
    const room = location ? rooms.get(location.roomId) : undefined;
    const plate = item.licensePlateId ? plates.get(item.licensePlateId) : undefined;
    const container = item.containerId ? containers.get(item.containerId) : undefined;
    const trailer = plate?.trailerId ? trailers.get(plate.trailerId) : undefined;
    const filled = applyInventoryDetails(
      item,
      attributesFromReceiving(item, system.receivingOrders),
    );
    return {
      ...filled,
      locationCode: location?.code ?? "UNKNOWN",
      roomName: room?.name ?? "Unknown room",
      licensePlateCode: plate?.code ?? null,
      licensePlateNumber: filled.licensePlateNumber ?? null,
      containerCode: container?.code ?? null,
      trailerCode: trailer?.code ?? null,
    };
  });
}

export function enrichTransactions(
  system: WarehouseSnapshot,
): InventoryTransactionRow[] {
  const rooms = new Map(system.rooms.map((room) => [room.id, room]));
  const locations = new Map(
    system.locations.map((location) => [location.id, location]),
  );

  return system.transactions.map((entry) => {
    const location = entry.locationId
      ? locations.get(entry.locationId)
      : undefined;
    const destination = entry.destinationLocationId
      ? locations.get(entry.destinationLocationId)
      : undefined;
    const room = location ? rooms.get(location.roomId) : undefined;
    return {
      ...entry,
      locationCode: location?.code ?? "—",
      roomName: room?.name ?? "—",
      destinationLocationCode: destination?.code ?? null,
      photos: photosForReference(
        system.photos ?? [],
        entry.referenceType,
        entry.referenceId,
      ),
    };
  });
}

const MAX_TRANSACTIONS = 5000;

function appendTransactions(
  system: InventorySystem,
  type: InventoryTransaction["type"],
  changes: StockChange[],
  extra: Omit<Partial<InventoryTransaction>, "type"> & {
    occurredAt: string;
  },
) {
  for (const change of changes) {
    system.transactions.unshift({
      id: createId(),
      type,
      occurredAt: extra.occurredAt,
      sku: change.sku,
      upc: change.upc,
      batch: change.batch,
      inventoryItemId: change.inventoryItemId,
      locationId: change.locationId,
      destinationLocationId:
        change.destinationLocationId ?? extra.destinationLocationId ?? null,
      quantityDelta: change.quantityDelta,
      quantityBefore: change.quantityBefore,
      quantityAfter: change.quantityAfter,
      reason: change.cubeForced
        ? [extra.reason, "Forced cube override"].filter(Boolean).join(" · ")
        : extra.reason,
      referenceType: extra.referenceType,
      referenceId: extra.referenceId,
      scannedCode: extra.scannedCode,
      createdBy: extra.createdBy,
      notes: extra.notes,
      cubeForced: change.cubeForced === true,
    });
  }
  if (system.transactions.length > MAX_TRANSACTIONS) {
    system.transactions.length = MAX_TRANSACTIONS;
  }
}

function writeStock(
  system: InventorySystem,
  userId: string | null | undefined,
  items: InventoryItem[],
  changes: StockChange[],
  type: InventoryTransaction["type"],
  extra: Omit<Partial<InventoryTransaction>, "type"> & { occurredAt: string },
) {
  system.inventoryItems = stampInventoryLines(
    system,
    userId,
    items,
    new Set(changes.map((change) => change.inventoryItemId)),
  );
  appendTransactions(system, type, changes, extra);
}

function rowsForLicensePlate(
  system: InventorySystem,
  hit: LicensePlateHit,
): InventoryRow[] {
  const rows = enrichInventory(system);
  if (hit.kind === "inventory") {
    return rows.filter((item) => item.id === hit.inventoryItemId);
  }
  if (hit.kind === "hierarchy") {
    return rows.filter(
      (item) =>
        item.licensePlateId === hit.licensePlateId ||
        item.licensePlateNumber === hit.number,
    );
  }
  if (hit.kind === "check-in" && !hit.putawayPosted) return [];
  if (!hit.locationId) return [];
  return rows.filter(
    (item) =>
      item.sku === hit.sku &&
      (item.batch ?? null) === (hit.batch ?? null) &&
      item.locationId === hit.locationId,
  );
}

export function lookupInventory(
  system: InventorySystem,
  code: string,
): InventoryRow[] {
  const direct = queryLicensePlate(system, code);
  if (direct) return rowsForLicensePlate(system, direct);

  const parsed = parseScanCode(code);
  if (parsed.licensePlateNumber) {
    const nested = queryLicensePlate(system, parsed.licensePlateNumber);
    if (nested) return rowsForLicensePlate(system, nested);
    if (/^\d{8}$/.test(code.trim())) {
      const asUpc = enrichInventory(system).filter((item) =>
        matchesScan(item, { raw: code.trim(), upc: code.trim() }),
      );
      if (asUpc.length > 0) return asUpc;
    }
  }
  return enrichInventory(system).filter((item) => matchesScan(item, parsed));
}

function requirePallet(
  order: ReceivingOrder,
  palletId: string,
): Pallet {
  const pallet = order.pallets.find((entry) => entry.id === palletId);
  if (!pallet) {
    throw new ServiceError("Pallet not found on this receiving order.", 404);
  }
  return pallet;
}

function applyPutawayLocation(
  system: InventorySystem,
  input: { putawayLocationId?: string | null; putawayRoomId?: string | null },
): { putawayRoomId: string | null; putawayLocationId: string | null } {
  if (!input.putawayLocationId) {
    return {
      putawayRoomId: input.putawayRoomId ?? null,
      putawayLocationId: null,
    };
  }

  const location = assertActiveLocation(
    system.locations.find((entry) => entry.id === input.putawayLocationId),
    "putaway",
  );
  if (input.putawayRoomId && input.putawayRoomId !== location.roomId) {
    throw new ServiceError("Putaway location is not in the selected room.");
  }
  return {
    putawayRoomId: location.roomId,
    putawayLocationId: location.id,
  };
}

function caseFromInput(
  system: InventorySystem,
  raw: ReturnType<typeof CaseItemInputSchema.parse>,
  options: { caseId?: string; existingId?: string },
): CaseItem {
  const putaway = applyPutawayLocation(system, raw);
  const codes = resolveReceivingProductCodes({
    description: raw.description,
    sku: raw.sku,
    upc: raw.upc,
    generateSku: raw.generateSku,
    generateUpc: raw.generateUpc,
    products: collectKnownProducts(system, {
      excludeCaseId: options.existingId,
    }),
  });

  const fiber =
    raw.fiber?.isFiber
      ? raw.fiber
      : raw.fiber?.isFiber === false
        ? { ...raw.fiber, isFiber: false }
        : null;

  return {
    id: options.caseId ?? options.existingId ?? createId(),
    upc: codes.upc,
    sku: codes.sku,
    batch: raw.batch ?? null,
    quantityInCase: raw.quantityInCase,
    description: raw.description,
    manufacturer: raw.manufacturer ?? "",
    color: raw.color ?? null,
    fiber,
    putawayRoomId: putaway.putawayRoomId,
    putawayLocationId: putaway.putawayLocationId,
    putawayPostedAt: null,
  };
}

function requireOrder(system: InventorySystem, orderId: string): ReceivingOrder {
  const order = system.receivingOrders.find((entry) => entry.id === orderId);
  if (!order) {
    throw new ServiceError("Receiving order not found.", 404);
  }
  return order;
}

function requireReceivingEditable(order: ReceivingOrder): void {
  if (!isReceivingEditable(order.status)) {
    throw new ServiceError(
      `Receiving order ${order.orderNumber} is ${order.status} and cannot be edited.`,
    );
  }
}

function requireCancellable(order: ReceivingOrder): void {
  if (order.status === "completed" || order.status === "cancelled") {
    throw new ServiceError(
      `Receiving order ${order.orderNumber} is ${order.status} and cannot be cancelled.`,
    );
  }
}

function requireAwaitingPutaway(order: ReceivingOrder): void {
  if (!isAwaitingPutaway(order.status)) {
    throw new ServiceError(
      isReceivingEditable(order.status)
        ? `Finish receiving ${order.orderNumber} before starting putaway.`
        : `Receiving order ${order.orderNumber} is ${order.status} and cannot be put away.`,
    );
  }
}

function cubingLocationsFor(
  system: InventorySystem,
  excludeCaseIds?: ReadonlySet<string>,
) {
  return buildCubingLocations({
    locations: system.locations,
    items: system.inventoryItems,
    orders: system.receivingOrders,
    cubes: system.itemCubes,
    excludeCaseIds,
  });
}

function palletCubePlan(
  system: InventorySystem,
  cases: CaseItem[],
) {
  return cubingWorkflow({
    cases: cases.map((item) => ({
      id: item.id,
      sku: item.sku,
      quantity: item.quantityInCase,
    })),
    cubes: profilesFromCubes(system.itemCubes),
    locations: cubingLocationsFor(system),
  });
}

function receivingCubeBlocker(
  system: InventorySystem,
  order: ReceivingOrder,
): string | null {
  for (const pallet of order.pallets) {
    const pending = pallet.cases.filter((item) => !isCasePutawayPosted(item));
    if (pending.length === 0) continue;
    const plan = palletCubePlan(system, pending);
    if (plan.status === "fits" || plan.status === "empty") continue;
    return `Pallet ${pallet.palletNumber}: ${plan.directive}`;
  }
  return null;
}

function placementLocationsFor(
  system: InventorySystem,
  excludeCaseIds?: ReadonlySet<string>,
): PlacementLocation[] {
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
      system.receivingOrders,
      system.itemCubes,
      excludeCaseIds,
    ),
  }));
}

function assertDirectedCasesFit(
  system: InventorySystem,
  pallet: { cases: CaseItem[] } | undefined,
  locationId: string,
  cases: CaseItem[],
  freight: { poNumber?: string | null; jobIdNumber?: string | null },
  options?: { ignoreCube?: boolean },
): void {
  const location = system.locations.find((entry) => entry.id === locationId);
  if (!location) {
    throw new ServiceError("Putaway location was not found.", 404);
  }
  const incoming = incomingCaseCube(cases, system.itemCubes);
  if (incoming.missingSkus.length > 0) {
    throw new ServiceError(
      `Cube ${incoming.missingSkus.join(", ")} on the Cubing tab before directing this quantity. Enter length, width, and height in inches.`,
    );
  }
  const exclude = new Set(cases.map((item) => item.id));
  const occupants = occupantsByLocation(system.inventoryItems);
  const views = placementLocationsFor(system, exclude);
  const origin = views.find((entry) => entry.id === locationId);
  const sharing = [...(occupants.get(locationId) ?? [])];
  for (const item of cases) {
    const mix = binMixError(
      {
        sku: item.sku,
        batch: item.batch,
        quantity: item.quantityInCase,
        poNumber: freight.poNumber,
        jobIdNumber: freight.jobIdNumber,
      },
      sharing,
      location.code,
    );
    if (mix) {
      const suggestion = origin
        ? nearestOpenLocation({
            origin,
            incoming: {
              sku: item.sku,
              batch: item.batch,
              quantity: item.quantityInCase,
              poNumber: freight.poNumber,
              jobIdNumber: freight.jobIdNumber,
            },
            incomingCubicInches: incoming.cubicInches,
            locations: views,
            occupantsByLocation: occupants,
          })
        : null;
      throw new ServiceError(
        suggestion ? `${mix} Nearest open location is ${suggestion.code}.` : mix,
      );
    }
    sharing.push({
      sku: item.sku,
      batch: item.batch,
      quantity: item.quantityInCase,
      poNumber: freight.poNumber,
      jobIdNumber: freight.jobIdNumber,
    });
  }
  if (options?.ignoreCube || !origin) return;
  const placement = checkBinPlacement({
    location: origin,
    occupants: occupants.get(locationId) ?? [],
    incoming: {
      sku: cases[0]?.sku ?? "",
      batch: cases[0]?.batch,
      quantity: cases.reduce((sum, item) => sum + item.quantityInCase, 0),
      poNumber: freight.poNumber,
      jobIdNumber: freight.jobIdNumber,
    },
    incomingCubicInches: incoming.cubicInches,
    locations: views,
    occupantsByLocation: occupants,
  });
  if (placement.ok) return;
  const pending = (pallet?.cases ?? cases).filter((item) => !isCasePutawayPosted(item));
  const plan = palletCubePlan(system, pending);
  throw new ServiceError(`${placement.message} ${plan.directive}`);
}

function receivingFreight(system: InventorySystem, order: ReceivingOrder) {
  return {
    poNumber: order.poNumber,
    jobIdNumber: jobIdForPurchaseOrder(system.purchaseOrders ?? [], order.poNumber),
  };
}

function attachPutawayCartons(
  system: InventorySystem,
  items: InventoryItem[],
  cases: CaseItem[],
  freight: { poNumber?: string | null; jobIdNumber?: string | null },
  userId: string,
): InventoryItem[] {
  let next = items;
  for (const caseItem of cases) {
    if (!caseItem.putawayLocationId) continue;
    const cube = system.itemCubes.find((entry) => entry.sku === caseItem.sku);
    const plates = cartonsForQuantity(
      caseItem.quantityInCase,
      cube?.unitsPerCase,
      caseItem.licensePlateNumber,
      () => allocateLicensePlate(system, userId).number,
    );
    if (!caseItem.licensePlateNumber && plates[0]) {
      caseItem.licensePlateNumber = plates[0].licensePlateNumber;
    }
    next = next.map((item) => {
      if (item.locationId !== caseItem.putawayLocationId || item.sku !== caseItem.sku) return item;
      if ((item.batch ?? null) !== (caseItem.batch ?? null)) return item;
      const cartons = [...(item.cartons ?? [])];
      for (const plate of plates) {
        if (cartons.some((entry) => entry.licensePlateNumber === plate.licensePlateNumber)) continue;
        cartons.push(plate);
      }
      return {
        ...item,
        cartons,
        licensePlateNumber: item.licensePlateNumber ?? cartons[0]?.licensePlateNumber ?? null,
        poNumber: item.poNumber ?? freight.poNumber ?? null,
        jobIdNumber: item.jobIdNumber ?? freight.jobIdNumber ?? null,
      };
    });
  }
  return next;
}

function withNearestLocation(system: InventorySystem, locationId: string, message: string, incoming: BinOccupant, incomingCubicInches: number): string {
  const views = placementLocationsFor(system);
  const origin = views.find((entry) => entry.id === locationId);
  if (!origin) return message;
  const suggestion = nearestOpenLocation({
    origin,
    incoming,
    incomingCubicInches,
    locations: views,
    occupantsByLocation: occupantsByLocation(system.inventoryItems),
  });
  return suggestion ? `${message} Nearest open location is ${suggestion.code}.` : message;
}

function assertInventoryIncreaseFits(
  system: InventorySystem,
  sku: string,
  locationId: string,
  quantityBefore: number,
  quantityAfter: number,
): void {
  const location = system.locations.find((entry) => entry.id === locationId);
  if (!location) return;
  const existing = system.inventoryItems.find(
    (item) => item.locationId === locationId && item.sku === sku,
  );
  const cube = system.itemCubes.find((entry) => entry.sku === sku) ?? null;
  const addedCube = cube
    ? Math.max(0, caseCubicInches(quantityAfter, cube) - caseCubicInches(quantityBefore, cube))
    : 0;
  const incoming = {
    sku,
    batch: existing?.batch,
    quantity: Math.max(0, quantityAfter - quantityBefore),
    poNumber: existing?.poNumber,
    jobIdNumber: existing?.jobIdNumber,
  };
  const mix = binMixError(
    incoming,
    occupantsByLocation(system.inventoryItems).get(locationId) ?? [],
    location.code,
  );
  if (mix) {
    throw new ServiceError(withNearestLocation(system, locationId, mix, incoming, addedCube));
  }
  const message = inventoryQuantityCubeMessage({
    sku,
    locationCode: location.code,
    capacity: location.cubeCapacityCubicInches,
    committedCubicInches: committedCubeForLocation(
      locationId,
      system.inventoryItems,
      system.receivingOrders,
      system.itemCubes,
    ),
    cube: cube
      ? {
          sku: cube.sku,
          cubicInches: cube.cubicInches,
          unitsPerCase: cube.unitsPerCase,
        }
      : null,
    quantityBefore,
    quantityAfter,
  });
  if (message) {
    throw new ServiceError(
      withNearestLocation(
        system,
        locationId,
        message,
        incoming,
        addedCube,
      ),
    );
  }
}

function nextSplitPalletNumber(
  used: Set<string>,
  base: string,
  route: CubeRoute,
): string {
  const suffix = route === "rack" ? "RACK" : "PLT";
  let candidate = `${base}-${suffix}`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}${n}`;
    n += 1;
  }
  return candidate.slice(0, 200);
}

export async function listSystem(): Promise<InventorySystem> {
  return readSystem();
}

export async function getReceivingOrder(orderId: string): Promise<ReceivingOrder> {
  const system = await readSystem();
  return requireOrder(system, orderId);
}

export async function createReceivingOrderRecord(
  rawData: unknown,
): Promise<ReceivingOrder> {
  const parsed = parseWithSchema(CreateReceivingOrderInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  assertLargeInputConfirmed(
    parsed.data.loadPalletCount,
    parsed.data,
    LIMITS.largePalletCount,
    "pallet count",
  );

  const now = nowIso();
  const order: ReceivingOrder = {
    id: createId(),
    poNumber: parsed.data.poNumber,
    receivedAt: parsed.data.receivedAt ?? now,
    vendor: parsed.data.vendor,
    orderNumber: parsed.data.orderNumber,
    carrierInbound: parsed.data.carrierInbound,
    receiverName: parsed.data.receiverName,
    loadPalletCount: parsed.data.loadPalletCount,
    status: "in-progress",
    backorderLines: [],
    isPartialed: false,
    workingPalletId: null,
    pallets: [],
    notes: parsed.data.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: parsed.data.createdBy,
  };

  return updateSystem((system) => {
    upsertPurchaseOrder(system.purchaseOrders, {
      id: createId(),
      purchaseOrderNumber: parsed.data.poNumber,
      generatedAt: parsed.data.poGeneratedAt ?? now,
      jobIdNumber: parsed.data.jobIdNumber,
    });
    system.receivingOrders.unshift(order);
    reserveLicensePlateBuffers(system, order.createdBy ?? order.receiverName);
    return order;
  });
}

export async function setPurchaseOrderJobIdRecord(
  rawData: unknown,
): Promise<PurchaseOrder> {
  const parsed = parseWithSchema(SetPurchaseOrderJobIdInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const updated = assignPurchaseOrderJobId(
      system.purchaseOrders,
      parsed.data.purchaseOrderNumber,
      parsed.data.jobIdNumber,
    );
    if (!updated) {
      throw new ServiceError(
        "Upload the buyer purchase order before assigning a job ID.",
      );
    }
    return updated;
  });
}

export async function saveBuyerPurchaseOrderRecord(
  rawData: unknown,
): Promise<PurchaseOrder> {
  const parsed = parseWithSchema(SaveBuyerPurchaseOrderInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  assertLargeInputConfirmed(
    sumQuantities(parsed.data.lines),
    parsed.data,
    LIMITS.largeQuantity,
    "expected quantity",
  );

  const now = nowIso();
  const receiver = PersonNameSchema.safeParse(parsed.data.createdBy);
  return updateSystem((system) => {
    const purchaseOrder = saveBuyerPurchaseOrder(system.purchaseOrders, {
      id: createId(),
      purchaseOrderNumber: parsed.data.purchaseOrderNumber,
      generatedAt: parsed.data.expectedArrivalAt,
      createdAt: now,
      projectId: parsed.data.projectId,
      jobIdNumber: parsed.data.jobIdNumber,
      vendor: parsed.data.vendor,
      carrier: parsed.data.carrier,
      expectedArrivalAt: parsed.data.expectedArrivalAt,
      buyerName: parsed.data.buyerName,
      notes: parsed.data.notes,
      expectationStatus: parsed.data.expectationStatus,
      expectedPalletCount: parsed.data.expectedPalletCount,
      lines: parsed.data.lines.map((line) => ({
        id: createId(),
        sku: line.sku,
        upc: line.upc,
        description: line.description,
        quantity: line.quantity,
      })),
      uploadedBy: parsed.data.createdBy,
    });
    refreshExpectedLoad(system, {
      purchaseOrderNumber: purchaseOrder.purchaseOrderNumber,
      vendor: purchaseOrder.vendor?.trim() || "Unspecified vendor",
      carrier: purchaseOrder.carrier?.trim() || "Unspecified carrier",
      palletCount: purchaseOrder.expectedPalletCount ?? 0,
      lines: purchaseOrder.lines ?? [],
      now,
      nextId: createId,
      receiverName: receiver.success ? receiver.data : "Expected Receiver",
    });
    return purchaseOrder;
  });
}

export async function updateInboundPurchaseOrderRecord(
  rawData: unknown,
): Promise<PurchaseOrder> {
  const parsed = parseWithSchema(UpdateInboundPurchaseOrderInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }
  assertLargeInputConfirmed(
    sumQuantities(parsed.data.lines),
    parsed.data,
    LIMITS.largeQuantity,
    "expected quantity",
  );
  const now = nowIso();
  return updateSystem((system) => {
    const result = updateInboundEntry(system, {
      id: parsed.data.id,
      purchaseOrderNumber: parsed.data.purchaseOrderNumber,
      projectId: parsed.data.projectId,
      jobIdNumber: parsed.data.jobIdNumber,
      vendor: parsed.data.vendor,
      carrier: parsed.data.carrier,
      expectedArrivalAt: parsed.data.expectedArrivalAt,
      buyerName: parsed.data.buyerName,
      notes: parsed.data.notes,
      expectationStatus: parsed.data.expectationStatus,
      expectedPalletCount: parsed.data.expectedPalletCount,
      lines: parsed.data.lines.map((line) => ({
        id: createId(),
        sku: line.sku,
        upc: line.upc,
        description: line.description,
        quantity: line.quantity,
      })),
      now,
      nextId: createId,
    });
    if (!result.ok) throw new ServiceError(result.error);
    return result.purchaseOrder;
  });
}

export async function deleteInboundPurchaseOrderRecord(
  rawData: unknown,
  actor: { role: string; id: string },
): Promise<string[]> {
  const parsed = parseWithSchema(DeleteInboundPurchaseOrderInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }
  return updateSystem((system) => {
    const result = deleteInboundEntry(system, parsed.data.id, {
      actorRole: actor.role,
      actorId: actor.id,
      now: nowIso(),
      dockConfirmText: parsed.data.dockConfirmText,
      nextId: createId,
    });
    if (!result.ok) throw new ServiceError(result.error);
    return result.documentIds;
  });
}

function requireShipment(system: InventorySystem, shipmentId: string) {
  const order = system.shippingOrders.find((entry) => entry.id === shipmentId);
  if (!order) {
    throw new ServiceError("Shipment was not found.");
  }
  return order;
}

export async function recordDeliveryScanRecord(
  rawData: unknown,
): Promise<DeliveryRecord> {
  const parsed = parseWithSchema(RecordDeliveryScanInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }
  const scannedAt = nowIso();
  return updateSystem((system) => {
    const order = requireShipment(system, parsed.data.shipmentId);
    try {
      order.delivery = applyDeliveryScan(order, {
        id: createId(),
        code: parsed.data.code,
        scannedAt,
        scannedBy: parsed.data.scannedBy,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        accuracyMeters: parsed.data.accuracyMeters,
      });
    } catch (error) {
      if (error instanceof DeliveryCheckInError) {
        throw new ServiceError(error.message);
      }
      throw error;
    }
    order.updatedAt = scannedAt;
    return order.delivery;
  });
}

export async function saveDeliveryNotesRecord(
  rawData: unknown,
): Promise<DeliveryRecord> {
  const parsed = parseWithSchema(SaveDeliveryNotesInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }
  const updatedAt = nowIso();
  return updateSystem((system) => {
    const order = requireShipment(system, parsed.data.shipmentId);
    try {
      order.delivery = applyDeliveryNotes(
        order,
        parsed.data.notes,
        updatedAt,
        parsed.data.updatedBy,
      );
    } catch (error) {
      if (error instanceof DeliveryCheckInError) {
        throw new ServiceError(error.message);
      }
      throw error;
    }
    order.updatedAt = updatedAt;
    return order.delivery;
  });
}

export async function addPalletToOrder(
  orderId: string,
  rawData: unknown,
): Promise<ReceivingOrder> {
  const parsed = parseWithSchema(PalletInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireReceivingEditable(order);

    const pallet: Pallet = recountPallet({
      id: createId(),
      palletNumber: parsed.data.palletNumber,
      trackingNumber: parsed.data.trackingNumber ?? "",
      isPartial: parsed.data.isPartial,
      partialedBy: parsed.data.partialedBy ?? null,
      expectedSkuCount: parsed.data.expectedSkuCount,
      expectedCaseCount: parsed.data.expectedCaseCount,
      actualSkuCount: 0,
      actualCaseCount: 0,
      cases: [],
      cubeRoute: null,
    });

    order.pallets.push(pallet);
    order.workingPalletId = pallet.id;
    order.status = "in-progress";
    order.updatedAt = nowIso();
    return order;
  });
}

export async function setWorkingPallet(
  orderId: string,
  palletId: string,
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireReceivingEditable(order);
    const pallet = order.pallets.find((entry) => entry.id === palletId);
    if (!pallet) {
      throw new ServiceError("Pallet not found on this receiving order.", 404);
    }
    order.workingPalletId = pallet.id;
    order.updatedAt = nowIso();
    return order;
  });
}

export async function addCaseToPallet(
  orderId: string,
  palletId: string,
  rawData: unknown,
): Promise<ReceivingOrder> {
  const parsed = parseWithSchema(CaseItemInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireReceivingEditable(order);
    const pallet = requirePallet(order, palletId);

    assertLargeInputConfirmed(
      parsed.data.quantityInCase,
      parsed.data,
      LIMITS.largeQuantity,
      "case quantity",
    );

    pallet.cases.push(
      assignHandlingPlate(
        system,
        order.createdBy ?? order.receiverName,
        caseFromInput(system, parsed.data, {}),
      ),
    );
    Object.assign(pallet, recountPallet(pallet));
    order.workingPalletId = pallet.id;
    order.updatedAt = nowIso();
    return order;
  });
}

export async function updateCaseOnPallet(
  orderId: string,
  palletId: string,
  caseId: string,
  rawData: unknown,
): Promise<ReceivingOrder> {
  const parsed = parseWithSchema(CaseItemInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireReceivingEditable(order);
    const pallet = requirePallet(order, palletId);
    const index = pallet.cases.findIndex((entry) => entry.id === caseId);
    if (index < 0) {
      throw new ServiceError("Case line was not found on this pallet.", 404);
    }
    if (isCasePutawayPosted(pallet.cases[index])) {
      throw new ServiceError(
        "That case is already on-hand and cannot be edited.",
      );
    }

    assertLargeInputConfirmed(
      parsed.data.quantityInCase,
      parsed.data,
      LIMITS.largeQuantity,
      "case quantity",
    );

    const previousPlate = pallet.cases[index]?.licensePlateNumber;
    pallet.cases[index] = assignHandlingPlate(
      system,
      order.createdBy ?? order.receiverName,
      caseFromInput(system, parsed.data, {
        existingId: caseId,
      }),
      previousPlate,
    );
    Object.assign(pallet, recountPallet(pallet));
    order.workingPalletId = pallet.id;
    order.updatedAt = nowIso();
    return order;
  });
}

export async function removeCaseFromPallet(
  orderId: string,
  palletId: string,
  caseId: string,
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireReceivingEditable(order);
    const pallet = requirePallet(order, palletId);
    const index = pallet.cases.findIndex((entry) => entry.id === caseId);
    if (index < 0) {
      throw new ServiceError("Case line was not found on this pallet.", 404);
    }
    if (isCasePutawayPosted(pallet.cases[index])) {
      throw new ServiceError(
        "That case is already on-hand and cannot be removed.",
      );
    }
    pallet.cases.splice(index, 1);
    Object.assign(pallet, recountPallet(pallet));
    order.workingPalletId = pallet.id;
    order.updatedAt = nowIso();
    return order;
  });
}

export async function completeReceivingOrder(
  orderId: string,
  confirmation?: {
    confirmLargeInput?: boolean;
    confirmationQuantity?: number;
    acknowledgeBackorder?: boolean;
  },
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireReceivingEditable(order);

    const cases = casesPendingPutaway(order);
    const totalUnits = cases.reduce((sum, item) => sum + item.quantityInCase, 0);
    assertLargeInputConfirmed(
      totalUnits,
      confirmation,
      LIMITS.largeQuantity,
      "receiving total",
    );
    const cubeBlocker = receivingCubeBlocker(system, order);
    if (cubeBlocker) {
      throw new ServiceError(cubeBlocker);
    }
    const purchaseOrder = findPurchaseOrder(system.purchaseOrders, order.poNumber) ?? null;
    const finished = finishReceivingShipment(order, purchaseOrder, {
      acknowledgeBackorder: confirmation?.acknowledgeBackorder === true,
      now: nowIso(),
    });
    if (!finished.ok) throw new ServiceError(finished.error);
    return order;
  });
}

export async function reopenReceivingOrder(
  orderId: string,
  actorName: string,
  rawData: unknown = {},
): Promise<ReceivingOrder> {
  const parsed = parseWithSchema(ReopenReceivingInputSchema, rawData ?? {});
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    try {
      applyReopenAsPartial(
        order,
        actorName,
        nowIso(),
        parsed.data.expectedPalletCount,
      );
    } catch (error) {
      throw new ServiceError(
        error instanceof Error ? error.message : "Unable to reopen this order.",
      );
    }
    return order;
  });
}

export async function assignPutawayLocation(
  orderId: string,
  palletId: string,
  caseId: string,
  rawData: unknown,
): Promise<ReceivingOrder> {
  const parsed = parseWithSchema(PutawayLocationInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireAwaitingPutaway(order);
    const pallet = requirePallet(order, palletId);
    const putaway = applyPutawayLocation(system, parsed.data);
    const candidates = parsed.data.applyToPallet
      ? pallet.cases
      : pallet.cases.filter((entry) => entry.id === caseId);
    const targets = candidates.filter((entry) => !isCasePutawayPosted(entry));

    if (!parsed.data.applyToPallet && candidates.length === 0) {
      throw new ServiceError("Case line was not found on this pallet.", 404);
    }
    if (candidates.some((entry) => isCasePutawayPosted(entry)) && !parsed.data.applyToPallet) {
      throw new ServiceError("That case is already on-hand.");
    }
    if (targets.length === 0) {
      throw new ServiceError("This pallet has no remaining cases to put away.");
    }

    if (putaway.putawayLocationId) {
      applyCubeAllocation(system, order, pallet, targets, putaway.putawayLocationId, {
        force: parsed.data.forceCube,
      });
    }

    order.updatedAt = nowIso();
    return order;
  });
}

function casesFromSlices(source: CaseItem, slices: PutawaySlice[]): CaseItem[] {
  return slices.map((slice, index) => ({
    ...source,
    id: index === 0 ? source.id : createId(),
    quantityInCase: slice.quantity,
    putawayRoomId: slice.roomId,
    putawayLocationId: slice.locationId,
    putawayPostedAt: null,
    licensePlateNumber: index === 0 ? source.licensePlateNumber : null,
    cubeForced: slice.role === "forced",
  }));
}

function applyCubeAllocation(
  system: InventorySystem,
  order: ReceivingOrder,
  pallet: Pallet,
  targets: CaseItem[],
  locationId: string,
  options: { force: boolean },
): void {
  const division = divisionOf(order);
  const siteId = primarySiteId(system, division) ?? "";
  const freight = receivingFreight(system, order);
  const slots = buildPutawaySlots({
    locations: system.locations,
    bays: system.bays,
    aisles: system.aisles,
    zones: system.zones,
    buildings: system.buildings,
    items: system.inventoryItems,
    orders: system.receivingOrders,
    cubes: system.itemCubes,
    purchaseOrders: system.purchaseOrders,
    excludeCaseIds: new Set(targets.map((item) => item.id)),
  });
  const chosen = slots.find((slot) => slot.id === locationId);
  if (!chosen) {
    throw new ServiceError("Putaway location was not found.", 404);
  }
  const homeError = locationHomeError(chosen, division, siteId);
  if (homeError) throw new ServiceError(homeError);

  const working = slots.map((slot) => ({
    ...slot,
    occupants: slot.occupants.map((occupant) => ({ ...occupant })),
  }));
  const replacements = new Map<string, CaseItem[]>();

  for (const caseItem of targets) {
    const cube = system.itemCubes.find((entry) => entry.sku === caseItem.sku);
    const plan = allocatePutawayQuantity({
      quantity: caseItem.quantityInCase,
      cubicInchesPerUnit: cube ? cube.cubicInches / cube.unitsPerCase : 0,
      projectId: freight.jobIdNumber,
      poNumber: freight.poNumber,
      sku: caseItem.sku,
      batch: caseItem.batch,
      division,
      siteId,
      locationId,
      locations: working,
      force: options.force,
    });
    if (!plan.ok) throw new ServiceError(plan.error);
    for (const slice of plan.slices) {
      const slot = working.find((entry) => entry.id === slice.locationId);
      if (!slot) continue;
      slot.committedCubicInches = roundCube(slot.committedCubicInches + slice.cubicInches);
      slot.occupants.push({
        sku: caseItem.sku,
        batch: caseItem.batch,
        quantity: slice.quantity,
        poNumber: freight.poNumber,
        jobIdNumber: freight.jobIdNumber,
      });
    }
    replacements.set(caseItem.id, casesFromSlices(caseItem, plan.slices));
  }

  for (const [caseId, nextCases] of replacements) {
    const index = pallet.cases.findIndex((item) => item.id === caseId);
    if (index < 0) continue;
    pallet.cases.splice(index, 1, ...nextCases);
  }
  Object.assign(pallet, recountPallet(pallet));
}

export async function completePutawayOrder(
  orderId: string,
  confirmation?: {
    confirmLargeInput?: boolean;
    confirmationQuantity?: number;
    confirmCubeFit?: boolean;
  },
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireAwaitingPutaway(order);
    if (confirmation?.confirmCubeFit !== true) {
      throw new ServiceError(
        "Verify that this inventory will fit before completing putaway.",
      );
    }

    const pending = casesPendingPutaway(order);
    if (pending.length === 0) {
      throw new ServiceError("There are no received cases to put away.");
    }
    assertPutawayReady(pending);
    const division = divisionOf(order);
    const siteId = primarySiteId(system, division) ?? "";
    const slots = buildPutawaySlots({
      locations: system.locations,
      bays: system.bays,
      aisles: system.aisles,
      zones: system.zones,
      buildings: system.buildings,
      items: system.inventoryItems,
      orders: system.receivingOrders,
      cubes: system.itemCubes,
      purchaseOrders: system.purchaseOrders,
      excludeCaseIds: new Set(pending.map((item) => item.id)),
    });
    const byLocation = new Map<string, CaseItem[]>();
    for (const item of pending) {
      if (!item.putawayLocationId) continue;
      const group = byLocation.get(item.putawayLocationId) ?? [];
      group.push(item);
      byLocation.set(item.putawayLocationId, group);
    }
    for (const [locationId, group] of byLocation) {
      const slot = slots.find((entry) => entry.id === locationId);
      const homeError = slot ? locationHomeError(slot, division, siteId) : "Putaway location was not found.";
      if (homeError) throw new ServiceError(homeError);
      const pallet = order.pallets.find((entry) =>
        entry.cases.some((item) => group.some((candidate) => candidate.id === item.id)),
      );
      const forced = group.every((item) => item.cubeForced === true);
      assertDirectedCasesFit(
        system,
        pallet,
        locationId,
        group,
        receivingFreight(system, order),
        { ignoreCube: forced },
      );
    }
    const totalUnits = pending.reduce((sum, item) => sum + item.quantityInCase, 0);
    assertLargeInputConfirmed(
      totalUnits,
      confirmation,
      LIMITS.largeQuantity,
      "putaway total",
    );

    const now = nowIso();
    const result = putAwayCases(system.inventoryItems, pending, now);
    const freight = receivingFreight(system, order);
    const stocked = attachPutawayCartons(
      system,
      result.items,
      pending,
      freight,
      order.createdBy ?? order.receiverName,
    );
    writeStock(
      system,
      order.createdBy ?? order.receiverName,
      stocked,
      result.changes,
      "putaway",
      {
        occurredAt: now,
        referenceType: "receiving-order",
        referenceId: order.id,
        createdBy: order.createdBy ?? order.receiverName,
        reason: `Putaway ${order.orderNumber}`,
      },
    );
    for (const item of pending) {
      item.putawayPostedAt = now;
    }
    order.status = "completed";
    order.workingPalletId = null;
    order.updatedAt = nowIso();
    return order;
  });
}

export async function partialReceivingPalletRecord(
  orderId: string,
  palletId: string,
  partialedBy: string,
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    const purchaseOrder = findPurchaseOrder(system.purchaseOrders, order.poNumber) ?? null;
    const result = applyPartialInboundPallet({
      order,
      palletId,
      partialedBy,
      expectedLines: expectedLinesFromPurchaseOrder(purchaseOrder),
      now: nowIso(),
    });
    if (!result.ok) throw new ServiceError(result.error);
    return order;
  });
}

export async function cancelInboundPurchaseOrderRecord(
  rawData: unknown,
  actor: { role: string; id: string },
): Promise<string[]> {
  const parsed = parseWithSchema(CancelInboundPurchaseOrderInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }
  return updateSystem((system) => {
    const result = cancelEnteredInboundPurchaseOrder(system, parsed.data.id, {
      actorRole: actor.role,
      actorId: actor.id,
      confirmText: parsed.data.confirmText,
      now: nowIso(),
      nextId: createId,
    });
    if (!result.ok) throw new ServiceError(result.error);
    return result.documentIds;
  });
}

export async function cancelReceivingOrder(
  orderId: string,
  actor?: { role: string; id?: string; confirmText?: string },
): Promise<{ order: ReceivingOrder; documentIds: string[] }> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireCancellable(order);
    if (hasPostedPutaway(order)) {
      throw new ServiceError(
        "This order already has on-hand inventory and cannot be cancelled. Keep it open as a partialed PO until remaining freight arrives.",
      );
    }
    const purchaseOrder = findPurchaseOrder(system.purchaseOrders, order.poNumber) ?? null;
    if (inboundCancelApplies(order, purchaseOrder, system.receivingOrders) && purchaseOrder) {
      const result = cancelEnteredInboundPurchaseOrder(system, purchaseOrder.id, {
        actorRole: actor?.role ?? "",
        actorId: actor?.id,
        confirmText: actor?.confirmText,
        now: nowIso(),
        nextId: createId,
      });
      if (!result.ok) throw new ServiceError(result.error);
      return { order, documentIds: result.documentIds };
    }
    order.status = "cancelled";
    order.workingPalletId = null;
    order.updatedAt = nowIso();
    return { order, documentIds: [] };
  });
}

export async function createShippingOrderRecord(
  rawData: unknown,
): Promise<ShippingOrder> {
  const parsed = parseWithSchema(CreateShippingOrderInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  assertUniquePicks(parsed.data.picks);
  assertLargeInputConfirmed(
    sumQuantities(parsed.data.picks),
    parsed.data,
    LIMITS.largePickTotal,
    "shipment quantity",
  );

  return updateSystem((system) => {
    for (const pick of parsed.data.picks) {
      const item = system.inventoryItems.find(
        (entry) => entry.id === pick.inventoryItemId,
      );
      if (!item) {
        throw new ServiceError("One of the selected inventory lines no longer exists.");
      }
      assertActiveLocation(
        system.locations.find((entry) => entry.id === item.locationId),
        "shipping",
      );
      assertAvailableQuantity(
        item.quantity,
        reservedQuantity(system.customerOrders ?? [], item.id),
        pick.quantity,
        item.sku,
        "ship",
      );
    }

    const now = nowIso();
    const { remaining, shippedCases, changes } = pickFromInventory(
      system.inventoryItems,
      parsed.data.picks,
      now,
    );
    const plateUser = parsed.data.createdBy ?? parsed.data.shipperName;
    for (let index = 0; index < shippedCases.length; index += 1) {
      const shipped = shippedCases[index]!;
      const attributes = caseItemAttributesFromInbound(
        system.receivingOrders,
        shipped.sku,
        shipped.batch,
      );
      if (!shipped.manufacturer) shipped.manufacturer = attributes.manufacturer;
      if (shipped.color == null) shipped.color = attributes.color;
      shippedCases[index] = assignHandlingPlate(system, plateUser, shipped);
    }

    const pallet: Pallet = recountPallet({
      id: createId(),
      palletNumber: "OUT-1",
      trackingNumber: parsed.data.trackingNumber ?? "",
      isPartial: false,
      partialedBy: null,
      expectedSkuCount: shippedCases.length,
      expectedCaseCount: shippedCases.length,
      actualSkuCount: 0,
      actualCaseCount: 0,
      cases: shippedCases,
      cubeRoute: null,
    });

    const order: ShippingOrder = {
      id: createId(),
      shippedAt: now,
      customer: parsed.data.customer,
      shipmentNumber: parsed.data.shipmentNumber,
      carrierOutbound: parsed.data.carrierOutbound,
      shipperName: parsed.data.shipperName,
      loadPalletCount: 1,
      waitingOnItems: false,
      itemsInJeopardy: [],
      status: "shipped",
      pallets: [pallet],
      notes: parsed.data.notes,
      createdAt: now,
      updatedAt: now,
      createdBy: parsed.data.createdBy,
    };

    writeStock(
      system,
      parsed.data.createdBy ?? parsed.data.shipperName,
      remaining,
      changes,
      "shipping",
      {
        occurredAt: now,
        referenceType: "shipping-order",
        referenceId: order.id,
        createdBy: parsed.data.createdBy ?? parsed.data.shipperName,
        reason: `Shipment ${parsed.data.shipmentNumber}`,
      },
    );
    system.shippingOrders.unshift(order);
    return order;
  });
}

export async function createCustomerOrderRecord(
  rawData: unknown,
): Promise<CustomerOrder> {
  const parsed = parseWithSchema(CreateCustomerOrderInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }
  const placedBy = parsed.data.placedBy ?? parsed.data.createdBy;
  if (!placedBy) {
    throw new ServiceError("A name is required to place an order.");
  }
  assertLargeInputConfirmed(
    sumQuantities(parsed.data.lines),
    parsed.data,
    LIMITS.largePickTotal,
    "order quantity",
  );

  return updateSystem((system) => {
    if (!system.customerOrders) system.customerOrders = [];
    system.inventoryItems = stampInventoryLines(
      system,
      placedBy,
      system.inventoryItems,
      new Set(parsed.data.lines.map((line) => line.inventoryItemId)),
    );
    const order = placeRemoteOrder({
      customer: parsed.data.customer,
      notes: parsed.data.notes,
      placedBy,
      createdBy: parsed.data.createdBy,
      now: nowIso(),
      printerName: warehouseLabelPrinterName(),
      existingOrders: system.customerOrders ?? [],
      inventory: system.inventoryItems,
      locations: system.locations,
      lines: parsed.data.lines,
    });
    system.customerOrders.unshift(order);
    return order;
  });
}

function requireCustomerOrder(
  system: InventorySystem,
  orderId: string,
): CustomerOrder {
  const order = system.customerOrders.find((entry) => entry.id === orderId);
  if (!order) {
    throw new ServiceError("Order not found.", 404);
  }
  return order;
}

export async function cancelCustomerOrderRecord(
  orderId: string,
): Promise<CustomerOrder> {
  return updateSystem((system) => {
    const index = system.customerOrders.findIndex((entry) => entry.id === orderId);
    if (index < 0) {
      throw new ServiceError("Order not found.", 404);
    }
    const next = cancelRemoteOrder(system.customerOrders[index], nowIso());
    system.customerOrders[index] = next;
    return next;
  });
}

export async function completeCustomerOrderPickRecord(
  orderId: string,
  completedBy: string,
): Promise<CustomerOrder> {
  return updateSystem((system) => {
    const order = requireCustomerOrder(system, orderId);
    const now = nowIso();
    const result = applyOrderFulfillment({
      order,
      items: system.inventoryItems,
      now,
      completedBy,
    });
    writeStock(system, completedBy, result.items, result.changes, "pick", {
      occurredAt: now,
      referenceType: "customer-order",
      referenceId: order.id,
      createdBy: completedBy,
      reason: `Pick ${order.pickRequest.requestNumber} for ${order.orderNumber}`,
    });
    for (const line of result.order.lines) {
      if (line.licensePlateNumber) continue;
      const item = system.inventoryItems.find((entry) => entry.id === line.inventoryItemId);
      if (item?.licensePlateNumber) line.licensePlateNumber = item.licensePlateNumber;
    }
    const index = system.customerOrders.findIndex((entry) => entry.id === orderId);
    system.customerOrders[index] = result.order;
    return result.order;
  });
}

export async function acknowledgeWarehousePrintsRecord(
  orderIds: string[],
): Promise<number> {
  return updateSystem((system) => {
    const now = nowIso();
    let count = 0;
    for (const orderId of orderIds) {
      const index = system.customerOrders.findIndex((entry) => entry.id === orderId);
      if (index < 0) continue;
      const current = system.customerOrders[index];
      if (current.printBatch.status === "printed") continue;
      system.customerOrders[index] = acknowledgeWarehousePrint(current, now);
      count += 1;
    }
    return count;
  });
}

export async function createRoomRecord(rawData: unknown): Promise<Room> {
  const parsed = parseWithSchema(CreateRoomInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const duplicate = system.rooms.find(
      (room) => room.name.toLowerCase() === parsed.data.name.toLowerCase(),
    );
    if (duplicate) {
      throw new ServiceError("A room with that name already exists.");
    }

    const room: Room = {
      id: createId(),
      name: parsed.data.name,
      description: parsed.data.description,
    };
    system.rooms.push(room);
    return room;
  });
}

function isStructuredLocationInput(rawData: unknown): boolean {
  return Boolean(
    rawData &&
      typeof rawData === "object" &&
      "bayId" in rawData &&
      (rawData as { bayId?: unknown }).bayId,
  );
}

export async function createLocationRecord(
  rawData: unknown,
): Promise<Location> {
  if (isStructuredLocationInput(rawData)) {
    const parsed = parseWithSchema(CreateStructuredLocationInputSchema, rawData);
    if (!parsed.success) {
      throw new ServiceError(parsed.error);
    }
    return updateSystem((system) => {
      try {
        return addStructuredLocation(system, parsed.data);
      } catch (error) {
        if (error instanceof NomenclatureError) {
          throw new ServiceError(error.message);
        }
        throw error;
      }
    });
  }

  const parsed = parseWithSchema(CreateLocationInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const room = system.rooms.find((entry) => entry.id === parsed.data.roomId);
    if (!room) {
      throw new ServiceError("Room not found.", 404);
    }
    const duplicate = system.locations.find(
      (location) => location.code.toLowerCase() === parsed.data.code.toLowerCase(),
    );
    if (duplicate) {
      throw new ServiceError("A location with that code already exists.");
    }

    const location: Location = {
      id: createId(),
      code: parsed.data.code,
      roomId: parsed.data.roomId,
      description: parsed.data.description,
      isActive: true,
      storageClass: parsed.data.storageClass,
      cubeCapacityCubicInches:
        parsed.data.cubeCapacityCubicInches ??
        defaultCubeCapacity(parsed.data.storageClass),
    };
    system.locations.push(location);
    return location;
  });
}

export async function saveItemCubeRecord(rawData: unknown): Promise<ItemCube> {
  const source =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : {};
  const cubedBy =
    typeof source.cubedBy === "string"
      ? source.cubedBy
      : typeof source.createdBy === "string"
        ? source.createdBy
        : undefined;
  const parsed = parseWithSchema(CubeItemInputSchema, { ...source, cubedBy });
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  let measured;
  try {
    measured = measureCaseCube(
      parsed.data.lengthInches,
      parsed.data.widthInches,
      parsed.data.heightInches,
    );
  } catch (error) {
    throw new ServiceError(
      error instanceof Error
        ? error.message
        : "Enter length, width, and height in inches.",
    );
  }

  const cube: ItemCube = {
    sku: parsed.data.sku,
    description: parsed.data.description ?? "",
    lengthInches: measured.lengthInches,
    widthInches: measured.widthInches,
    heightInches: measured.heightInches,
    cubicInches: measured.cubicInches,
    unitsPerCase: parsed.data.unitsPerCase,
    cubedAt: nowIso(),
    cubedBy: parsed.data.cubedBy,
  };

  return updateSystem((system) => {
    const index = system.itemCubes.findIndex((entry) => entry.sku === cube.sku);
    if (index >= 0) system.itemCubes[index] = cube;
    else system.itemCubes.push(cube);
    system.itemCubes.sort((left, right) => left.sku.localeCompare(right.sku));
    return cube;
  });
}

export async function updateLocationCapacityRecord(
  rawData: unknown,
): Promise<Location> {
  const parsed = parseWithSchema(UpdateLocationCapacityInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  return updateSystem((system) => {
    const location = system.locations.find((entry) => entry.id === parsed.data.id);
    if (!location) {
      throw new ServiceError("Location was not found.", 404);
    }
    location.storageClass = parsed.data.storageClass;
    location.cubeCapacityCubicInches = parsed.data.cubeCapacityCubicInches;
    return location;
  });
}

export async function breakDownPalletForCube(
  orderId: string,
  palletId: string,
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    if (!isReceivingEditable(order.status) && !isAwaitingPutaway(order.status)) {
      throw new ServiceError(
        `Receiving order ${order.orderNumber} is ${order.status} and cannot be broken down.`,
      );
    }
    const pallet = requirePallet(order, palletId);
    const posted = pallet.cases.filter((item) => isCasePutawayPosted(item));
    const pending = pallet.cases.filter((item) => !isCasePutawayPosted(item));
    const plan = palletCubePlan(system, pending);
    if (plan.status !== "break-down") {
      throw new ServiceError(plan.directive);
    }

    const primaryIds = new Set(plan.loads[0]?.caseIds ?? []);
    pallet.cases = [
      ...posted,
      ...pending.filter((item) => primaryIds.has(item.id)),
    ];
    pallet.cubeRoute = plan.loads[0]?.route ?? "pallet";
    Object.assign(pallet, recountPallet(pallet));

    const usedNumbers = new Set(order.pallets.map((entry) => entry.palletNumber));
    for (const load of plan.loads.slice(1)) {
      const ids = new Set(load.caseIds);
      const cases = pending.filter((item) => ids.has(item.id));
      const palletNumber = nextSplitPalletNumber(
        usedNumbers,
        pallet.palletNumber,
        load.route,
      );
      usedNumbers.add(palletNumber);
      order.pallets.push(
        recountPallet({
          id: createId(),
          palletNumber,
          trackingNumber: pallet.trackingNumber,
          isPartial: false,
          partialedBy: null,
          expectedSkuCount: new Set(cases.map((item) => item.sku)).size,
          actualSkuCount: 0,
          expectedCaseCount: cases.length,
          actualCaseCount: 0,
          cases,
          cubeRoute: load.route,
        }),
      );
    }
    order.updatedAt = nowIso();
    return order;
  });
}

export async function getInventoryRows(): Promise<InventoryRow[]> {
  const system = await readSystem();
  if (backfillOnHandAttributes(system)) {
    await updateSystem((current) => {
      backfillOnHandAttributes(current);
    });
  }
  return enrichInventory(system);
}

export type InventorySpreadsheetImportResult = SpreadsheetImportPlan & {
  dryRun: boolean;
  applied: boolean;
  importId?: string;
};

export async function importInventorySpreadsheet(input: {
  text: string;
  mode: SpreadsheetImportMode;
  dryRun?: boolean;
  createdBy?: string;
  confirmLargeInput?: boolean;
  confirmationQuantity?: number;
}): Promise<InventorySpreadsheetImportResult> {
  const rows = parseInventorySpreadsheet(input.text);
  if (rows.length === 0) {
    throw new ServiceError("Spreadsheet has a header row but no inventory lines.");
  }

  const system = await readSystem();
    const plan = planInventoryImport({
    rows,
    items: system.inventoryItems,
    locations: system.locations,
    rooms: system.rooms,
    products: collectKnownProducts(system),
    mode: input.mode,
    cubes: system.itemCubes,
  });

  if (input.dryRun) {
    return { ...plan, dryRun: true, applied: false };
  }

  assertImportPlanReady(plan);
  assertLargeInputConfirmed(
    Math.abs(plan.unitsDelta),
    input,
    LIMITS.largeQuantity,
    "spreadsheet unit change",
  );

  return updateSystem((current) => {
    const now = nowIso();
    const importId = createId();
    const latestPlan = planInventoryImport({
      rows,
      items: current.inventoryItems,
      locations: current.locations,
      rooms: current.rooms,
      products: collectKnownProducts(current),
      mode: input.mode,
      cubes: current.itemCubes,
    });
    assertImportPlanReady(latestPlan);
    assertLargeInputConfirmed(
      Math.abs(latestPlan.unitsDelta),
      input,
      LIMITS.largeQuantity,
      "spreadsheet unit change",
    );

    let items = current.inventoryItems;
    const stockChanges: StockChange[] = [];
    for (const change of latestPlan.changes) {
      if (change.action === "unchanged") continue;
      const result = setOnHandQuantity(items, {
        sku: change.sku,
        upc: change.upc,
        batch: change.batch,
        locationId: change.locationId,
        quantity: change.quantityAfter,
        description: change.description,
        details: {
          ...(change.manufacturer !== undefined
            ? { manufacturer: change.manufacturer }
            : {}),
          ...(change.color !== undefined ? { color: change.color } : {}),
          ...(change.fiber !== undefined ? { fiber: change.fiber } : {}),
        },
        now,
      });
      items = result.items;
      if (result.change) stockChanges.push(result.change);
    }
    if (stockChanges.length === 0) {
      throw new ServiceError("Spreadsheet matches on-hand inventory. Nothing to import.");
    }

    writeStock(current, input.createdBy, items, stockChanges, "import", {
      occurredAt: now,
      reason:
        input.mode === "add"
          ? "Spreadsheet import (add to on-hand)"
          : "Spreadsheet import (set on-hand)",
      createdBy: input.createdBy,
      referenceType: "spreadsheet-import",
      referenceId: importId,
    });
    return { ...latestPlan, dryRun: false, applied: true, importId };
  });
}

export async function getTransactionRows(): Promise<InventoryTransactionRow[]> {
  const system = await readSystem();
  return enrichTransactions(system);
}

export async function getDamageReport(): Promise<DamageReport> {
  const system = await readSystem();
  return buildDamageReport(system.transactions);
}

export async function lookupInventoryByCode(
  code: string,
): Promise<InventoryRow[]> {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new ServiceError("Query parameter `code` is required.");
  }
  if (trimmed.length > LIMITS.notes) {
    throw new ServiceError("Scan code is too long.");
  }
  const system = await readSystem();
  return lookupInventory(system, trimmed);
}

export type AdjustmentRecordResult = StockChange & { referenceId: string };

export async function createAdjustmentRecord(
  rawData: unknown,
  source: DamageReportSource = "adjustment",
): Promise<AdjustmentRecordResult> {
  const parsed = parseWithSchema(CreateAdjustmentInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  const input = parsed.data;
  if (!["overage", "shortage", "damage"].includes(input.type)) {
    throw new ServiceError("Adjustment type must be overage, shortage, or damage.");
  }
  assertDamageReportedOnTab(input.type, source);

  assertLargeInputConfirmed(
    input.quantity,
    input,
    LIMITS.largeQuantity,
    "adjustment quantity",
  );

  return updateSystem((system) => {
    const now = nowIso();
    const scanned = input.scannedCode
      ? parseScanCode(input.scannedCode)
      : parseScanCode(input.upc || input.sku || "");
    const sku = input.sku || scanned.sku;
    const upc = input.upc || scanned.upc;
    const batch = input.batch ?? scanned.batch ?? null;
    const adjustmentId = createId();

    let target = undefined as (typeof system.inventoryItems)[number] | undefined;
    if (input.inventoryItemId) {
      target = system.inventoryItems.find(
        (item) => item.id === input.inventoryItemId,
      );
      if (!target) {
        throw new ServiceError("Inventory line not found.", 404);
      }
    }

    if (!target) {
      const matches = system.inventoryItems.filter((item) => {
        if (input.locationId && item.locationId !== input.locationId) {
          return false;
        }
        if (input.batch !== undefined && input.batch !== item.batch) {
          return false;
        }
        return matchesScan(item, {
          raw: input.scannedCode || sku || upc || "",
          sku,
          upc,
          batch: batch ?? undefined,
        });
      });

      if (matches.length === 1) {
        target = matches[0];
      } else if (matches.length > 1) {
        const onHand = matches.filter((item) => item.quantity > 0);
        target = onHand.length === 1 ? onHand[0] : undefined;
        if (!target) {
          throw new ServiceError(
            "Multiple matching inventory lines. Choose a specific location.",
          );
        }
      }
    }

    if (!target && input.type === "overage") {
      if (!sku || !input.locationId) {
        throw new ServiceError(
          "Overage of a new line requires a SKU and putaway location.",
        );
      }
      const location = assertActiveLocation(
        system.locations.find(
          (entry) => entry.id === input.locationId,
        ),
        "overage putaway",
      );
      assertInventoryIncreaseFits(system, sku, location.id, 0, input.quantity);
      const created = addQuantity(system.inventoryItems, {
        sku,
        upc,
        batch,
        locationId: location.id,
        quantity: input.quantity,
        description: input.description,
        now,
      });
      writeStock(system, input.createdBy, created.items, [created.change], "overage", {
        occurredAt: now,
        reason: input.reason,
        notes: input.notes,
        createdBy: input.createdBy,
        scannedCode: input.scannedCode,
        referenceType: "adjustment",
        referenceId: adjustmentId,
      });
      return { ...created.change, referenceId: adjustmentId };
    }

    if (!target) {
      throw new ServiceError(
        "No matching inventory line. Scan a barcode/QR or select a SKU and location.",
      );
    }

    if (input.type === "damage" && input.moveDamagedToLocationId) {
      resolveDamageHoldLocation(target.locationId, input.moveDamagedToLocationId);
      const damagedLocation = system.locations.find(
        (location) => location.id === input.moveDamagedToLocationId,
      );
      if (!damagedLocation) {
        throw new ServiceError("Damaged hold location was not found.");
      }
      const destination = system.inventoryItems.find(
        (item) =>
          item.sku === target.sku &&
          item.locationId === damagedLocation.id &&
          (item.batch ?? null) === (target.batch ?? null),
      );
      assertInventoryIncreaseFits(
        system,
        target.sku,
        damagedLocation.id,
        destination?.quantity ?? 0,
        (destination?.quantity ?? 0) + input.quantity,
      );
    }

    if (input.type === "overage") {
      assertInventoryIncreaseFits(
        system,
        target.sku,
        target.locationId,
        target.quantity,
        target.quantity + input.quantity,
      );
    }

    const result = applyAdjustment({
      items: system.inventoryItems,
      target,
      type: input.type,
      quantity: input.quantity,
      now,
      damagedLocationId:
        input.type === "damage" ? input.moveDamagedToLocationId : undefined,
    });
    writeStock(system, input.createdBy, result.items, result.changes, input.type, {
      occurredAt: now,
      reason: input.reason,
      notes: input.notes,
      createdBy: input.createdBy,
      scannedCode: input.scannedCode,
      referenceType: "adjustment",
      referenceId: adjustmentId,
    });
    const change = result.changes[0];
    if (!change) {
      throw new ServiceError("Adjustment did not produce a stock change.");
    }
    return { ...change, referenceId: adjustmentId };
  });
}

export async function moveInventoryRecord(rawData: unknown): Promise<{
  sku: string;
  quantity: number;
  sourceLocationCode: string;
  destinationLocationCode: string;
  referenceId: string;
}> {
  const parsed = parseWithSchema(MoveInventoryInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }
  const input = parsed.data;
  const referenceId = createId();
  const now = nowIso();

  return updateSystem((system) => {
    const result = applyInventoryMove(system, input, now);
    const destination = system.locations.find(
      (location) => location.id === input.destinationLocationId,
    );
    writeStock(system, input.createdBy, result.items, result.changes, "move", {
      occurredAt: now,
      reason: `RF move to ${destination?.code ?? "bin"}`,
      notes: input.notes,
      createdBy: input.createdBy,
      scannedCode: input.scannedCode,
      referenceType: "inventory-move",
      referenceId,
    });
    const source = system.locations.find(
      (location) => location.id === result.changes[0]?.locationId,
    );
    return {
      sku: result.changes[0]?.sku ?? "",
      quantity: input.quantity,
      sourceLocationCode: source?.code ?? "",
      destinationLocationCode: destination?.code ?? "",
      referenceId,
    };
  });
}
