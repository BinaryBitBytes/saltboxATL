import { jsonError, jsonOk } from "@/backend/server/http";
import { ensureDatabase, getPool, usesPostgres } from "@/backend/server/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!usesPostgres()) {
      return jsonOk({
        ok: true,
        storage: "json-file",
        database: "not configured",
      });
    }
    await ensureDatabase();
    const result = await getPool().query<{ now: string }>("SELECT now()::text AS now");
    return jsonOk({
      ok: true,
      storage: "postgres",
      database: "connected",
      serverTime: result.rows[0]?.now,
    });
  } catch (error) {
    return jsonError(error);
  }
}
