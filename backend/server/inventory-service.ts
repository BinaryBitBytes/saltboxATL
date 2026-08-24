import {
  CaseItemInputSchema,
  CreateAdjustmentInputSchema,
  CreateLocationInputSchema,
  CreateReceivingOrderInputSchema,
  CreateRoomInputSchema,
  CreateShippingOrderInputSchema,
  PalletInputSchema,
  PutawayLocationInputSchema,
  ReopenReceivingInputSchema,
  isAwaitingPutaway,
  isReceivingEditable,
  type CaseItem,
  type InventoryRow,
  type InventorySystem,
  type InventoryTransaction,
  type InventoryTransactionRow,
  type Location,
  type Pallet,
  type ReceivingOrder,
  type Room,
  type ShippingOrder,
} from "@/lib/inventory-schema";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { parseWithSchema } from "@/backend/server/safeParsing";
import {
  addQuantity,
  applyAdjustment,
  pickFromInventory,
  putAwayCases,
  recountPallet,
  type StockChange,
} from "@/backend/server/inventory-ops";
import { readSystem, updateSystem } from "@/backend/server/store";
import { matchesScan, parseScanCode } from "@/lib/scan-code";
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
  system: InventorySystem,
): InventoryRow[] {
  const rooms = new Map(system.rooms.map((room) => [room.id, room]));
  const locations = new Map(
    system.locations.map((location) => [location.id, location]),
  );

  return system.inventoryItems.map((item) => {
    const location = locations.get(item.locationId);
    const room = location ? rooms.get(location.roomId) : undefined;
    return {
      ...item,
      locationCode: location?.code ?? "UNKNOWN",
      roomName: room?.name ?? "Unknown room",
    };
  });
}

export function enrichTransactions(
  system: InventorySystem,
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
      reason: extra.reason,
      referenceType: extra.referenceType,
      referenceId: extra.referenceId,
      scannedCode: extra.scannedCode,
      createdBy: extra.createdBy,
      notes: extra.notes,
    });
  }
  if (system.transactions.length > MAX_TRANSACTIONS) {
    system.transactions.length = MAX_TRANSACTIONS;
  }
}

export function lookupInventory(
  system: InventorySystem,
  code: string,
): InventoryRow[] {
  const parsed = parseScanCode(code);
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

function upsertPurchaseOrder(
  system: InventorySystem,
  poNumber: string,
  generatedAt: string,
): void {
  const existing = system.purchaseOrders.find(
    (po) => po.purchaseOrderNumber === poNumber,
  );
  if (!existing) {
    system.purchaseOrders.unshift({
      id: createId(),
      purchaseOrderNumber: poNumber,
      generatedAt,
      createdAt: generatedAt,
    });
  }
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
    isPartialed: false,
    workingPalletId: null,
    pallets: [],
    notes: parsed.data.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: parsed.data.createdBy,
  };

  return updateSystem((system) => {
    upsertPurchaseOrder(
      system,
      parsed.data.poNumber,
      parsed.data.poGeneratedAt ?? now,
    );
    system.receivingOrders.unshift(order);
    return order;
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
      isPartial: parsed.data.isPartial,
      partialedBy: parsed.data.partialedBy ?? null,
      expectedSkuCount: parsed.data.expectedSkuCount,
      expectedCaseCount: parsed.data.expectedCaseCount,
      actualSkuCount: 0,
      actualCaseCount: 0,
      cases: [],
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

    pallet.cases.push(caseFromInput(system, parsed.data, {}));
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

    pallet.cases[index] = caseFromInput(system, parsed.data, {
      existingId: caseId,
    });
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
  confirmation?: { confirmLargeInput?: boolean; confirmationQuantity?: number },
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireReceivingEditable(order);

    const cases = casesPendingPutaway(order);
    if (cases.length === 0) {
      throw new ServiceError(
        hasPostedPutaway(order)
          ? "Receive at least one additional case before completing this partialed order."
          : "Receive at least one case before completing this order.",
      );
    }
    const totalUnits = cases.reduce((sum, item) => sum + item.quantityInCase, 0);
    assertLargeInputConfirmed(
      totalUnits,
      confirmation,
      LIMITS.largeQuantity,
      "receiving total",
    );

    order.status = "received";
    order.workingPalletId = null;
    order.updatedAt = nowIso();
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

    for (const caseItem of targets) {
      caseItem.putawayRoomId = putaway.putawayRoomId;
      caseItem.putawayLocationId = putaway.putawayLocationId;
    }
    order.updatedAt = nowIso();
    return order;
  });
}

