import { divisionForRole, divisionOf } from "@/lib/divisions";
import type { Division, InventorySystem, Site, UserRole } from "@/lib/inventory-schema";
import { siteDatabaseName, siteLabel } from "@/lib/sites/database";

/** Roles allowed to see and act across work sites. */
export const MULTI_SITE_ROLES = [
  "product-developer",
  "logistics-coordinator",
  "it-admin",
  "superintendent",
  "project-manager",
] as const satisfies readonly UserRole[];

export const SITE_COOKIE = "saltbox_site";

export function canAccessMultiSite(role: UserRole): boolean {
  return (MULTI_SITE_ROLES as readonly UserRole[]).includes(role);
}

export function sitesInDivision(sites: readonly Site[], division: Division): Site[] {
  return sites
    .filter((site) => divisionOf(site) === division)
    .sort((left, right) => left.codename.localeCompare(right.codename));
}

export function homeSiteForDivision(
  sites: readonly Site[],
  division: Division,
): Site | undefined {
  const list = sitesInDivision(sites, division);
  const preferred = division === "security" ? "SIERRA" : "ALPHA";
  return list.find((site) => site.codename === preferred) ?? list[0];
}

export function viewableSites(input: {
  role: UserRole;
  sites: readonly Site[];
  division: Division;
  homeSiteId?: string | null;
  allowedSiteIds?: readonly string[] | null;
}): Site[] {
  const list = sitesInDivision(input.sites, input.division);
  if (input.allowedSiteIds != null) {
    const allowed = new Set(input.allowedSiteIds);
    const granted = list.filter((site) => allowed.has(site.id));
    if (granted.length > 0) return granted;
  }
  if (canAccessMultiSite(input.role)) return list;
  const home = list.find((site) => site.id === input.homeSiteId);
  if (home) return [home];
  const fallback = homeSiteForDivision(list, input.division);
  return fallback ? [fallback] : list.slice(0, 1);
}

export function selectSiteId(input: {
  role: UserRole;
  requested: unknown;
  homeSiteId?: string | null;
  sites: readonly Site[];
  division: Division;
  allowedSiteIds?: readonly string[] | null;
}): string {
  const visible = viewableSites(input);
  if (visible.length > 1 && typeof input.requested === "string") {
    const picked = visible.find((site) => site.id === input.requested);
    if (picked) return picked.id;
  }
  const home = visible.find((site) => site.id === input.homeSiteId);
  if (home) return home.id;
  return visible[0]?.id ?? "";
}

export function authorizeSiteChange(input: {
  role: UserRole;
  requested: unknown;
  sites: readonly Site[];
  division: Division;
  homeSiteId?: string | null;
  allowedSiteIds?: readonly string[] | null;
}): { ok: true; siteId: string } | { ok: false; error: string } {
  const visible = viewableSites(input);
  if (visible.length < 2) {
    return { ok: false, error: "That work site is not available." };
  }
  const picked = visible.find((site) => site.id === input.requested);
  if (!picked) return { ok: false, error: "That work site is not available." };
  return { ok: true, siteId: picked.id };
}

/**
 * Inventory edits open one site at a time. Site grants still need every site
 * in the division, so the registry is merged with that open slice.
 */
export function sitesForAssignment(
  openSites: readonly Site[] | undefined,
  registrySites: readonly Site[] | undefined,
): Site[] {
  const byId = new Map<string, Site>();
  for (const site of registrySites ?? []) byId.set(site.id, site);
  for (const site of openSites ?? []) byId.set(site.id, site);
  return [...byId.values()];
}

/**
 * Managers and IT admins grant an explicit site list.
 * The home site is the one selected in the dropdown and must be checked.
 */
export function resolveAssignedSites(input: {
  sites: readonly Site[];
  division: Division;
  allowedSiteIds: readonly string[];
  siteId?: string | null;
}): { ok: true; allowedSiteIds: string[]; siteId: string } | { ok: false; error: string } {
  const list = sitesInDivision(input.sites, input.division);
  if (list.length === 0) {
    return { ok: false, error: "That work site is not in this user's division." };
  }
  const known = new Set(list.map((site) => site.id));
  if (input.allowedSiteIds.some((id) => !known.has(id))) {
    return { ok: false, error: "That work site is not in this user's division." };
  }
  const allowedSiteIds = input.allowedSiteIds.filter((id) => known.has(id));
  if (allowedSiteIds.length === 0) {
    return { ok: false, error: "Allow at least one work site." };
  }
  if (input.siteId && !allowedSiteIds.includes(input.siteId)) {
    return { ok: false, error: "The home site must be an allowed work site." };
  }
  return {
    ok: true,
    allowedSiteIds,
    siteId: input.siteId && allowedSiteIds.includes(input.siteId)
      ? input.siteId
      : allowedSiteIds[0]!,
  };
}

export function assignUserHomeSites(system: InventorySystem): boolean {
  let changed = false;
  for (const site of system.sites ?? []) {
    const name = siteDatabaseName(site);
    if (site.databaseName !== name) {
      site.databaseName = name;
      changed = true;
    }
  }
  for (const user of system.users ?? []) {
    const division = divisionForRole(user.role);
    if (user.division !== division) {
      user.division = division;
      changed = true;
    }
    const home = homeSiteForDivision(system.sites ?? [], division);
    const divisionSites = sitesInDivision(system.sites ?? [], division);
    const known = new Set(divisionSites.map((site) => site.id));
    if (user.allowedSiteIds != null) {
      const allowed = user.allowedSiteIds.filter((id) => known.has(id));
      const nextAllowed = allowed.length > 0 ? allowed : home ? [home.id] : [];
      if (nextAllowed.join() !== user.allowedSiteIds.join()) {
        user.allowedSiteIds = nextAllowed;
        changed = true;
      }
    }
    const allowedHome =
      user.allowedSiteIds == null || user.allowedSiteIds.includes(user.siteId ?? "");
    const valid =
      Boolean(user.siteId) && known.has(user.siteId ?? "") && allowedHome;
    const nextHome = valid
      ? user.siteId
      : (user.allowedSiteIds?.[0] ?? home?.id);
    if (nextHome && user.siteId !== nextHome) {
      user.siteId = nextHome;
      changed = true;
    }
  }
  return changed;
}

export function siteChoice(site: Site): { id: string; label: string; databaseName: string } {
  return {
    id: site.id,
    label: siteLabel(site),
    databaseName: site.databaseName ?? siteDatabaseName(site),
  };
}
