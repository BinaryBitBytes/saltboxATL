import { describe, it } from "mocha";
import { expect } from "chai";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import {
  PERMISSIONS,
  canAccessPath,
  hasPermission,
  type Permission,
} from "@/lib/auth/permissions";
import { permissionForPhotoWrite } from "@/lib/photos/owner";
import {
  PHOTO_DOCUMENT_KINDS,
  USER_ROLES,
  type PhotoDocumentKind,
  type PhotoOwnerType,
  type UserRole,
} from "@/lib/inventory-schema";
import { SESSION_COOKIE, signSession, verifySessionToken } from "@/lib/auth/token";

/**
 * The scope each role is allowed to perform. A role that gains any permission
 * outside this list fails the suite.
 */
const SCOPE: Record<UserRole, readonly Permission[]> = {
  user: [
    "viewDashboard",
    "viewInventory",
    "viewTransactions",
    "placeOrder",
    "scanLookup",
  ],
  associate: [
    "viewDashboard",
    "viewInventory",
    "viewTransactions",
    "placeOrder",
    "fulfillOrder",
    "receive",
    "putaway",
    "cube",
    "ship",
    "scanLookup",
    "viewInboundForecast",
  ],
  threepl: [
    "viewDashboard",
    "viewInventory",
    "viewTransactions",
    "fulfillOrder",
    "receive",
    "putaway",
    "cube",
    "ship",
    "scanLookup",
    "viewInboundForecast",
  ],
  coordinator: ["viewDashboard", "uploadBuyerOrders", "viewInboundForecast"],
  "project-manager": [
    "viewDashboard",
    "viewInventory",
    "viewInboundForecast",
    "assignJobId",
  ],
  driver: ["viewDashboard", "viewDriverLoad", "confirmDelivery"],
  manager: [
    "viewDashboard",
    "viewInventory",
    "viewTransactions",
    "placeOrder",
    "fulfillOrder",
    "receive",
    "putaway",
    "cube",
    "ship",
    "scanLookup",
    "adjustInventory",
    "reopenReceiving",
    "manageLocations",
    "manageUsers",
    "uploadBuyerOrders",
    "viewInboundForecast",
    "assignJobId",
    "viewDriverLoad",
    "confirmDelivery",
  ],
};

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

const PAGE_RULES: Array<{
  path: string;
  permissions: readonly Permission[];
}> = [
  { path: "/", permissions: ["viewDashboard"] },
  { path: "/inventory", permissions: ["viewInventory"] },
  { path: "/reports", permissions: ["viewInventory"] },
  { path: "/reports/items", permissions: ["viewInventory"] },
  { path: "/cubing", permissions: ["cube"] },
  { path: "/transactions", permissions: ["viewTransactions"] },
  { path: "/logbook", permissions: ["viewTransactions"] },
  { path: "/receiving", permissions: ["receive"] },
  { path: `/receiving/${ORDER_ID}`, permissions: ["receive"] },
  { path: "/putaway", permissions: ["putaway"] },
  { path: `/putaway/${ORDER_ID}`, permissions: ["putaway"] },
  { path: "/inbound", permissions: ["viewInboundForecast"] },
  { path: "/loads", permissions: ["viewDriverLoad"] },
  { path: `/loads/${ORDER_ID}`, permissions: ["viewDriverLoad"] },
  { path: "/orders", permissions: ["placeOrder", "fulfillOrder"] },
  { path: `/orders/${ORDER_ID}`, permissions: ["placeOrder", "fulfillOrder"] },
  { path: "/orders/printer", permissions: ["fulfillOrder"] },
  { path: "/shipping", permissions: ["ship"] },
  { path: `/shipping/${ORDER_ID}`, permissions: ["ship"] },
  { path: "/locations", permissions: ["manageLocations"] },
  { path: "/users", permissions: ["manageUsers"] },
];

const API_RULES: Array<{
  method: string;
  path: string;
  permissions: readonly Permission[];
}> = [
  { method: "GET", path: "/api/users", permissions: ["manageUsers"] },
  { method: "POST", path: "/api/users", permissions: ["manageUsers"] },
  { method: "PATCH", path: "/api/users", permissions: ["manageUsers"] },
  { method: "GET", path: "/api/transactions", permissions: ["viewTransactions"] },
  { method: "GET", path: "/api/shipping", permissions: ["ship"] },
  { method: "POST", path: "/api/shipping", permissions: ["ship"] },
  { method: "GET", path: "/api/receiving", permissions: ["receive"] },
  { method: "POST", path: `/api/receiving/${ORDER_ID}`, permissions: ["receive"] },
  { method: "POST", path: `/api/putaway/${ORDER_ID}`, permissions: ["putaway"] },
  { method: "GET", path: "/api/inventory", permissions: ["viewInventory"] },
  { method: "POST", path: "/api/inventory", permissions: ["adjustInventory"] },
  { method: "POST", path: "/api/inventory/import", permissions: ["adjustInventory"] },
  { method: "GET", path: "/api/inventory/lookup", permissions: ["scanLookup"] },
  { method: "GET", path: "/api/inventory/export", permissions: ["viewInventory"] },
  { method: "GET", path: "/api/locations", permissions: ["viewInventory"] },
  { method: "POST", path: "/api/locations", permissions: ["manageLocations"] },
  { method: "GET", path: `/api/photos/${ORDER_ID}`, permissions: ["viewDashboard"] },
  {
    method: "POST",
    path: "/api/photos",
    permissions: ["receive", "ship", "adjustInventory", "confirmDelivery"],
  },
  {
    method: "DELETE",
    path: `/api/photos/${ORDER_ID}`,
    permissions: ["receive", "ship", "adjustInventory", "confirmDelivery"],
  },
];

