import { ensureDatabase, usesPostgres } from "@/backend/server/db";

async function main() {
  if (!usesPostgres()) {
    throw new Error("Set DATABASE_URL before running database migrations.");
  }
  await ensureDatabase();
  console.log("PostgreSQL schema is ready.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
