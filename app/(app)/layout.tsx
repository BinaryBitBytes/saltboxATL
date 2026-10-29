import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/backend/server/dal";
import { resolveActiveDivision } from "@/backend/server/division";
import { resolveViewerSite } from "@/backend/server/site-context";
import { canOpenDivisions, viewableDivisions } from "@/lib/divisions";
import { hydrateForDom } from "@/lib/validation/dom-hydration";

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const division = await resolveActiveDivision();
  const site = await resolveViewerSite();
  return (
    <AppShell
      user={hydrateForDom(user)}
      division={division}
      canSwitchDivision={canOpenDivisions(user)}
      divisionChoices={viewableDivisions(user)}
      siteId={site.siteId}
      siteLabel={site.label}
      canSwitchSite={site.canSwitch}
      siteChoices={site.choices}
    >
      {children}
    </AppShell>
  );
}
