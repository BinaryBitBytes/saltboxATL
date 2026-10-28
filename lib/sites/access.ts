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
}): Site[] {
  const list = sitesInDivision(input.sites, input.division);
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
}): string {
  const visible = viewableSites(input);
  if (canAccessMultiSite(input.role) && typeof input.requested === "string") {
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
}): { ok: true; siteId: string } | { ok: false; error: string } {
  if (!canAccessMultiSite(input.role)) {
    return { ok: false, error: "Only multi-site roles can change work sites." };
  }
  const visible = viewableSites({
    role: input.role,
    sites: input.sites,
    division: input.division,
  });
  const picked = visible.find((site) => site.id === input.requested);
  if (!picked) return { ok: false, error: "That work site is not available." };
  return { ok: true, siteId: picked.id };
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
    const valid = (system.sites ?? []).some(
      (site) => site.id === user.siteId && divisionOf(site) === division,
    );
    if (!valid && home && user.siteId !== home.id) {
      user.siteId = home.id;
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
