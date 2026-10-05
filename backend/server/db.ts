import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

const MIGRATIONS = [
  { id: "001_init", file: "schema.sql" },
  { id: "002_inventory_attributes", file: "002_inventory_attributes.sql" },
] as const;

let pool: Pool | undefined;
let migrated = false;

export function databaseUrl(): string | undefined {
  const value = process.env.DATABASE_URL?.trim();
  return value || undefined;
}

export function usesPostgres(): boolean {
  return Boolean(databaseUrl());
}

export function getPool(): Pool {
  const url = databaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 10,
    });
  }
  return pool;
}

function migrationSql(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "backend/db", file), "utf8");
}

export async function ensureDatabase(): Promise<void> {
  if (!usesPostgres() || migrated) return;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    for (const migration of MIGRATIONS) {
      const applied = await client.query<{ id: string }>(
        "SELECT id FROM schema_migrations WHERE id = $1",
        [migration.id],
      );
      if ((applied.rowCount ?? 0) > 0) continue;
      await client.query(migrationSql(migration.file));
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [
        migration.id,
      ]);
    }
    await client.query("COMMIT");
    migrated = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withInventoryLock<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1396789332)");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
