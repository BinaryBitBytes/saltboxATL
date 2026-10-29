import { usesPostgres } from "@/backend/server/db";
import { readAccountRecords } from "@/backend/server/pg-store";
import { readAccountCatalog } from "@/backend/server/site-files";
import type { InventorySystem } from "@/lib/inventory-schema";

/**
 * Users live in the same store that `updateSystem` writes.
 * Postgres wins whenever DATABASE_URL is set; the JSON catalog is only the
 * fallback when the app is not using Postgres.
 * The Postgres path loads account rows only. Inventory, site transfers, and
 * site database payloads are not required to sign in or restore a session.
 */
export async function readAccountsFrom(
  postgres: boolean,
  readPostgres: () => Promise<InventorySystem>,
  readJson: () => Promise<InventorySystem>,
): Promise<InventorySystem> {
  return postgres ? readPostgres() : readJson();
}

export async function readAccounts(): Promise<InventorySystem> {
  return readAccountsFrom(usesPostgres(), readAccountRecords, readAccountCatalog);
}
