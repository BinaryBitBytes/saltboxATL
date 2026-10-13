import type { UserRole } from "@/lib/inventory-schema";

export const PERMISSIONS = {
  viewDashboard: [
    "user",
    "associate",
    "threepl",
    "coordinator",
    "project-manager",
    "driver",
    "manager",
  ],
  viewInventory: ["user", "associate", "threepl", "project-manager", "manager"],
  viewTransactions: ["user", "associate", "threepl", "manager"],
  placeOrder: ["user", "associate", "manager"],
  fulfillOrder: ["associate", "threepl", "manager"],
  receive: ["associate", "threepl", "manager"],
  putaway: ["associate", "threepl", "manager"],
  cube: ["associate", "threepl", "manager"],
  ship: ["associate", "threepl", "manager"],
  scanLookup: ["user", "associate", "threepl", "manager"],
  adjustInventory: ["manager"],
  reopenReceiving: ["manager"],
  manageLocations: ["manager"],
  manageUsers: ["manager"],
  uploadBuyerOrders: ["coordinator", "manager"],
  viewInboundForecast: [
    "coordinator",
    "project-manager",
    "associate",
    "threepl",
    "manager",
  ],
  assignJobId: ["project-manager", "manager"],
  viewDriverLoad: ["driver", "manager"],
  confirmDelivery: ["driver", "manager"],
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

export function canAccessPath(role: UserRole, pathname: string): boolean {
  if (pathname === "/" || pathname === "") {
    return hasPermission(role, "viewDashboard");
  }
  if (pathname.startsWith("/inventory") || pathname.startsWith("/reports")) {
    return hasPermission(role, "viewInventory");
  }
  if (pathname.startsWith("/cubing")) {
    return hasPermission(role, "cube");
  }
  if (pathname.startsWith("/transactions") || pathname.startsWith("/logbook")) {
    return hasPermission(role, "viewTransactions");
  }
  if (pathname.startsWith("/receiving")) {
    return hasPermission(role, "receive");
  }
  if (pathname.startsWith("/putaway")) {
    return hasPermission(role, "putaway");
  }
  if (pathname.startsWith("/inbound")) {
    return hasPermission(role, "viewInboundForecast");
  }
  if (pathname.startsWith("/loads")) {
    return hasPermission(role, "viewDriverLoad");
  }
  if (pathname.startsWith("/orders/printer")) {
    return hasPermission(role, "fulfillOrder");
  }
  if (pathname.startsWith("/orders")) {
    return hasAnyPermission(role, ["placeOrder", "fulfillOrder"]);
  }
  if (pathname.startsWith("/shipping")) {
    return hasPermission(role, "ship");
  }
  if (pathname.startsWith("/locations")) {
    return hasPermission(role, "manageLocations");
  }
  if (pathname.startsWith("/users")) {
    return hasPermission(role, "manageUsers");
  }
  return true;
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
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}
