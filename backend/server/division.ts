import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readAccounts } from "@/backend/server/account-store";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";
import {
  DIVISION_COOKIE,
  selectDivision,
} from "@/lib/divisions";
import type { Division, UserRole } from "@/lib/inventory-schema";

export type ViewerDivision = {
  role: UserRole | null;
  division: Division;
};

/**
 * Active inventory division for this request.
 * Outside a request (tests and scripts) this stays on Hyperscale.
 * A division cookie is honored when that login may open more than one division.
 */
export async function resolveViewerDivision(): Promise<ViewerDivision> {
  try {
    const cookieStore = await cookies();
    const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
    if (!session) return { role: null, division: "hyperscale" };
    let role = session.role;
    let allowedDivisions: Division[] | undefined;
    try {
      const accounts = await readAccounts();
      const user = accounts.users.find((entry) => entry.id === session.sub);
      if (user) {
        role = user.role;
        allowedDivisions = user.allowedDivisions;
      }
    } catch (error) {
      console.error("Could not read division access.", error);
    }
    return {
      role,
      division: selectDivision(
        role,
        cookieStore.get(DIVISION_COOKIE)?.value,
        allowedDivisions,
      ),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { role: null, division: "hyperscale" };
  }
}

export async function resolveActiveDivision(): Promise<Division> {
  const viewer = await resolveViewerDivision();
  return viewer.division;
}
