import fs from "node:fs";
import path from "node:path";
import { describe, it } from "mocha";
import { expect } from "chai";
import { readAccountsFrom } from "@/backend/server/account-store";
import type { InventorySystem, User } from "@/lib/inventory-schema";

function accountSystem(user: Pick<User, "id" | "email" | "role" | "isActive">): InventorySystem {
  return {
    users: [
      {
        id: user.id,
        name: "Account",
        username: user.email.split("@")[0] ?? "account",
        email: user.email,
        passwordHash: "scrypt:test",
        role: user.role,
        isActive: user.isActive,
      },
    ],
  } as InventorySystem;
}

describe("account reads follow the store that saves users", () => {
  it("uses Postgres users when DATABASE_URL is the active store", async () => {
    const postgres = accountSystem({
      id: "pg-user",
      email: "created-in-postgres@saltbox.local",
      role: "it-admin",
      isActive: false,
    });
    const json = accountSystem({
      id: "json-user",
      email: "stale-json@saltbox.local",
      role: "user",
      isActive: true,
    });
    let jsonReads = 0;
    const loaded = await readAccountsFrom(
      true,
      async () => postgres,
      async () => {
        jsonReads += 1;
        return json;
      },
    );
    expect(jsonReads).to.equal(0);
    expect(loaded.users.map((user) => user.email)).to.deep.equal([
      "created-in-postgres@saltbox.local",
    ]);
    expect(loaded.users[0]?.role).to.equal("it-admin");
    expect(loaded.users[0]?.isActive).to.equal(false);
  });

  it("uses the JSON catalog only when Postgres is not configured", async () => {
    const json = accountSystem({
      id: "json-user",
      email: "json-only@saltbox.local",
      role: "user",
      isActive: true,
    });
    let postgresReads = 0;
    const loaded = await readAccountsFrom(
      false,
      async () => {
        postgresReads += 1;
        return accountSystem({
          id: "pg-user",
          email: "postgres@saltbox.local",
          role: "manager",
          isActive: true,
        });
      },
      async () => json,
    );
    expect(postgresReads).to.equal(0);
    expect(loaded.users.map((user) => user.email)).to.deep.equal(["json-only@saltbox.local"]);
  });

  it("keeps login, session restore, and the user list off the JSON catalog", () => {
    const auth = fs.readFileSync(
      path.join(process.cwd(), "backend/server/auth-service.ts"),
      "utf8",
    );
    const session = fs.readFileSync(
      path.join(process.cwd(), "backend/server/dal.ts"),
      "utf8",
    );
    expect(auth).to.not.include("readAccountCatalog");
    expect(session).to.not.include("readAccountCatalog");
    expect(auth.match(/readAccounts\(/g)?.length).to.equal(4);
    expect(session).to.include("readAccounts()");
  });
});
