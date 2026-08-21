import type { UserRole } from "@/lib/inventory-schema";

export const PERMISSIONS = {
  viewDashboard: ["user", "associate", "manager"],
  viewInventory: ["user", "associate", "manager"],
  viewTransactions: ["user", "associate", "manager"],
  receive: ["associate", "manager"],
  putaway: ["associate", "manager"],
  ship: ["associate", "manager"],
  scanLookup: ["user", "associate", "manager"],
  adjustInventory: ["manager"],
  manageLocations: ["manager"],
  manageUsers: ["manager"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

export function canAccessPath(role: UserRole, pathname: string): boolean {
  if (pathname === "/" || pathname === "") {
    return hasPermission(role, "viewDashboard");
  }
  if (pathname.startsWith("/inventory") || pathname.startsWith("/reports")) {
    return hasPermission(role, "viewInventory");
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

export function roleLabel(role: UserRole): string {
  if (role === "manager") return "Manager";
  if (role === "associate") return "Associate";
  return "User";
}
