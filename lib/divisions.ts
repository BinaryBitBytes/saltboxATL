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
 * Every other role, including the Security manager, stays in one division
 * until a manager or IT admin grants more.
 */
export function canSwitchDivision(role: UserRole): boolean {
  return role === "manager";
}

/** Managers and IT admins choose which divisions a login may open. */
export function canAssignDivisions(role: UserRole): boolean {
  return role === "manager" || role === "it-admin";
}

/**
 * Divisions this login may open.
 * An omitted list keeps the previous default: the manager opens both,
 * and every other role stays in the division for its role.
 */
export function viewableDivisions(input: {
  role: UserRole;
  allowedDivisions?: readonly Division[] | null;
}): Division[] {
  const catalog = DIVISION_CATALOG.map((entry) => entry.id);
  const home = divisionForRole(input.role);
  if (input.allowedDivisions != null) {
    const allowed = new Set(input.allowedDivisions);
    const list = catalog.filter((id) => allowed.has(id));
    if (!list.includes(home)) list.unshift(home);
    return list;
  }
  if (canSwitchDivision(input.role)) return [...catalog];
  return [home];
}

export function canOpenDivisions(input: {
  role: UserRole;
  allowedDivisions?: readonly Division[] | null;
}): boolean {
  return viewableDivisions(input).length > 1;
}

/**
 * Managers and IT admins grant an explicit division list.
 * The role's home division stays allowed.
 */
export function resolveAssignedDivisions(input: {
  role: UserRole;
  allowedDivisions: readonly Division[];
}): { ok: true; allowedDivisions: Division[] } | { ok: false; error: string } {
  const known = new Set(DIVISION_CATALOG.map((entry) => entry.id));
  if (input.allowedDivisions.some((id) => !known.has(id))) {
    return { ok: false, error: "That division is not available." };
  }
  const allowedDivisions = [
    ...new Set(input.allowedDivisions.filter((id) => known.has(id))),
  ];
  if (allowedDivisions.length === 0) {
    return { ok: false, error: "Allow at least one division." };
  }
  const home = divisionForRole(input.role);
  if (!allowedDivisions.includes(home)) {
    return { ok: false, error: "The home division must stay allowed." };
  }
  return { ok: true, allowedDivisions };
}

export function selectDivision(
  role: UserRole,
  requested: unknown,
  allowedDivisions?: readonly Division[] | null,
): Division {
  const visible = viewableDivisions({ role, allowedDivisions });
  if (
    visible.length > 1 &&
    (requested === "hyperscale" || requested === "security") &&
    visible.includes(requested)
  ) {
    return requested;
  }
  const home = divisionForRole(role);
  if (visible.includes(home)) return home;
  return visible[0] ?? home;
}

export function assignableRoles(role: UserRole): readonly UserRole[] {
  if (canSwitchDivision(role)) return USER_ROLES;
  if (role === "security-manager") {
    return USER_ROLES.filter((entry) => divisionForRole(entry) === "security");
  }
  if (role === "it-admin") {
    return USER_ROLES.filter((entry) => divisionForRole(entry) === divisionForRole(role));
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
  scoped.sites = inDivision(scoped.sites, division);
  scoped.buildings = inDivision(scoped.buildings, division);
  scoped.zones = inDivision(scoped.zones, division);
  scoped.aisles = inDivision(scoped.aisles, division);
  scoped.bays = inDivision(scoped.bays, division);
  scoped.trailers = inDivision(scoped.trailers, division);
  scoped.licensePlates = inDivision(scoped.licensePlates, division);
  scoped.containers = inDivision(scoped.containers, division);
  scoped.transactions = inDivision(scoped.transactions, division);
  scoped.photos = inDivision(scoped.photos, division);
  scoped.itemCubes = inDivision(scoped.itemCubes, division);
  scoped.siteTransfers = inDivision(scoped.siteTransfers, division);
  scoped.facilityTransfers = inDivision(scoped.facilityTransfers, division);
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
  full.sites = replaceDivision(full.sites, scoped.sites, division);
  full.buildings = replaceDivision(full.buildings, scoped.buildings, division);
  full.zones = replaceDivision(full.zones, scoped.zones, division);
  full.aisles = replaceDivision(full.aisles, scoped.aisles, division);
  full.bays = replaceDivision(full.bays, scoped.bays, division);
  full.trailers = replaceDivision(full.trailers, scoped.trailers, division);
  full.licensePlates = replaceDivision(full.licensePlates, scoped.licensePlates, division);
  if (scoped.licensePlateLedger) {
    full.licensePlateLedger = scoped.licensePlateLedger;
  }
  full.containers = replaceDivision(full.containers, scoped.containers, division);
  full.transactions = replaceDivision(full.transactions, scoped.transactions, division);
  full.photos = replaceDivision(full.photos, scoped.photos, division);
  full.itemCubes = replaceDivision(full.itemCubes, scoped.itemCubes, division);
  full.siteTransfers = replaceDivision(full.siteTransfers, scoped.siteTransfers, division);
  full.facilityTransfers = replaceDivision(
    full.facilityTransfers,
    scoped.facilityTransfers,
    division,
  );
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
