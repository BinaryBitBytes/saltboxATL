import type { InventoryItem, InventorySystem } from "@/lib/inventory-schema";
import {
  emptyLedger,
  fillBuffers,
  issuePlate,
  normalizeUserId,
  ordinalForPlateValue,
  parsePlateNumber,
  presentPlate,
  type IssuedLicensePlate,
  type LicensePlateLedger,
} from "@/lib/license-plate/sequence";

export function ensureLedger(system: InventorySystem): LicensePlateLedger {
  if (!system.licensePlateLedger) {
    system.licensePlateLedger = emptyLedger();
  }
  const ledger = system.licensePlateLedger;
  ledger.nextOrdinal = ledger.nextOrdinal ?? 0;
  ledger.activeUsers = [...(ledger.activeUsers ?? [])];
  ledger.reservations = (ledger.reservations ?? []).map((entry) => ({
    userId: entry.userId,
    plates: [...entry.plates],
  }));
  return ledger;
}

function addIssued(values: Set<number>, raw: string | null | undefined): void {
  const number = parsePlateNumber(raw);
  if (!number) return;
  values.add(Number(number));
}

export function collectIssuedValues(system: InventorySystem): Set<number> {
  const values = new Set<number>();
  for (const item of system.inventoryItems ?? []) {
    addIssued(values, item.licensePlateNumber);
    for (const carton of item.cartons ?? []) addIssued(values, carton.licensePlateNumber);
  }
  for (const order of system.receivingOrders ?? []) {
    for (const pallet of order.pallets ?? []) {
      for (const item of pallet.cases ?? []) addIssued(values, item.licensePlateNumber);
    }
  }
  for (const order of system.shippingOrders ?? []) {
    for (const pallet of order.pallets ?? []) {
      for (const item of pallet.cases ?? []) addIssued(values, item.licensePlateNumber);
    }
  }
  for (const plate of system.licensePlates ?? []) addIssued(values, plate.code);
  return values;
}

/** Move the cursor past numbers already stored, and drop them from buffers. */
export function syncLedgerCursor(
  ledger: LicensePlateLedger,
  issued: ReadonlySet<number>,
): void {
  let highest = ledger.nextOrdinal - 1;
  for (const value of issued) {
    const ordinal = ordinalForPlateValue(value);
    if (ordinal > highest) highest = ordinal;
  }
  if (highest + 1 > ledger.nextOrdinal) {
    ledger.nextOrdinal = highest + 1;
  }
  for (const slot of ledger.reservations) {
    slot.plates = slot.plates.filter((plate) => !issued.has(plate));
  }
}

/**
 * Users with an open receiving or shipping order, plus the person
 * allocating right now. Buffer depth follows this count.
 */
export function currentEntryUsers(
  system: InventorySystem,
  actingUserId?: string | null,
): string[] {
  const ids = new Set<string>();
  const actor = actingUserId?.trim();
  if (actor) ids.add(normalizeUserId(actor));
  for (const order of system.receivingOrders ?? []) {
    if (order.status === "cancelled" || order.status === "completed") continue;
    const who = order.createdBy?.trim() || order.receiverName?.trim();
    if (who) ids.add(normalizeUserId(who));
  }
  for (const order of system.shippingOrders ?? []) {
    if (order.status === "shipped" || order.status === "cancelled") continue;
    const who = order.createdBy?.trim() || order.shipperName?.trim();
    if (who) ids.add(normalizeUserId(who));
  }
  if (ids.size === 0) ids.add("system");
  return [...ids].sort();
}

export function reserveLicensePlateBuffers(
  system: InventorySystem,
  userId?: string | null,
): LicensePlateLedger {
  const ledger = ensureLedger(system);
  syncLedgerCursor(ledger, collectIssuedValues(system));
  fillBuffers(ledger, currentEntryUsers(system, userId));
  return ledger;
}

export function allocateLicensePlate(
  system: InventorySystem,
  userId?: string | null,
): IssuedLicensePlate {
  const ledger = ensureLedger(system);
  const issued = collectIssuedValues(system);
  syncLedgerCursor(ledger, issued);
  const actor = normalizeUserId(userId);
  const active = currentEntryUsers(system, actor);
  let value = issuePlate(ledger, actor, active);
  let guard = 0;
  while (issued.has(value)) {
    guard += 1;
    if (guard > 1000) {
      throw new Error("Could not allocate a unique license plate.");
    }
    value = issuePlate(ledger, actor, active);
  }
  return presentPlate(value);
}

export function assignHandlingPlate<T extends { licensePlateNumber?: string | null }>(
  system: InventorySystem,
  userId: string | null | undefined,
  record: T,
  keep?: string | null,
): T {
  const existing = parsePlateNumber(keep ?? record.licensePlateNumber);
  if (existing) {
    return record.licensePlateNumber === existing
      ? record
      : { ...record, licensePlateNumber: existing };
  }
  return { ...record, licensePlateNumber: allocateLicensePlate(system, userId).number };
}

export function stampInventoryLines(
  system: InventorySystem,
  userId: string | null | undefined,
  items: InventoryItem[],
  changedIds: ReadonlySet<string>,
): InventoryItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (
      !changedIds.has(item.id) ||
      item.quantity <= 0 ||
      parsePlateNumber(item.licensePlateNumber)
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      licensePlateNumber: allocateLicensePlate(system, userId).number,
    };
  });
  return changed ? next : items;
}
