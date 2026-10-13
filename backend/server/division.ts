import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
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
 * A forged division cookie is ignored unless the signed-in role is the admin manager.
 */
export async function resolveViewerDivision(): Promise<ViewerDivision> {
  try {
    const cookieStore = await cookies();
    const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
    if (!session) return { role: null, division: "hyperscale" };
    return {
      role: session.role,
      division: selectDivision(
        session.role,
        cookieStore.get(DIVISION_COOKIE)?.value,
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
