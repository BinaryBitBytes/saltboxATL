import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/backend/server/dal";
import { resolveActiveDivision } from "@/backend/server/division";
import { canSwitchDivision } from "@/lib/divisions";
import { hydrateForDom } from "@/lib/validation/dom-hydration";

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const division = await resolveActiveDivision();
  return (
    <AppShell
      user={hydrateForDom(user)}
      division={division}
      canSwitchDivision={canSwitchDivision(user.role)}
    >
      {children}
    </AppShell>
  );
}
