import type { FiberItem, InventoryItem } from "@/lib/inventory-schema";

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
