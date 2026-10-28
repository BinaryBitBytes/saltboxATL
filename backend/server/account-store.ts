import { usesPostgres } from "@/backend/server/db";
import { readFromPostgres } from "@/backend/server/pg-store";
import { readAccountCatalog } from "@/backend/server/site-files";
import type { InventorySystem } from "@/lib/inventory-schema";

/**
 * Users live in the same store that `updateSystem` writes.
 * Postgres wins whenever DATABASE_URL is set; the JSON catalog is only the
 * fallback when the app is not using Postgres.
 */
export async function readAccountsFrom(
  postgres: boolean,
  readPostgres: () => Promise<InventorySystem>,
  readJson: () => Promise<InventorySystem>,
): Promise<InventorySystem> {
  return postgres ? readPostgres() : readJson();
}

export async function readAccounts(): Promise<InventorySystem> {
  return readAccountsFrom(usesPostgres(), readFromPostgres, readAccountCatalog);
}
