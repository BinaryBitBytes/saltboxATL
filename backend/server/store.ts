import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { InventorySystemSchema, type InventorySystem } from "@/lib/inventory-schema";
import {
  createSeedSystem,
  ensureDemoUsers,
  ensureSystemDefaults,
} from "@/backend/server/seed";
import { backfillUsernames } from "@/lib/auth/username";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_PATH = path.join(DATA_DIR, "inventory.json");

let writeChain: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<InventorySystem> {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    const json = JSON.parse(raw) as { users?: unknown };
    const usernamesChanged = Array.isArray(json.users)
      ? backfillUsernames(json.users as Array<Record<string, unknown>>)
      : false;
    const parsed = InventorySystemSchema.parse(json);
    const hadDamagedHold = parsed.locations.some(
      (location) => location.code === "DMG-01",
    );
    ensureSystemDefaults(parsed);
    const seededUsers = await ensureDemoUsers(parsed);
    if (!hadDamagedHold || seededUsers || usernamesChanged) {
      await persist(parsed);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const seed = createSeedSystem();
      await ensureDemoUsers(seed);
      await persist(seed);
      return seed;
    }
    throw error;
  }
}

async function persist(system: InventorySystem): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_PATH, `${JSON.stringify(system, null, 2)}\n`, "utf8");
}

export async function getSystem(): Promise<InventorySystem> {
  await connection();
  return readFromDisk();
}

export async function readSystem(): Promise<InventorySystem> {
  return readFromDisk();
}

export async function updateSystem<T>(
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  const run = async () => {
    const system = await readFromDisk();
    const result = await mutator(system);
    await persist(InventorySystemSchema.parse(system));
    return result;
  };

  const pending = writeChain.then(run, run);
  writeChain = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}
