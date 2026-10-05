import type {
  FiberItem,
  InventoryItem,
  ReceivingOrder,
} from "@/lib/inventory-schema";

export type InventoryLineDetails = {
  manufacturer?: string;
  color?: string | null;
  fiber?: FiberItem | null;
};

export function fibersEqual(
  left: FiberItem | null | undefined,
  right: FiberItem | null | undefined,
): boolean {
  const a = left ?? null;
  const b = right ?? null;
  if (!a || !b) return a === b;
  return (
    a.isFiber === b.isFiber &&
    (a.connectionType ?? null) === (b.connectionType ?? null) &&
    (a.strandCount ?? null) === (b.strandCount ?? null) &&
    (a.lengthMeters ?? null) === (b.lengthMeters ?? null)
  );
}

export function applyInventoryDetails(
  item: InventoryItem,
  details?: InventoryLineDetails,
): InventoryItem {
  if (!details) return item;
  return {
    ...item,
    manufacturer:
      details.manufacturer !== undefined
        ? details.manufacturer
        : (item.manufacturer ?? ""),
    color: details.color !== undefined ? details.color : (item.color ?? null),
    fiber: details.fiber !== undefined ? details.fiber : (item.fiber ?? null),
  };
}

type AttributeCandidate = {
  score: number;
  manufacturer: string;
  color: string | null;
  fiber: FiberItem | null;
};

function sameSku(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function attributeCandidates(
  item: InventoryItem,
  orders: ReceivingOrder[],
): AttributeCandidate[] {
  const candidates: AttributeCandidate[] = [];
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const pallet of order.pallets) {
      for (const caseItem of pallet.cases) {
        if (!sameSku(caseItem.sku, item.sku)) continue;
        let score = 1;
        if ((caseItem.batch ?? null) === (item.batch ?? null)) score += 4;
        if (caseItem.putawayLocationId && caseItem.putawayLocationId === item.locationId) {
          score += 2;
        }
        if (caseItem.putawayPostedAt) score += 1;
        candidates.push({
          score,
          manufacturer: caseItem.manufacturer ?? "",
          color: caseItem.color ?? null,
          fiber: caseItem.fiber ?? null,
        });
      }
    }
  }
  return candidates;
}

function bestText(
  candidates: AttributeCandidate[],
  read: (candidate: AttributeCandidate) => string,
): string | undefined {
  const withValue = candidates.filter((candidate) => read(candidate).trim());
  if (withValue.length === 0) return undefined;
  const top = Math.max(...withValue.map((candidate) => candidate.score));
  const winners = withValue.filter((candidate) => candidate.score === top);
  const value = read(winners[0]!).trim();
  if (winners.every((candidate) => read(candidate).trim().toLowerCase() === value.toLowerCase())) {
    return value;
  }
  return undefined;
}

function bestFiber(candidates: AttributeCandidate[]): FiberItem | undefined {
  const withValue = candidates.filter((candidate) => candidate.fiber);
  if (withValue.length === 0) return undefined;
  const top = Math.max(...withValue.map((candidate) => candidate.score));
  const winners = withValue.filter((candidate) => candidate.score === top);
  const value = winners[0]!.fiber;
  if (!value) return undefined;
  if (winners.every((candidate) => fibersEqual(candidate.fiber, value))) {
    return value;
  }
  return undefined;
}

export function attributesFromReceiving(
  item: InventoryItem,
  orders: ReceivingOrder[],
): InventoryLineDetails {
  const candidates = attributeCandidates(item, orders);
  const details: InventoryLineDetails = {};
  if (!item.manufacturer) {
    const manufacturer = bestText(candidates, (candidate) => candidate.manufacturer);
    if (manufacturer) details.manufacturer = manufacturer;
  }
  if (item.color == null || item.color === "") {
    const color = bestText(candidates, (candidate) => candidate.color ?? "");
    if (color) details.color = color;
  }
  if (item.fiber == null) {
    const fiber = bestFiber(candidates);
    if (fiber) details.fiber = fiber;
  }
  return details;
}

export function backfillOnHandAttributes(input: {
  inventoryItems: InventoryItem[];
  receivingOrders: ReceivingOrder[];
}): boolean {
  let changed = false;
  for (const item of input.inventoryItems) {
    const details = attributesFromReceiving(item, input.receivingOrders);
    if (!inventoryDetailsDiffer(item, details)) continue;
    const next = applyInventoryDetails(item, details);
    item.manufacturer = next.manufacturer;
    item.color = next.color;
    item.fiber = next.fiber;
    changed = true;
  }
  return changed;
}

export function inventoryDetailsDiffer(
  item: InventoryItem,
  details?: InventoryLineDetails,
): boolean {
  if (!details) return false;
  const next = applyInventoryDetails(item, details);
  return (
    (next.manufacturer ?? "") !== (item.manufacturer ?? "") ||
    (next.color ?? null) !== (item.color ?? null) ||
    !fibersEqual(item.fiber, next.fiber)
  );
}
