"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/backend/server/dal";
import { resolveViewerSite } from "@/backend/server/site-context";
import { nowIso } from "@/backend/server/helperUtils";
import { updateAcrossSites } from "@/backend/server/store";
import { ServiceError } from "@/backend/server/inventory-service";
import { hasPermission } from "@/lib/auth/permissions";
import { connectionIsSecure, SESSION_MAX_AGE } from "@/lib/auth/token";
import { OrderSiteTransferInputSchema } from "@/lib/inventory-schema";
import { SITE_COOKIE } from "@/lib/sites/access";
import { orderSiteTransfer } from "@/lib/sites/transfer";
import { ValidationError } from "@/lib/validation/errors";

export type SiteActionResult =
  | { ok: true }
  | { ok: false; error: string };

function requestFromHeaders(headerStore: Headers): Request {
  const proto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost";
  return new Request(`${proto}://${host}/`, { headers: headerStore });
}

export async function setActiveSite(siteId: string): Promise<SiteActionResult> {
  await requireUser();
  const viewer = await resolveViewerSite();
  if (!viewer.choices.some((choice) => choice.id === siteId)) {
    return { ok: false, error: "That work site is not available." };
  }

  const headerStore = await headers();
  const cookieStore = await cookies();
  cookieStore.set(SITE_COOKIE, siteId, {
    httpOnly: true,
    secure: connectionIsSecure(requestFromHeaders(headerStore)),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function orderSiteTransferAction(input: {
  inventoryItemId: string;
  destinationLocationId: string;
  quantity: number;
  notes?: string;
  confirmLargeInput?: boolean;
  confirmationQuantity?: number;
}): Promise<SiteActionResult> {
  const user = await requireUser();
  if (!hasPermission(user.role, "transferBetweenSites")) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  const parsed = OrderSiteTransferInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the transfer and try again." };
  }
  const viewer = await resolveViewerSite();
  try {
    await updateAcrossSites(viewer.division, (system) =>
      orderSiteTransfer(system, {
        ...parsed.data,
        orderedBy: user.name,
        now: nowIso(),
      }),
    );
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ServiceError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