export async function completePutawayOrder(
  orderId: string,
  confirmation?: { confirmLargeInput?: boolean; confirmationQuantity?: number },
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireAwaitingPutaway(order);

    const pending = casesPendingPutaway(order);
    if (pending.length === 0) {
      throw new ServiceError("There are no received cases to put away.");
    }
    assertPutawayReady(pending);
    const totalUnits = pending.reduce((sum, item) => sum + item.quantityInCase, 0);
    assertLargeInputConfirmed(
      totalUnits,
      confirmation,
      LIMITS.largeQuantity,
      "putaway total",
    );

    const now = nowIso();
    const result = putAwayCases(system.inventoryItems, pending, now);
    system.inventoryItems = result.items;
    appendTransactions(system, "putaway", result.changes, {
      occurredAt: now,
      referenceType: "receiving-order",
      referenceId: order.id,
      createdBy: order.createdBy ?? order.receiverName,
      reason: `Putaway ${order.orderNumber}`,
    });
    for (const item of pending) {
      item.putawayPostedAt = now;
    }
    order.status = "completed";
    order.workingPalletId = null;
    order.updatedAt = nowIso();
    return order;
  });
}

export async function cancelReceivingOrder(
  orderId: string,
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireCancellable(order);
    if (hasPostedPutaway(order)) {
      throw new ServiceError(
        "This order already has on-hand inventory and cannot be cancelled. Keep it open as a partialed PO until remaining freight arrives.",
      );
    }
    order.status = "cancelled";
    order.workingPalletId = null;
    order.updatedAt = nowIso();
    return order;
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
    }

    const now = nowIso();
    const { remaining, shippedCases, changes } = pickFromInventory(
      system.inventoryItems,
      parsed.data.picks,
      now,
    );

    const pallet: Pallet = recountPallet({
      id: createId(),
      palletNumber: "OUT-1",
      isPartial: false,
      partialedBy: null,
      expectedSkuCount: shippedCases.length,
      expectedCaseCount: shippedCases.length,
      actualSkuCount: 0,
      actualCaseCount: 0,
      cases: shippedCases,
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

    system.inventoryItems = remaining;
    appendTransactions(system, "shipping", changes, {
      occurredAt: now,
      referenceType: "shipping-order",
      referenceId: order.id,
      createdBy: parsed.data.createdBy ?? parsed.data.shipperName,
      reason: `Shipment ${parsed.data.shipmentNumber}`,
    });
    system.shippingOrders.unshift(order);
    return order;
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

export async function createLocationRecord(
  rawData: unknown,
): Promise<Location> {
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
    };
    system.locations.push(location);
    return location;
  });
}

export async function getInventoryRows(): Promise<InventoryRow[]> {
  const system = await readSystem();
  return enrichInventory(system);
}

export async function getTransactionRows(): Promise<InventoryTransactionRow[]> {
  const system = await readSystem();
  return enrichTransactions(system);
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
): Promise<AdjustmentRecordResult> {
  const parsed = parseWithSchema(CreateAdjustmentInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  const input = parsed.data;
  if (!["overage", "shortage", "damage"].includes(input.type)) {
    throw new ServiceError("Adjustment type must be overage, shortage, or damage.");
  }

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
      const created = addQuantity(system.inventoryItems, {
        sku,
        upc,
        batch,
        locationId: location.id,
        quantity: input.quantity,
        description: input.description,
        now,
      });
      system.inventoryItems = created.items;
      appendTransactions(system, "overage", [created.change], {
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
      const damagedLocation = system.locations.find(
        (location) => location.id === input.moveDamagedToLocationId,
      );
      if (!damagedLocation) {
        throw new ServiceError("Damaged hold location was not found.");
      }
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
    system.inventoryItems = result.items;
    appendTransactions(system, input.type, result.changes, {
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
