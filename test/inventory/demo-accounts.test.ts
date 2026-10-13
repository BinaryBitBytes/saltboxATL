import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/auth/demo-accounts";
import { verifyPassword } from "@/lib/auth/password";
import {
  ensureDemoUsers,
  resetDemoPasswordCheckForTests,
} from "@/backend/server/seed";
import type { InventorySystem } from "@/lib/inventory-schema";

function emptySystem(): InventorySystem {
  return { users: [] } as unknown as InventorySystem;
}

describe("demo account seeding", () => {
  beforeEach(() => {
    resetDemoPasswordCheckForTests();
  });

  it("creates every published login, including the new roles", async () => {
    const system = emptySystem();
    const changed = await ensureDemoUsers(system);
    expect(changed).to.equal(true);
    expect(system.users.map((user) => user.role).sort()).to.deep.equal(
      DEMO_ACCOUNTS.map((account) => account.role).sort(),
    );
    for (const account of DEMO_ACCOUNTS) {
      const user = system.users.find((entry) => entry.email === account.email);
      expect(user?.username, account.email).to.equal(account.username);
      expect(user?.isActive).to.equal(true);
      expect(await verifyPassword(DEMO_PASSWORD, user?.passwordHash ?? "")).to.equal(
        true,
      );
    }
  });

  it("repairs a demo account whose password no longer matches the published one", async () => {
    const system = emptySystem();
    await ensureDemoUsers(system);
    const coordinator = system.users.find(
      (user) => user.email === "coordinator@saltbox.local",
    );
    expect(coordinator).to.not.equal(undefined);
    coordinator!.passwordHash = "scrypt:not-a-real-salt:not-a-real-hash";
    resetDemoPasswordCheckForTests();
    const changed = await ensureDemoUsers(system);
    expect(changed).to.equal(true);
    expect(await verifyPassword(DEMO_PASSWORD, coordinator!.passwordHash)).to.equal(
      true,
    );
  });
});
