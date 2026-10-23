import type { UserRole } from "@/lib/inventory-schema";

const SECURITY_ROLE: Partial<Record<UserRole, UserRole>> = {
  associate: "security-associate",
  manager: "security-manager",
};

/** Security associate and security manager mirror the Hyperscale roles they copy. */
function withSecurityRoles(roles: readonly UserRole[]): UserRole[] {
  return [
    ...roles,
    ...roles.flatMap((role) => {
      const securityRole = SECURITY_ROLE[role];
      return securityRole ? [securityRole] : [];
    }),
  ];
}

export const PERMISSIONS = {
  viewDashboard: withSecurityRoles([
    "user",
    "associate",
    "threepl",
    "coordinator",
    "project-manager",
    "driver",
    "manager",
  ]),
  viewInventory: withSecurityRoles([
    "user",
    "associate",
    "threepl",
    "project-manager",
    "manager",
  ]),
  viewTransactions: withSecurityRoles(["user", "associate", "threepl", "manager"]),
  placeOrder: withSecurityRoles(["user", "associate", "manager"]),
  fulfillOrder: withSecurityRoles(["associate", "threepl", "manager"]),
  receive: withSecurityRoles(["associate", "threepl", "manager"]),
  putaway: withSecurityRoles(["associate", "threepl", "manager"]),
  moveInventory: withSecurityRoles(["associate", "manager"]),
  cube: withSecurityRoles(["associate", "threepl", "manager"]),
  ship: withSecurityRoles(["associate", "threepl", "manager"]),
  scanLookup: withSecurityRoles(["user", "associate", "threepl", "manager"]),
  adjustInventory: withSecurityRoles(["manager"]),
  reopenReceiving: withSecurityRoles(["manager"]),
  manageLocations: withSecurityRoles(["manager"]),
  manageUsers: withSecurityRoles(["manager"]),
  uploadBuyerOrders: withSecurityRoles(["coordinator", "manager"]),
  viewInboundForecast: withSecurityRoles([
    "coordinator",
    "project-manager",
    "associate",
    "threepl",
    "manager",
  ]),
  assignJobId: withSecurityRoles(["project-manager", "manager"]),
  viewPurchaseDocuments: withSecurityRoles([
    "coordinator",
    "project-manager",
    "manager",
  ]),
  viewDriverLoad: withSecurityRoles(["driver", "manager"]),
  confirmDelivery: withSecurityRoles(["driver", "manager"]),
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

export function hasAnyPermission(
  role: UserRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  const trimmed =
    withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
  return (trimmed || "/").toLowerCase();
}

function isRead(method: string): boolean {
  const verb = method.toUpperCase();
  return verb === "GET" || verb === "HEAD";
}

/**
 * Page and API authorization. Unlisted paths are denied so a new route cannot
 * become available to every signed-in role by accident.
 * Write methods on an API are checked separately when reading and writing
 * require different permissions.
 */
export function canAccessPath(
  role: UserRole,
  pathname: string,
  method = "GET",
): boolean {
  const path = normalizePath(pathname);

  if (path === "/" || path === "") {
    return hasPermission(role, "viewDashboard");
  }
  if (path === "/inventory" || path.startsWith("/inventory/") || path === "/reports" || path.startsWith("/reports/")) {
    return hasPermission(role, "viewInventory");
  }
  if (path === "/cubing" || path.startsWith("/cubing/")) {
    return hasPermission(role, "cube");
  }
  if (
    path === "/transactions" ||
    path.startsWith("/transactions/") ||
    path === "/logbook" ||
    path.startsWith("/logbook/")
  ) {
    return hasPermission(role, "viewTransactions");
  }
  if (path === "/receiving" || path.startsWith("/receiving/")) {
    return hasPermission(role, "receive");
  }
  if (path === "/putaway" || path.startsWith("/putaway/")) {
    return hasPermission(role, "putaway");
  }
  if (path === "/moves" || path.startsWith("/moves/")) {
    return hasPermission(role, "moveInventory");
  }
  if (path === "/inbound" || path.startsWith("/inbound/")) {
    return hasPermission(role, "viewInboundForecast");
  }
  if (path === "/loads" || path.startsWith("/loads/")) {
    return hasPermission(role, "viewDriverLoad");
  }
  if (path === "/orders/printer" || path.startsWith("/orders/printer/")) {
    return hasPermission(role, "fulfillOrder");
  }
  if (path === "/orders" || path.startsWith("/orders/")) {
    return hasAnyPermission(role, ["placeOrder", "fulfillOrder"]);
  }
  if (path === "/shipping" || path.startsWith("/shipping/")) {
    return hasPermission(role, "ship");
  }
  if (path === "/locations" || path.startsWith("/locations/")) {
    return hasPermission(role, "manageLocations");
  }
  if (path === "/users" || path.startsWith("/users/")) {
    return hasPermission(role, "manageUsers");
  }

  if (path === "/api/auth/me") {
    return hasPermission(role, "viewDashboard");
  }
  if (path === "/api/users" || path.startsWith("/api/users/")) {
    return hasPermission(role, "manageUsers");
  }
  if (path === "/api/transactions" || path.startsWith("/api/transactions/")) {
    return hasPermission(role, "viewTransactions");
  }
  if (path === "/api/shipping" || path.startsWith("/api/shipping/")) {
    return hasPermission(role, "ship");
  }
  if (path === "/api/receiving" || path.startsWith("/api/receiving/")) {
    return hasPermission(role, "receive");
  }
  if (path === "/api/putaway" || path.startsWith("/api/putaway/")) {
    return hasPermission(role, "putaway");
  }
  if (path === "/api/moves" || path.startsWith("/api/moves/")) {
    return hasPermission(role, "moveInventory");
  }
  if (path === "/api/inventory/import" || path.startsWith("/api/inventory/import/")) {
    return hasPermission(role, "adjustInventory");
  }
  if (path === "/api/inventory/lookup" || path.startsWith("/api/inventory/lookup/")) {
    return hasPermission(role, "scanLookup");
  }
  if (path === "/api/inventory/export" || path.startsWith("/api/inventory/export/")) {
    return hasPermission(role, "viewInventory");
  }
  if (path === "/api/inventory" || path.startsWith("/api/inventory/")) {
    return hasPermission(role, isRead(method) ? "viewInventory" : "adjustInventory");
  }
  if (path === "/api/locations" || path.startsWith("/api/locations/")) {
    return hasPermission(role, isRead(method) ? "viewInventory" : "manageLocations");
  }
  if (path === "/api/photos" || path.startsWith("/api/photos/")) {
    if (isRead(method)) return hasPermission(role, "viewDashboard");
    return hasAnyPermission(role, [
      "receive",
      "ship",
      "adjustInventory",
      "confirmDelivery",
    ]);
  }
  if (
    path === "/api/purchase-documents" ||
    path.startsWith("/api/purchase-documents/")
  ) {
    if (isRead(method)) return hasPermission(role, "viewPurchaseDocuments");
    return hasPermission(role, "uploadBuyerOrders");
  }

  return false;
}

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  if (value.startsWith("/login") || value.startsWith("/api/")) {
    return "/";
  }
  return value;
}

const ROLE_LABELS: Record<UserRole, string> = {
  user: "User",
  associate: "Associate",
  manager: "Manager",
  coordinator: "Coordinator",
  threepl: "3PL",
  "project-manager": "Project Manager",
  driver: "Driver",
  "security-associate": "Security Associate",
  "security-manager": "Security Manager",
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}
