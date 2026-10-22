import { connection } from "next/server";
import { InventorySystemSchema, type InventorySystem } from "@/lib/inventory-schema";
import { usesPostgres } from "@/backend/server/db";
import { resolveViewerDivision } from "@/backend/server/division";
import { readFromPostgres, updatePostgres } from "@/backend/server/pg-store";
import { persistToJson, readFromJson } from "@/backend/server/json-store";
import {
  filterUsersForViewer,
  mergeDivision,
  scopeSystem,
} from "@/lib/divisions";
import {
  hydrateInventoryForDom,
  type DomSafeInventorySystem,
} from "@/lib/validation/dom-hydration";

let writeChain: Promise<unknown> = Promise.resolve();

async function readFromStore(): Promise<InventorySystem> {
  if (!usesPostgres()) return readFromJson();
  try {
    return await readFromPostgres();
  } catch (error) {
    console.error(
      "PostgreSQL is unavailable. Demo sign-in is using the local account file.",
      error,
    );
    return readFromJson();
  }
}

export async function readFullSystem(): Promise<InventorySystem> {
  return readFromStore();
}

async function readScopedSystem(): Promise<InventorySystem> {
  const viewer = await resolveViewerDivision();
  const full = await readFromStore();
  const scoped = scopeSystem(full, viewer.division);
  scoped.users = filterUsersForViewer(scoped.users, viewer.role);
  return scoped;
}

export async function getSystem(): Promise<DomSafeInventorySystem> {
  await connection();
  return hydrateInventoryForDom(await readScopedSystem());
}

export async function readSystem(): Promise<InventorySystem> {
  return readScopedSystem();
}

export async function updateSystem<T>(
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  const viewer = await resolveViewerDivision();
  const apply = async (full: InventorySystem) => {
    const scoped = scopeSystem(full, viewer.division);
    const result = await mutator(scoped);
    mergeDivision(full, scoped, viewer.division);
    return result;
  };

  if (usesPostgres()) {
    return updatePostgres(apply);
  }

  const run = async () => {
    const system = await readFromJson();
    const result = await apply(system);
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
