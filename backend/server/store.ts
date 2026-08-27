import { connection } from "next/server";
import { InventorySystemSchema, type InventorySystem } from "@/lib/inventory-schema";
import { usesPostgres } from "@/backend/server/db";
import { readFromPostgres, updatePostgres } from "@/backend/server/pg-store";
import { persistToJson, readFromJson } from "@/backend/server/json-store";

let writeChain: Promise<unknown> = Promise.resolve();

async function readFromStore(): Promise<InventorySystem> {
  if (usesPostgres()) {
    return readFromPostgres();
  }
  return readFromJson();
}

export async function getSystem(): Promise<InventorySystem> {
  await connection();
  return readFromStore();
}

export async function readSystem(): Promise<InventorySystem> {
  return readFromStore();
}

export async function updateSystem<T>(
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  if (usesPostgres()) {
    return updatePostgres(mutator);
  }

  const run = async () => {
    const system = await readFromJson();
    const result = await mutator(system);
    await persistToJson(InventorySystemSchema.parse(system));
    return result;
  };

  const pending = writeChain.then(run, run);
  writeChain = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}
