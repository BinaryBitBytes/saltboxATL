"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/backend/server/dal";
import {
  connectionIsSecure,
  SESSION_MAX_AGE,
} from "@/lib/auth/token";
import { DIVISION_COOKIE, viewableDivisions } from "@/lib/divisions";
import type { Division } from "@/lib/inventory-schema";

export type DivisionActionResult =
  | { ok: true }
  | { ok: false; error: string };

function requestFromHeaders(headerStore: Headers): Request {
  const proto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost";
  return new Request(`${proto}://${host}/`, { headers: headerStore });
}

export async function setActiveDivision(
  division: Division,
): Promise<DivisionActionResult> {
  const user = await requireUser();
  if (division !== "hyperscale" && division !== "security") {
    return { ok: false, error: "Unknown division." };
  }
  if (!viewableDivisions(user).includes(division)) {
    return { ok: false, error: "That division is not available." };
  }

  const headerStore = await headers();
  const cookieStore = await cookies();
  cookieStore.set(DIVISION_COOKIE, division, {
    httpOnly: true,
    secure: connectionIsSecure(requestFromHeaders(headerStore)),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
