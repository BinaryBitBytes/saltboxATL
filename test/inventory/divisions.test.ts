import { describe, it } from "mocha";
import { expect } from "chai";
import { createSeedSystem, ensureDemoUsers } from "@/backend/server/seed";
import {
  assignableRoles,
  canAssignDivisions,
  canAssignRole,
  canManageUser,
  canOpenDivisions,
  canSwitchDivision,
  divisionForRole,
  divisionLabel,
  mergeDivision,
  resolveAssignedDivisions,
  scopeSystem,
  selectDivision,
  viewableDivisions,
} from "@/lib/divisions";
import type { InventorySystem } from "@/lib/inventory-schema";
import { makeUser } from "../helpers";

describe("division inventory", () => {
  it("names Division_1 Hyperscale and Division_2 Security", () => {
    expect(divisionLabel("hyperscale")).to.equal("Division_1: Hyperscale");
    expect(divisionLabel("security")).to.equal("Division_2: Security");
  });

  it("keeps existing roles in Hyperscale and the new roles in Security", () => {
    expect(divisionForRole("associate")).to.equal("hyperscale");
    expect(divisionForRole("manager")).to.equal("hyperscale");
    expect(divisionForRole("security-associate")).to.equal("security");
    expect(divisionForRole("security-manager")).to.equal("security");
  });

  it("lets only the existing manager switch divisions", () => {
    expect(canSwitchDivision("manager")).to.equal(true);
    expect(canSwitchDivision("security-manager")).to.equal(false);
    expect(canSwitchDivision("associate")).to.equal(false);
    expect(canSwitchDivision("security-associate")).to.equal(false);
    expect(selectDivision("manager", "security")).to.equal("security");
    expect(selectDivision("manager", "hyperscale")).to.equal("hyperscale");
    expect(selectDivision("manager", "nope")).to.equal("hyperscale");
    expect(selectDivision("security-associate", "hyperscale")).to.equal("security");
    expect(selectDivision("associate", "security")).to.equal("hyperscale");
    expect(selectDivision("security-manager", "hyperscale")).to.equal("security");
  });

  it("lets managers and IT admins grant another division", () => {
    expect(canAssignDivisions("manager")).to.equal(true);
    expect(canAssignDivisions("it-admin")).to.equal(true);
    expect(canAssignDivisions("security-manager")).to.equal(false);
    expect(canAssignDivisions("associate")).to.equal(false);

    const granted = resolveAssignedDivisions({
      role: "associate",
      allowedDivisions: ["hyperscale", "security"],
    });
    expect(granted).to.deep.equal({
      ok: true,
      allowedDivisions: ["hyperscale", "security"],
    });
    expect(
      selectDivision("associate", "security", ["hyperscale", "security"]),
    ).to.equal("security");
    expect(
      canOpenDivisions({
        role: "associate",
        allowedDivisions: ["hyperscale", "security"],
      }),
    ).to.equal(true);
    expect(selectDivision("associate", "security")).to.equal("hyperscale");
    expect(
      selectDivision("it-admin", "security", ["hyperscale", "security"]),
    ).to.equal("security");
    expect(viewableDivisions({ role: "manager" })).to.deep.equal([
      "hyperscale",
      "security",
    ]);
    expect(viewableDivisions({ role: "associate" })).to.deep.equal(["hyperscale"]);
    expect(
      viewableDivisions({
        role: "security-associate",
        allowedDivisions: ["security", "hyperscale"],
      }),
    ).to.deep.equal(["hyperscale", "security"]);

    expect(
      resolveAssignedDivisions({
        role: "associate",
        allowedDivisions: ["security"],
      }),
    ).to.deep.equal({
      ok: false,
      error: "The home division must stay allowed.",
    });
    expect(
      resolveAssignedDivisions({
        role: "associate",
        allowedDivisions: [],
      }),
    ).to.deep.equal({
      ok: false,
      error: "Allow at least one division.",
    });
  });

  it("limits who can assign roles across divisions", () => {
    expect(canAssignRole("manager", "security-associate")).to.equal(true);
    expect(canAssignRole("manager", "associate")).to.equal(true);
    expect(assignableRoles("security-manager")).to.deep.equal([
      "security-associate",
      "security-manager",
    ]);
    expect(canAssignRole("security-manager", "associate")).to.equal(false);
    expect(canAssignRole("security-associate", "security-associate")).to.equal(false);
    expect(canManageUser("security-manager", "security-associate")).to.equal(true);
    expect(canManageUser("security-manager", "manager")).to.equal(false);
    expect(canManageUser("manager", "security-manager")).to.equal(true);
  });

  it("seeds a separate Security inventory beside Hyperscale", () => {
    const seed = createSeedSystem();
    const hyperscaleSkus = seed.inventoryItems
      .filter((item) => item.division === "hyperscale")
      .map((item) => item.sku);
    const securitySkus = seed.inventoryItems
      .filter((item) => item.division === "security")
      .map((item) => item.sku);
    expect(hyperscaleSkus).to.include("FBR-LC-12-100");
    expect(hyperscaleSkus).to.not.include("SEC-CAM-01");
    expect(securitySkus).to.deep.equal(["SEC-CAM-01"]);
    expect(seed.rooms.some((room) => room.name === "Security Cage" && room.division === "security"))
      .to.equal(true);
    expect(seed.locations.some((location) => location.code === "SEC-A1" && location.division === "security"))
      .to.equal(true);
  });

  it("hides the other division and does not delete it on save", () => {
    const full = createSeedSystem();
    full.users = [
      makeUser({ role: "manager", email: "manager@saltbox.local", username: "manager" }),
      makeUser({
        role: "security-associate",
        email: "security@saltbox.local",
        username: "security",
        name: "Quinn Security",
      }),
    ];
    const security = scopeSystem(full, "security");
    expect(security.inventoryItems.map((item) => item.sku)).to.deep.equal(["SEC-CAM-01"]);
    expect(security.locations.map((location) => location.code)).to.deep.equal([
      "SEC-A1",
      "SEC-HOLD",
      "SIERRA-001-A01-01-A01",
    ]);
    expect(security.rooms.map((room) => room.name)).to.deep.equal([
      "Security Cage",
      "SIERRA-001",
    ]);
    expect(security.users.map((user) => user.role).sort()).to.deep.equal([
      "manager",
      "security-associate",
    ]);

    security.inventoryItems = [];
    security.rooms = [];
    security.locations = [];
    mergeDivision(full, security, "security");

    expect(full.inventoryItems.map((item) => item.sku)).to.include("FBR-LC-12-100");
    expect(full.inventoryItems.map((item) => item.sku)).to.not.include("SEC-CAM-01");
    expect(full.rooms.some((room) => room.name === "Receiving Dock")).to.equal(true);
    expect(full.rooms.some((room) => room.name === "Security Cage")).to.equal(false);
    expect(full.users.find((user) => user.role === "security-associate")?.division).to.equal(
      "security",
    );
    expect(full.users.find((user) => user.role === "manager")?.division).to.equal(
      "hyperscale",
    );
  });

  it("stamps new rows into the division being edited", () => {
    const full = createSeedSystem();
    const hyperscale = scopeSystem(full, "hyperscale");
    const added = hyperscale.inventoryItems[0];
    expect(added).to.not.equal(undefined);
    hyperscale.inventoryItems.push({
      ...added!,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sku: "NEW-HS-1",
      division: undefined,
    });
    mergeDivision(full, hyperscale, "hyperscale");
    const created = full.inventoryItems.find((item) => item.sku === "NEW-HS-1");
    expect(created?.division).to.equal("hyperscale");
    expect(full.inventoryItems.some((item) => item.sku === "SEC-CAM-01")).to.equal(true);
  });

  it("stores each demo login in the division for its role", async () => {
    const system = { users: [] } as unknown as InventorySystem;
    await ensureDemoUsers(system);
    const security = system.users.find((user) => user.role === "security-associate");
    const manager = system.users.find((user) => user.role === "manager");
    expect(security?.division).to.equal("security");
    expect(manager?.division).to.equal("hyperscale");
    expect(system.users.filter((user) => user.division === "security")).to.have.length(2);
  });
});
