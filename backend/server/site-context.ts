import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { usesPostgres } from "@/backend/server/db";
import { readFromPostgres } from "@/backend/server/pg-store";
import { readAccountCatalog } from "@/backend/server/site-files";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";
import { selectDivision, DIVISION_COOKIE } from "@/lib/divisions";
import type { Division, UserRole } from "@/lib/inventory-schema";
import {
  canAccessMultiSite,
  homeSiteForDivision,
  selectSiteId,
  siteChoice,
  SITE_COOKIE,
  viewableSites,
} from "@/lib/sites/access";
import { siteLabel } from "@/lib/sites/database";

export type ViewerSite = {
  role: UserRole | null;
  userId: string | null;
  division: Division;
  siteId: string;
  label: string;
  databaseName: string;
  canSwitch: boolean;
  choices: Array<{ id: string; label: string }>;
};

function fallbackSite(): ViewerSite {
  return {
    role: null,
    userId: null,
    division: "hyperscale",
    siteId: "",
    label: "No work site",
    databaseName: "",
    canSwitch: false,
    choices: [],
  };
}

/**
 * Active work site for this request.
 * A forged site cookie is ignored unless the signed-in role can open multiple sites.
 */
export async function resolveViewerSite(): Promise<ViewerSite> {
  try {
    const cookieStore = await cookies();
    const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
    const catalog = usesPostgres() ? await readFromPostgres() : await readAccountCatalog();
    const division = session
      ? selectDivision(session.role, cookieStore.get(DIVISION_COOKIE)?.value)
      : "hyperscale";
    const user = session
      ? catalog.users.find((entry) => entry.id === session.sub)
      : undefined;
    const role = user?.role ?? session?.role ?? null;
    const home = homeSiteForDivision(catalog.sites ?? [], division);
    const siteId = role
      ? selectSiteId({
          role,
          requested: cookieStore.get(SITE_COOKIE)?.value,
          homeSiteId: user?.siteId ?? home?.id ?? null,
          sites: catalog.sites ?? [],
          division,
        })
      : (home?.id ?? "");
    const site = (catalog.sites ?? []).find((entry) => entry.id === siteId) ?? home;
    const canSwitch = role ? canAccessMultiSite(role) : false;
    const choices =
      role && canSwitch
        ? viewableSites({
            role,
            sites: catalog.sites ?? [],
            division,
            homeSiteId: user?.siteId,
          }).map((entry) => ({ id: entry.id, label: siteLabel(entry) }))
        : [];
    const chosen = site ? siteChoice(site) : null;
    return {
      role,
      userId: user?.id ?? session?.sub ?? null,
      division,
      siteId: chosen?.id ?? "",
      label: chosen?.label ?? "No work site",
      databaseName: chosen?.databaseName ?? "",
      canSwitch,
      choices,
    };
  } catch (error) {
    unstable_rethrow(error);
    return fallbackSite();
  }
}
