import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { InventorySystemSchema, type InventorySystem } from "@/lib/inventory-schema";
import {
  createSeedSystem,
  ensureDemoUsers,
  ensureSystemDefaults,
} from "@/backend/server/seed";
import { backfillUsernames } from "@/lib/auth/username";

export const JSON_DATA_DIR = path.join(process.cwd(), "data");
export const JSON_DATA_PATH = path.join(JSON_DATA_DIR, "inventory.json");

export async function persistToJson(system: InventorySystem): Promise<void> {
  await mkdir(JSON_DATA_DIR, { recursive: true });
  await writeFile(JSON_DATA_PATH, `${JSON.stringify(system, null, 2)}\n`, "utf8");
}

export async function readJsonFile(): Promise<InventorySystem | null> {
  try {
    const raw = await readFile(JSON_DATA_PATH, "utf8");
    const json = JSON.parse(raw) as { users?: unknown };
    if (Array.isArray(json.users)) {
      backfillUsernames(json.users as Array<Record<string, unknown>>);
    }
    return InventorySystemSchema.parse(json);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function readFromJson(): Promise<InventorySystem> {
  const existing = await readJsonFile();
  if (existing) {
    const hadDamagedHold = existing.locations.some(
      (location) => location.code === "DMG-01",
    );
    ensureSystemDefaults(existing);
    const seededUsers = await ensureDemoUsers(existing);
    if (!hadDamagedHold || seededUsers) {
      await persistToJson(existing);
    }
    return existing;
  }

  const seed = createSeedSystem();
  await ensureDemoUsers(seed);
  await persistToJson(seed);
  return seed;
}