function allowed(role: UserRole, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => SCOPE[role].includes(permission));
}

function sessionRequest(role: UserRole, path: string, method = "GET"): NextRequest {
  const token = signSession({
    id: "bbbb1111-1111-4111-8111-111111111111",
    email: "scope@saltbox.local",
    name: "Scope Test",
    role,
  });
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

describe("role permission scope", () => {
  it("classifies every role and every permission", () => {
    expect(Object.keys(SCOPE).sort()).to.deep.equal([...USER_ROLES].sort());
    const named = new Set(Object.values(SCOPE).flat());
    expect([...named].sort()).to.deep.equal(Object.keys(PERMISSIONS).sort());
  });

  it("grants each role only the permissions in its scope", () => {
    const permissions = Object.keys(PERMISSIONS) as Permission[];
    for (const role of USER_ROLES) {
      for (const permission of permissions) {
        expect(
          hasPermission(role, permission),
          `${role} / ${permission}`,
        ).to.equal(SCOPE[role].includes(permission));
      }
    }
  });

  it("keeps coordinator, project manager, driver, and 3PL inside their jobs", () => {
    expect(SCOPE.coordinator).to.deep.equal([
      "viewDashboard",
      "uploadBuyerOrders",
      "viewInboundForecast",
    ]);
    expect(SCOPE["project-manager"]).to.not.include("uploadBuyerOrders");
    expect(SCOPE["project-manager"]).to.not.include("receive");
    expect(SCOPE["project-manager"]).to.not.include("ship");
    expect(SCOPE["project-manager"]).to.include("assignJobId");
    expect(SCOPE["project-manager"]).to.include("viewInventory");
    expect(SCOPE.driver).to.deep.equal([
      "viewDashboard",
      "viewDriverLoad",
      "confirmDelivery",
    ]);
    expect(SCOPE.threepl).to.not.include("placeOrder");
    expect(SCOPE.threepl).to.not.include("adjustInventory");
    expect(SCOPE.threepl).to.not.include("uploadBuyerOrders");
    expect(SCOPE.threepl).to.not.include("assignJobId");
    expect(SCOPE.threepl).to.not.include("confirmDelivery");
    expect(SCOPE.threepl).to.not.include("manageUsers");
    expect(SCOPE.associate).to.not.include("assignJobId");
    expect(SCOPE.associate).to.not.include("uploadBuyerOrders");
    expect(SCOPE.user).to.not.include("receive");
    expect(SCOPE.user).to.not.include("ship");
    expect(SCOPE.user).to.not.include("confirmDelivery");
  });

  it("matches page access to that same scope, including nested records", () => {
    for (const role of USER_ROLES) {
      for (const rule of PAGE_RULES) {
        expect(canAccessPath(role, rule.path), `${role} GET ${rule.path}`).to.equal(
          allowed(role, rule.permissions),
        );
        expect(
          canAccessPath(role, `${rule.path}/`),
          `${role} trailing slash ${rule.path}`,
        ).to.equal(allowed(role, rule.permissions));
      }
    }
  });

  it("does not treat a different letter case as a different area", () => {
    expect(canAccessPath("coordinator", "/Users")).to.equal(false);
    expect(canAccessPath("driver", "/Inventory")).to.equal(false);
    expect(canAccessPath("user", "/Shipping")).to.equal(false);
    expect(canAccessPath("project-manager", "/Receiving")).to.equal(false);
    expect(canAccessPath("threepl", "/LOADS")).to.equal(false);
    expect(canAccessPath("coordinator", "/INBOUND")).to.equal(true);
    expect(canAccessPath("driver", "/Loads")).to.equal(true);
  });

  it("denies paths that are not part of any role's work", () => {
    for (const role of USER_ROLES) {
      expect(canAccessPath(role, "/admin"), role).to.equal(false);
      expect(canAccessPath(role, "/api/admin"), role).to.equal(false);
      expect(canAccessPath(role, "/settings"), role).to.equal(false);
    }
  });

  it("matches API reads and writes to the scope, not just the page", () => {
    for (const role of USER_ROLES) {
      for (const rule of API_RULES) {
        expect(
          canAccessPath(role, rule.path, rule.method),
          `${role} ${rule.method} ${rule.path}`,
        ).to.equal(allowed(role, rule.permissions));
      }
    }
    expect(canAccessPath("user", "/api/inventory", "POST")).to.equal(false);
    expect(canAccessPath("user", "/api/inventory", "GET")).to.equal(true);
    expect(canAccessPath("associate", "/api/inventory", "POST")).to.equal(false);
    expect(canAccessPath("project-manager", "/api/inventory", "GET")).to.equal(true);
    expect(canAccessPath("project-manager", "/api/inventory", "POST")).to.equal(false);
    expect(canAccessPath("coordinator", "/api/inventory", "GET")).to.equal(false);
    expect(canAccessPath("driver", "/api/shipping", "POST")).to.equal(false);
    expect(canAccessPath("driver", "/api/photos", "POST")).to.equal(true);
    expect(canAccessPath("coordinator", "/api/photos", "POST")).to.equal(false);
    expect(canAccessPath("threepl", "/api/locations", "POST")).to.equal(false);
    expect(canAccessPath("threepl", "/api/locations", "GET")).to.equal(true);
  });

  it("lets a driver upload only proof of delivery, and blocks planning roles from photos", () => {
    const writes: Array<{
      owner: PhotoOwnerType;
      kind: PhotoDocumentKind;
      permission: Permission;
    }> = [
      { owner: "receiving-order", kind: "freight-proof", permission: "receive" },
      { owner: "receiving-order", kind: "manifest", permission: "receive" },
      { owner: "shipping-order", kind: "freight-proof", permission: "ship" },
      { owner: "shipping-order", kind: "manifest", permission: "ship" },
      { owner: "shipping-order", kind: "load-sheet", permission: "ship" },
      { owner: "shipping-order", kind: "pack-slip", permission: "ship" },
      { owner: "shipping-order", kind: "proof-of-delivery", permission: "confirmDelivery" },
      { owner: "adjustment", kind: "freight-proof", permission: "adjustInventory" },
    ];

    for (const write of writes) {
      expect(permissionForPhotoWrite(write.owner, write.kind)).to.equal(write.permission);
    }
    expect(PHOTO_DOCUMENT_KINDS).to.include("proof-of-delivery");

    for (const kind of PHOTO_DOCUMENT_KINDS) {
      const shippingPermission = permissionForPhotoWrite("shipping-order", kind);
      expect(hasPermission("driver", shippingPermission), kind).to.equal(
        kind === "proof-of-delivery",
      );
      expect(hasPermission("coordinator", shippingPermission), kind).to.equal(false);
      expect(hasPermission("project-manager", shippingPermission), kind).to.equal(false);
      expect(hasPermission("user", shippingPermission), kind).to.equal(false);
    }
    expect(hasPermission("threepl", permissionForPhotoWrite("shipping-order", "proof-of-delivery"))).to.equal(
      false,
    );
    expect(hasPermission("threepl", permissionForPhotoWrite("adjustment"))).to.equal(false);
    expect(hasPermission("associate", permissionForPhotoWrite("adjustment"))).to.equal(false);
    expect(hasPermission("manager", permissionForPhotoWrite("shipping-order", "proof-of-delivery"))).to.equal(
      true,
    );
  });

  it("enforces the scope at the request gate", async () => {
    for (const role of USER_ROLES) {
      for (const rule of PAGE_RULES) {
        const response = proxy(sessionRequest(role, rule.path));
        const open = allowed(role, rule.permissions);
        if (open) {
          expect(response.status, `${role} ${rule.path}`).to.equal(200);
        } else {
          expect(response.status, `${role} ${rule.path}`).to.equal(307);
          const location = response.headers.get("location");
          expect(location, `${role} ${rule.path}`).to.not.equal(null);
          expect(new URL(location ?? "").pathname, `${role} ${rule.path}`).to.equal("/");
        }
      }
      for (const rule of API_RULES) {
        const response = proxy(sessionRequest(role, rule.path, rule.method));
        const open = allowed(role, rule.permissions);
        expect(response.status, `${role} ${rule.method} ${rule.path}`).to.equal(
          open ? 200 : 403,
        );
        if (!open) {
          const body = (await response.json()) as { success?: boolean; error?: string };
          expect(body.success, `${role} ${rule.path}`).to.equal(false);
        }
      }
    }
  });

  it("rejects a signed session whose role is outside the known set", () => {
    const token = signSession({
      id: "bbbb1111-1111-4111-8111-111111111111",
      email: "scope@saltbox.local",
      name: "Scope Test",
      role: "owner" as UserRole,
    });
    expect(verifySessionToken(token)).to.equal(null);
    const request = new NextRequest("http://localhost/users", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const response = proxy(request);
    expect(response.status).to.equal(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).to.equal("/login");
  });

  it("still leaves public health and login outside the role gate", () => {
    const health = proxy(new NextRequest("http://localhost/api/health"));
    const login = proxy(new NextRequest("http://localhost/login"));
    expect(health.status).to.equal(200);
    expect(login.status).to.equal(200);
  });
});
