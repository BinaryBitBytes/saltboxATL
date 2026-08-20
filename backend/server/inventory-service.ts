import {
  CaseItemInputSchema,
  CreateAdjustmentInputSchema,
  CreateLocationInputSchema,
  CreateReceivingOrderInputSchema,
  CreateRoomInputSchema,
  CreateShippingOrderInputSchema,
  PalletInputSchema,
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

function requireOrder(system: InventorySystem, orderId: string): ReceivingOrder {
  const order = system.receivingOrders.find((entry) => entry.id === orderId);
  if (!order) {
    throw new ServiceError("Receiving order not found.", 404);
  }
  return order;
}

function requireMutableOrder(order: ReceivingOrder): void {
  if (order.status === "completed" || order.status === "cancelled") {
    throw new ServiceError(
      `Receiving order ${order.orderNumber} is ${order.status} and cannot be edited.`,
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
    requireMutableOrder(order);

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
    requireMutableOrder(order);
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
    requireMutableOrder(order);
    const pallet = order.pallets.find((entry) => entry.id === palletId);
    if (!pallet) {
      throw new ServiceError("Pallet not found on this receiving order.", 404);
    }

    if (parsed.data.putawayLocationId) {
      const location = system.locations.find(
        (entry) => entry.id === parsed.data.putawayLocationId,
      );
      if (!location) {
        throw new ServiceError("Putaway location was not found.");
      }
      if (
        parsed.data.putawayRoomId &&
        parsed.data.putawayRoomId !== location.roomId
      ) {
        throw new ServiceError("Putaway location is not in the selected room.");
      }
      parsed.data.putawayRoomId = location.roomId;
    }

    const fiber =
      parsed.data.fiber?.isFiber
        ? parsed.data.fiber
        : parsed.data.fiber?.isFiber === false
          ? { ...parsed.data.fiber, isFiber: false }
          : null;

    const caseItem: CaseItem = {
      id: parsed.data.id ?? createId(),
      upc: parsed.data.upc,
      sku: parsed.data.sku,
      batch: parsed.data.batch ?? null,
      quantityInCase: parsed.data.quantityInCase,
      description: parsed.data.description,
      fiber,
      putawayRoomId: parsed.data.putawayRoomId ?? null,
      putawayLocationId: parsed.data.putawayLocationId ?? null,
    };

    pallet.cases.push(caseItem);
    const updated = recountPallet(pallet);
    Object.assign(pallet, updated);
    order.workingPalletId = pallet.id;
    order.updatedAt = nowIso();
    return order;
  });
}

export async function completeReceivingOrder(
  orderId: string,
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const order = requireOrder(system, orderId);
    requireMutableOrder(order);

    const cases = order.pallets.flatMap((pallet) => pallet.cases);
    if (cases.length === 0) {
      throw new ServiceError(
        "Receive at least one case before completing this order.",
      );
    }

    const now = nowIso();
    const result = putAwayCases(system.inventoryItems, cases, now);
    system.inventoryItems = result.items;
    appendTransactions(system, "receiving", result.changes, {
      occurredAt: now,
      referenceType: "receiving-order",
      referenceId: order.id,
      createdBy: order.createdBy ?? order.receiverName,
      reason: `Receiving ${order.orderNumber}`,
    });
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
    requireMutableOrder(order);
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

  return updateSystem((system) => {
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
  const system = await readSystem();
  return lookupInventory(system, code);
}

export async function createAdjustmentRecord(rawData: unknown) {
  const parsed = parseWithSchema(CreateAdjustmentInputSchema, rawData);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  const input = parsed.data;
  if (!["overage", "shortage", "damage"].includes(input.type)) {
    throw new ServiceError("Adjustment type must be overage, shortage, or damage.");
  }

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
      const location = system.locations.find(
        (entry) => entry.id === input.locationId,
      );
      if (!location) {
        throw new ServiceError("Location was not found.", 404);
      }
      const created = addQuantity(system.inventoryItems, {
        sku,
        upc,
        batch,
        locationId: input.locationId,
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
      return created.change;
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
    return result.changes[0];
  });
}
