import { connection } from "next/server";
import { usesPostgres } from "@/backend/server/db";
import { readFromPostgres, updatePostgres } from "@/backend/server/pg-store";
import { resolveViewerSite, type ViewerSite } from "@/backend/server/site-context";
import {
  enqueueJsonWrite,
  persistCatalog,
  readAccountCatalog,
  readAllSiteDocuments,
  readAssembledSystem,
  readCatalogFile,
  readSiteDatabaseFile,
  writeSiteDatabaseFile,
} from "@/backend/server/site-files";
import {
  filterUsersForViewer,
  mergeDivision,
  scopeSystem,
} from "@/lib/divisions";
import type { Division, InventorySystem } from "@/lib/inventory-schema";
import { canAccessMultiSite } from "@/lib/sites/access";
import {
  commitWorkingCopy,
  emptySiteDatabase,
  mergeSite,
  openDivisionWorkingCopy,
  openSiteWorkingCopy,
  scopeToSite,
} from "@/lib/sites/database";
import {
  hydrateInventoryForDom,
  type DomSafeInventorySystem,
} from "@/lib/validation/dom-hydration";

export async function readFullSystem(): Promise<InventorySystem> {
  if (!usesPostgres()) return readAssembledSystem();
  return readFromPostgres();
}

async function readJsonScoped(viewer: ViewerSite): Promise<InventorySystem> {
  const catalog = await readAccountCatalog();
  const site = (catalog.sites ?? []).find((entry) => entry.id === viewer.siteId);
  if (!viewer.siteId || !site) {
    const scoped = scopeSystem(catalog, viewer.division);
    scoped.users = filterUsersForViewer(scoped.users, viewer.role);
    return scoped;
  }
  const document =
    (await readSiteDatabaseFile(site.databaseName ?? viewer.databaseName)) ??
    emptySiteDatabase(site);
  const working = openSiteWorkingCopy(catalog, viewer.division, document);
  working.users = filterUsersForViewer(working.users, viewer.role);
  return working;
}

async function readScopedSystem(): Promise<InventorySystem> {
  const viewer = await resolveViewerSite();
  if (usesPostgres()) {
    const full = await readFromPostgres();
    const scoped = viewer.siteId
      ? scopeToSite(scopeSystem(full, viewer.division), viewer.siteId)
      : scopeSystem(full, viewer.division);
    scoped.users = filterUsersForViewer(scoped.users, viewer.role);
    return scoped;
  }
  return readJsonScoped(viewer);
}

export async function readMultiSiteSystem(): Promise<InventorySystem> {
  const viewer = await resolveViewerSite();
  if (!viewer.role || !canAccessMultiSite(viewer.role)) {
    throw new Error("You do not have permission to do that.");
  }
  if (usesPostgres()) {
    const full = await readFromPostgres();
    const scoped = scopeSystem(full, viewer.division);
    scoped.users = filterUsersForViewer(scoped.users, viewer.role);
    return scoped;
  }
  const catalog = await readAccountCatalog();
  const working = openDivisionWorkingCopy(
    catalog,
    viewer.division,
    await readAllSiteDocuments(),
  );
  working.users = filterUsersForViewer(working.users, viewer.role);
  return working;
}

export async function getSystem(): Promise<DomSafeInventorySystem> {
  await connection();
  return hydrateInventoryForDom(await readScopedSystem());
}

export async function readSystem(): Promise<InventorySystem> {
  return readScopedSystem();
}

/** Every work site in the viewer's division, including transfer trailers between them. */
export async function readDivisionInventory(): Promise<InventorySystem> {
  const viewer = await resolveViewerSite();
  if (usesPostgres()) {
    const full = await readFromPostgres();
    const scoped = scopeSystem(full, viewer.division);
    scoped.users = filterUsersForViewer(scoped.users, viewer.role);
    return scoped;
  }
  const catalog = await readAccountCatalog();
  const working = openDivisionWorkingCopy(
    catalog,
    viewer.division,
    await readAllSiteDocuments(),
  );
  working.users = filterUsersForViewer(working.users, viewer.role);
  return working;
}

async function applyScoped<T>(
  full: InventorySystem,
  viewer: ViewerSite,
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  const divisionScoped = scopeSystem(full, viewer.division);
  const siteScoped = viewer.siteId
    ? scopeToSite(divisionScoped, viewer.siteId)
    : divisionScoped;
  const result = await mutator(siteScoped);
  if (!viewer.siteId) {
    mergeDivision(full, siteScoped, viewer.division);
    return result;
  }
  const merged = mergeSite(divisionScoped, siteScoped, viewer.siteId);
  mergeDivision(full, merged, viewer.division);
  return result;
}

export async function updateSystem<T>(
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  const viewer = await resolveViewerSite();
  if (usesPostgres()) {
    return updatePostgres((full) => applyScoped(full, viewer, mutator));
  }

  return enqueueJsonWrite(async () => {
    const catalog = await readCatalogFile();
    const site = (catalog.sites ?? []).find((entry) => entry.id === viewer.siteId);
    if (!site) throw new Error("No work site is available.");
    const document =
      (await readSiteDatabaseFile(site.databaseName ?? viewer.databaseName)) ??
      emptySiteDatabase(site);
    const working = openSiteWorkingCopy(catalog, viewer.division, document);
    const result = await mutator(working);
    const committed = commitWorkingCopy(catalog, working, viewer.division, site.id);
    for (const doc of committed.sites) {
      await writeSiteDatabaseFile(doc);
    }
    await persistCatalog(committed.catalog);
    return result;
  });
}

export async function updateAcrossSites<T>(
  division: Division,
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  if (usesPostgres()) {
    return updatePostgres(async (full) => {
      const scoped = scopeSystem(full, division);
      const result = await mutator(scoped);
      mergeDivision(full, scoped, division);
      return result;
    });
  }

  return enqueueJsonWrite(async () => {
    const catalog = await readCatalogFile();
    const working = openDivisionWorkingCopy(
      catalog,
      division,
      await readAllSiteDocuments(),
    );
    const anchor = working.sites[0]?.id;
    if (!anchor) throw new Error("No work site is available.");
    const result = await mutator(working);
    const committed = commitWorkingCopy(catalog, working, division, anchor);
    for (const document of committed.sites) {
      await writeSiteDatabaseFile(document);
    }
    await persistCatalog(committed.catalog);
    return result;
  });
}
