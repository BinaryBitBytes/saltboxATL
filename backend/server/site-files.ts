import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { JSON_DATA_DIR, persistToJson, readJsonFile } from "@/backend/server/json-store";
import {
  createSeedSystem,
  ensureDemoUsers,
  ensureSystemDefaults,
} from "@/backend/server/seed";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";
import { divisionOf } from "@/lib/divisions";
import { InventorySystemSchema, type InventorySystem, type Site } from "@/lib/inventory-schema";
import { assignUserHomeSites } from "@/lib/sites/access";
import {
  applySiteDocuments,
  isSiteDatabaseName,
  parseSiteDatabase,
  partitionSiteDatabases,
  siteDatabaseName,
  withoutSiteInventory,
  type SiteDatabaseDocument,
} from "@/lib/sites/database";

const PARTITION_VERSION = 1;

type Manifest = {
  version: number;
  databases: Array<{ databaseName: string; siteId: string; division: string }>;
};

let chain: Promise<unknown> = Promise.resolve();
let depth = 0;

export function enqueueJsonWrite<T>(run: () => Promise<T>): Promise<T> {
  if (depth > 0) return run();
  const pending = chain.then(async () => {
    depth += 1;
    try {
      return await run();
    } finally {
      depth -= 1;
    }
  });
  chain = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export function siteDatabaseDirectory(): string {
  const override = process.env.SALTBOX_SITE_DATABASE_DIR?.trim();
  if (override) return override;
  return path.join(JSON_DATA_DIR, "site-databases");
}

function manifestPath(): string {
  return path.join(siteDatabaseDirectory(), "manifest.json");
}

function documentPath(databaseName: string): string {
  if (!isSiteDatabaseName(databaseName)) {
    throw new Error("Invalid site database name.");
  }
  return path.join(siteDatabaseDirectory(), `${databaseName}.json`);
}

export async function readSiteDatabaseFile(
  databaseName: string,
): Promise<SiteDatabaseDocument | null> {
  try {
    const raw = await readFile(documentPath(databaseName), "utf8");
    return parseSiteDatabase(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeSiteDatabaseFile(document: SiteDatabaseDocument): Promise<void> {
  const parsed = parseSiteDatabase(document);
  await mkdir(siteDatabaseDirectory(), { recursive: true });
  await writeFile(
    documentPath(parsed.databaseName),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
}

async function readManifest(): Promise<Manifest | null> {
  try {
    const raw = await readFile(manifestPath(), "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    if (!parsed || parsed.version !== PARTITION_VERSION || !Array.isArray(parsed.databases)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readAllSiteDocuments(): Promise<SiteDatabaseDocument[]> {
  const manifest = await readManifest();
  if (!manifest) return [];
  const documents: SiteDatabaseDocument[] = [];
  for (const entry of manifest.databases) {
    if (!isSiteDatabaseName(entry.databaseName)) continue;
    const document = await readSiteDatabaseFile(entry.databaseName);
    if (document) documents.push(document);
  }
  return documents;
}

function catalogReady(system: InventorySystem): boolean {
  const sites = system.sites ?? [];
  const hasBeta = sites.some(
    (site) => site.codename === "BETA" && divisionOf(site) === "hyperscale",
  );
  const hasSierra = sites.some(
    (site) => site.codename === "SIERRA" && divisionOf(site) === "security",
  );
  const hasDemos = DEMO_ACCOUNTS.every((account) =>
    system.users.some((user) => user.email === account.email),
  );
  return hasBeta && hasSierra && hasDemos && (system.inventoryItems ?? []).length === 0;
}

async function writeManifest(sites: readonly Site[]): Promise<void> {
  const manifest: Manifest = {
    version: PARTITION_VERSION,
    databases: sites.map((site) => ({
      databaseName: site.databaseName ?? siteDatabaseName(site),
      siteId: site.id,
      division: divisionOf(site),
    })),
  };
  await mkdir(siteDatabaseDirectory(), { recursive: true });
  await writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function writePartition(system: InventorySystem): Promise<InventorySystem> {
  const documents = partitionSiteDatabases(system).map((document) => parseSiteDatabase(document));
  for (const document of documents) {
    await writeSiteDatabaseFile(document);
  }
  const catalog = InventorySystemSchema.parse(withoutSiteInventory(system));
  await writeManifest(catalog.sites ?? []);
  await persistToJson(catalog);
  return catalog;
}

async function ensureUnlocked(): Promise<void> {
  const manifest = await readManifest();
  const raw = await readJsonFile();
  if (!raw) {
    const seed = createSeedSystem();
    await ensureDemoUsers(seed);
    await writePartition(seed);
    return;
  }
  if (manifest && catalogReady(raw)) {
    if (assignUserHomeSites(raw)) {
      await persistToJson(InventorySystemSchema.parse(raw));
    }
    return;
  }
  const assembled = manifest ? applySiteDocuments(raw, await readAllSiteDocuments()) : raw;
  ensureSystemDefaults(assembled);
  await ensureDemoUsers(assembled);
  await writePartition(assembled);
}

export async function ensureSiteDatabases(): Promise<void> {
  return enqueueJsonWrite(() => ensureUnlocked());
}

export async function readCatalogFile(): Promise<InventorySystem> {
  const catalog = await readJsonFile();
  if (catalog) return catalog;
  await ensureUnlocked();
  const created = await readJsonFile();
  if (!created) throw new Error("Site catalog is missing.");
  return created;
}

export async function readAccountCatalog(): Promise<InventorySystem> {
  await ensureSiteDatabases();
  return readCatalogFile();
}

export async function readAssembledSystem(): Promise<InventorySystem> {
  return enqueueJsonWrite(async () => {
    await ensureUnlocked();
    const catalog = await readCatalogFile();
    return applySiteDocuments(catalog, await readAllSiteDocuments());
  });
}

export async function persistCatalog(catalog: InventorySystem): Promise<void> {
  const parsed = InventorySystemSchema.parse(withoutSiteInventory(catalog));
  await writeManifest(parsed.sites ?? []);
  await persistToJson(parsed);
}
