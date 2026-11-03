import { connection } from "next/server";
import { usesPostgres } from "@/backend/server/db";
import { readFromPostgres, updatePostgres } from "@/backend/server/pg-store";
import { resolveViewerSite, type ViewerSite } from "@/backend/server/site-context";
import {
  enqueueJsonWrite,
  ensureSiteDatabases,
  persistCatalog,
  readAllSiteDocuments,
  readAssembledSystem,
  readCatalogFile,
  writeSiteDatabaseFile,
} from "@/backend/server/site-files";
import {
  filterUsersForViewer,
  mergeDivision,
  scopeSystem,
} from "@/lib/divisions";
import type { Division, InventorySystem } from "@/lib/inventory-schema";
import { reconcilePersistedAllocations } from "@/lib/allocation/persist";
import { nowIso } from "@/backend/server/helperUtils";
import { canAccessMultiSite } from "@/lib/sites/access";
import {
  commitWorkingCopy,
  mergeSite,
  openDivisionWorkingCopy,
  scopeToSite,
} from "@/lib/sites/database";
import {
  hydrateInventoryForDom,
  type DomSafeInventorySystem,
} from "@/lib/validation/dom-hydration";

export async function readFullSystem(): Promise<InventorySystem> {
  const system = usesPostgres() ? await readFromPostgres() : await readAssembledSystem();
  reconcilePersistedAllocations(system, nowIso());
  return system;
}

/**
 * Heal saved holds against every site in the division, then save when a row
 * changed. A one-site copy cannot tell a deleted line from a line that moved
 * to another site, so the catalog is not updated from that narrower view.
 */
async function readJsonDivision(division: Division): Promise<InventorySystem> {
  return enqueueJsonWrite(async () => {
    await ensureSiteDatabases();
    const catalog = await readCatalogFile();
    const working = openDivisionWorkingCopy(
      catalog,
      division,
      await readAllSiteDocuments(),
    );
    if (!reconcilePersistedAllocations(working, nowIso())) return working;
    const anchor = working.sites?.[0]?.id;
    if (!anchor) return working;
    const committed = commitWorkingCopy(catalog, working, division, anchor);
    for (const document of committed.sites) {
      await writeSiteDatabaseFile(document);
    }
    await persistCatalog(committed.catalog);
    return working;
  });
}

async function readJsonScoped(viewer: ViewerSite): Promise<InventorySystem> {
  const divisionView = await readJsonDivision(viewer.division);
  const site = (divisionView.sites ?? []).find((entry) => entry.id === viewer.siteId);
  const view =
    viewer.siteId && site ? scopeToSite(divisionView, viewer.siteId) : divisionView;
  view.users = filterUsersForViewer(view.users, viewer.role);
  return view;
}

async function readScopedSystem(): Promise<InventorySystem> {
  const viewer = await resolveViewerSite();
  if (usesPostgres()) {
    const full = await readFromPostgres();
    reconcilePersistedAllocations(full, nowIso());
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
    reconcilePersistedAllocations(full, nowIso());
    const scoped = scopeSystem(full, viewer.division);
    scoped.users = filterUsersForViewer(scoped.users, viewer.role);
    return scoped;
  }
  const working = await readJsonDivision(viewer.division);
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
    reconcilePersistedAllocations(full, nowIso());
    const scoped = scopeSystem(full, viewer.division);
    scoped.users = filterUsersForViewer(scoped.users, viewer.role);
    return scoped;
  }
  const working = await readJsonDivision(viewer.division);
  working.users = filterUsersForViewer(working.users, viewer.role);
  return working;
}

async function applyScoped<T>(
  full: InventorySystem,
  viewer: ViewerSite,
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  reconcilePersistedAllocations(full, nowIso());
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
    await ensureSiteDatabases();
    const catalog = await readCatalogFile();
    const divisionView = openDivisionWorkingCopy(
      catalog,
      viewer.division,
      await readAllSiteDocuments(),
    );
    reconcilePersistedAllocations(divisionView, nowIso());
    const site = (divisionView.sites ?? []).find((entry) => entry.id === viewer.siteId);
    if (!site) throw new Error("No work site is available.");
    const working = scopeToSite(divisionView, viewer.siteId);
    const result = await mutator(working);
    const merged = mergeSite(divisionView, working, viewer.siteId);
    const committed = commitWorkingCopy(catalog, merged, viewer.division, site.id);
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
      reconcilePersistedAllocations(full, nowIso());
      const scoped = scopeSystem(full, division);
      const result = await mutator(scoped);
      mergeDivision(full, scoped, division);
      return result;
    });
  }

  return enqueueJsonWrite(async () => {
    await ensureSiteDatabases();
    const catalog = await readCatalogFile();
    const working = openDivisionWorkingCopy(
      catalog,
      division,
      await readAllSiteDocuments(),
    );
    reconcilePersistedAllocations(working, nowIso());
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
