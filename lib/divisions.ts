import {
  USER_ROLES,
  type Division,
  type InventorySystem,
  type UserRole,
} from "@/lib/inventory-schema";

export const DIVISION_COOKIE = "saltbox_division";

/** Division_1 Hyperscale and Division_2 Security. */
export const DIVISION_CATALOG: ReadonlyArray<{
  id: Division;
  code: "Division_1" | "Division_2";
  name: "Hyperscale" | "Security";
}> = [
  { id: "hyperscale", code: "Division_1", name: "Hyperscale" },
  { id: "security", code: "Division_2", name: "Security" },
];

export function asDivision(value: unknown): Division {
  return value === "security" ? "security" : "hyperscale";
}

export function divisionOf(
  record: { division?: unknown } | null | undefined,
): Division {
  return asDivision(record?.division);
}

export function divisionLabel(division: Division): string {
  const entry = DIVISION_CATALOG.find((item) => item.id === division);
  if (!entry) return "Division_1: Hyperscale";
  return `${entry.code}: ${entry.name}`;
}

/**
 * Existing roles belong to Hyperscale. Security associate and security manager
 * are the Security division's copies of those warehouse roles.
 */
export function divisionForRole(role: UserRole): Division {
  if (role === "security-associate" || role === "security-manager") {
    return "security";
  }
  return "hyperscale";
}

/**
 * The existing manager is the admin who can open both inventories.
 * Every other role, including the Security manager, stays in one division.
 */
export function canSwitchDivision(role: UserRole): boolean {
  return role === "manager";
}

export function selectDivision(role: UserRole, requested: unknown): Division {
  if (
    canSwitchDivision(role) &&
    (requested === "hyperscale" || requested === "security")
  ) {
    return requested;
  }
  return divisionForRole(role);
}

export function assignableRoles(role: UserRole): readonly UserRole[] {
  if (canSwitchDivision(role)) return USER_ROLES;
  if (role === "security-manager") {
    return USER_ROLES.filter((entry) => divisionForRole(entry) === "security");
  }
  return [];
}

export function canAssignRole(actor: UserRole, role: UserRole): boolean {
  return assignableRoles(actor).includes(role);
}

export function canManageUser(actor: UserRole, target: UserRole): boolean {
  if (canSwitchDivision(actor)) return true;
  return divisionForRole(actor) === divisionForRole(target);
}

function inDivision<T extends { division?: unknown }>(
  records: readonly T[] | undefined,
  division: Division,
): T[] {
  return (records ?? []).filter((record) => divisionOf(record) === division);
}

/** Working copy of one division. User records stay intact for login uniqueness. */
export function scopeSystem(
  system: InventorySystem,
  division: Division,
): InventorySystem {
  const scoped = structuredClone(system);
  scoped.purchaseOrders = inDivision(scoped.purchaseOrders, division);
  scoped.purchaseDocuments = inDivision(scoped.purchaseDocuments, division);
  scoped.receivingOrders = inDivision(scoped.receivingOrders, division);
  scoped.shippingOrders = inDivision(scoped.shippingOrders, division);
  scoped.customerOrders = inDivision(scoped.customerOrders, division);
  scoped.inventoryItems = inDivision(scoped.inventoryItems, division);
  scoped.locations = inDivision(scoped.locations, division);
  scoped.rooms = inDivision(scoped.rooms, division);
  scoped.transactions = inDivision(scoped.transactions, division);
  scoped.photos = inDivision(scoped.photos, division);
  scoped.itemCubes = inDivision(scoped.itemCubes, division);
  return scoped;
}

function replaceDivision<T extends { division?: unknown }>(
  current: readonly T[] | undefined,
  next: readonly T[] | undefined,
  division: Division,
): T[] {
  const kept = (current ?? []).filter((record) => divisionOf(record) !== division);
  const updated = (next ?? []).map((record) => ({ ...record, division }));
  return [...kept, ...updated];
}

/**
 * Write the active division's slice back into the full system.
 * Records from the other division are left in place.
 */
export function mergeDivision(
  full: InventorySystem,
  scoped: InventorySystem,
  division: Division,
): InventorySystem {
  full.purchaseOrders = replaceDivision(full.purchaseOrders, scoped.purchaseOrders, division);
  full.purchaseDocuments = replaceDivision(
    full.purchaseDocuments,
    scoped.purchaseDocuments,
    division,
  );
  full.receivingOrders = replaceDivision(full.receivingOrders, scoped.receivingOrders, division);
  full.shippingOrders = replaceDivision(full.shippingOrders, scoped.shippingOrders, division);
  full.customerOrders = replaceDivision(full.customerOrders, scoped.customerOrders, division);
  full.inventoryItems = replaceDivision(full.inventoryItems, scoped.inventoryItems, division);
  full.locations = replaceDivision(full.locations, scoped.locations, division);
  full.rooms = replaceDivision(full.rooms, scoped.rooms, division);
  full.transactions = replaceDivision(full.transactions, scoped.transactions, division);
  full.photos = replaceDivision(full.photos, scoped.photos, division);
  full.itemCubes = replaceDivision(full.itemCubes, scoped.itemCubes, division);
  full.users = scoped.users.map((user) => ({
    ...user,
    division: divisionForRole(user.role),
  }));
  return full;
}

export function filterUsersForViewer<T extends { role: UserRole }>(
  users: readonly T[],
  viewerRole: UserRole | null,
): T[] {
  if (!viewerRole || canSwitchDivision(viewerRole)) return [...users];
  const division = divisionForRole(viewerRole);
  return users.filter((user) => divisionForRole(user.role) === division);
}
