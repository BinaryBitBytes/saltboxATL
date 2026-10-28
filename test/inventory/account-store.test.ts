import fs from "node:fs";
import path from "node:path";
import { describe, it } from "mocha";
import { expect } from "chai";
import { readAccountsFrom } from "@/backend/server/account-store";
import {
  ACCOUNT_SITE_QUERY,
  ACCOUNT_USER_QUERY,
} from "@/backend/server/pg-store";
import { restoreSessionAccount } from "@/lib/auth/session-account";
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

  it("restores a signed-in account without throwing when the store fails", async () => {
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const missingColumn = await restoreSessionAccount("pg-user", async () => {
        throw new Error('column "ordered_at" does not exist');
      });
      const badPayload = await restoreSessionAccount("pg-user", async () => {
        throw new Error("Invalid site database payload");
      });
      const outage = await restoreSessionAccount("pg-user", async () => {
        throw new Error("connect ECONNREFUSED");
      });
      expect(missingColumn).to.equal(null);
      expect(badPayload).to.equal(null);
      expect(outage).to.equal(null);
      expect(logged).to.have.length(3);
    } finally {
      console.error = original;
    }
  });

  it("returns the public account when the store can be read, and drops inactive users", async () => {
    const id = "bbbb1111-1111-4111-8111-111111111111";
    const active = await restoreSessionAccount(id, async () =>
      accountSystem({
        id,
        email: "active@saltbox.local",
        role: "project-manager",
        isActive: true,
      }),
    );
    expect(active?.email).to.equal("active@saltbox.local");
    expect(active?.role).to.equal("project-manager");
    expect(active && "passwordHash" in active).to.equal(false);

    const inactive = await restoreSessionAccount(id, async () =>
      accountSystem({
        id,
        email: "inactive@saltbox.local",
        role: "user",
        isActive: false,
      }),
    );
    expect(inactive).to.equal(null);
  });

  it("loads Postgres accounts without site transfers or site database payloads", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "backend/server/pg-store.ts"),
      "utf8",
    );
    const accountReader = source.slice(
      source.indexOf("export async function readAccountRecords"),
      source.indexOf("export async function readFromPostgres"),
    );
    expect(accountReader).to.include("ACCOUNT_USER_QUERY");
    expect(accountReader).to.include("ACCOUNT_SITE_QUERY");
    expect(accountReader).to.not.include("site_transfers");
    expect(accountReader).to.not.include("site_databases");
    expect(ACCOUNT_USER_QUERY).to.not.include("ordered_at");
    expect(ACCOUNT_SITE_QUERY).to.not.include("payload");

    const accounts = fs.readFileSync(
      path.join(process.cwd(), "backend/server/account-store.ts"),
      "utf8",
    );
    expect(accounts).to.include("readAccountRecords");
    expect(accounts).to.not.include("readFromPostgres");

    const session = fs.readFileSync(
      path.join(process.cwd(), "backend/server/dal.ts"),
      "utf8",
    );
    expect(session).to.include("restoreSessionAccount(payload.sub, readAccounts)");
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
    expect(auth).to.include("sitesForAssignment");
    expect(auth.match(/readAccounts\(/g)?.length).to.equal(5);
    expect(session).to.include("restoreSessionAccount(payload.sub, readAccounts)");
  });
});
