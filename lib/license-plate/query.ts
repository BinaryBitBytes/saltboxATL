import type {
  InventorySystem,
  ReceivingOrder,
  ShippingOrder,
} from "@/lib/inventory-schema";
import { formatPlateCode, parsePlateNumber } from "@/lib/license-plate/sequence";

export type LicensePlateHit =
  | {
      kind: "inventory";
      number: string;
      code: string;
      inventoryItemId: string;
      sku: string;
      batch: string | null;
      locationId: string;
    }
  | {
      kind: "check-in" | "check-out";
      number: string;
      code: string;
      caseId: string;
      orderId: string;
      orderNumber: string;
      sku: string;
      batch: string | null;
      locationId: string | null;
      putawayPosted: boolean;
    }
  | {
      kind: "hierarchy";
      number: string;
      code: string;
      licensePlateId: string;
      locationId: string | null;
      trailerId: string | null;
    };

export type LicensePlateRegistryRow = {
  number: string;
  ownerKind: LicensePlateHit["kind"];
  ownerId: string;
};

export type LicensePlateIndex = {
  byNumber: Map<string, LicensePlateHit>;
  conflicts: string[];
};

function addHit(
  index: LicensePlateIndex,
  number: string,
  hit: LicensePlateHit,
): void {
  if (index.byNumber.has(number)) {
    index.conflicts.push(number);
    return;
  }
  index.byNumber.set(number, hit);
}

function addCases(
  index: LicensePlateIndex,
  orders: Array<ReceivingOrder | ShippingOrder>,
  kind: "check-in" | "check-out",
  orderNumber: (order: ReceivingOrder | ShippingOrder) => string,
): void {
  for (const order of orders) {
    for (const pallet of order.pallets ?? []) {
      for (const item of pallet.cases ?? []) {
        const number = parsePlateNumber(item.licensePlateNumber);
        if (!number) continue;
        addHit(index, number, {
          kind,
          number,
          code: formatPlateCode(Number(number)),
          caseId: item.id,
          orderId: order.id,
          orderNumber: orderNumber(order),
          sku: item.sku,
          batch: item.batch ?? null,
          locationId: item.putawayLocationId ?? null,
          putawayPosted: Boolean(item.putawayPostedAt),
        });
      }
    }
  }
}

/** One map from the 8-digit plate to the single record that owns it. */
export function indexLicensePlates(system: InventorySystem): LicensePlateIndex {
  const index: LicensePlateIndex = { byNumber: new Map(), conflicts: [] };

  for (const plate of system.licensePlates ?? []) {
    const number = parsePlateNumber(plate.code);
    if (!number || plate.code.toUpperCase() !== `LP${number}`) continue;
    addHit(index, number, {
      kind: "hierarchy",
      number,
      code: `LP${number}`,
      licensePlateId: plate.id,
      locationId: plate.locationId,
      trailerId: plate.trailerId,
    });
  }

  addCases(
    index,
    system.receivingOrders ?? [],
    "check-in",
    (order) => ("orderNumber" in order ? order.orderNumber : order.id),
  );
  addCases(
    index,
    system.shippingOrders ?? [],
    "check-out",
    (order) => ("shipmentNumber" in order ? order.shipmentNumber : order.id),
  );

  for (const item of system.inventoryItems ?? []) {
    const numbers = new Set<string>();
    const primary = parsePlateNumber(item.licensePlateNumber);
    if (primary) numbers.add(primary);
    for (const carton of item.cartons ?? []) {
      const number = parsePlateNumber(carton.licensePlateNumber);
      if (number) numbers.add(number);
    }
    for (const number of numbers) {
      addHit(index, number, {
        kind: "inventory",
        number,
        code: formatPlateCode(Number(number)),
        inventoryItemId: item.id,
        sku: item.sku,
        batch: item.batch ?? null,
        locationId: item.locationId,
      });
    }
  }

  return index;
}

export function queryLicensePlate(
  system: InventorySystem,
  raw: string,
): LicensePlateHit | null {
  const number = parsePlateNumber(raw);
  if (!number) return null;
  return indexLicensePlates(system).byNumber.get(number) ?? null;
}

export function licensePlateRegistryRows(
  system: InventorySystem,
): LicensePlateRegistryRow[] {
  const index = indexLicensePlates(system);
  return [...index.byNumber.values()].map((hit) => ({
    number: hit.number,
    ownerKind: hit.kind,
    ownerId:
      hit.kind === "inventory"
        ? hit.inventoryItemId
        : hit.kind === "hierarchy"
          ? hit.licensePlateId
          : hit.caseId,
  }));
}
