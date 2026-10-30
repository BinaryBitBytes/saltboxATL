"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/backend/server/dal";
import { nowIso } from "@/backend/server/helperUtils";
import { ServiceError } from "@/backend/server/inventory-service";
import { resolveViewerSite } from "@/backend/server/site-context";
import { updateAcrossSites } from "@/backend/server/store";
import { hasPermission } from "@/lib/auth/permissions";
import {
  LoadFacilityTransferInputSchema,
  ReceiveFacilityTransferInputSchema,
} from "@/lib/inventory-schema";
import {
  loadFacilityTransfer,
  receiveFacilityTransfer,
} from "@/lib/transfers/facility";
import { ValidationError } from "@/lib/validation/errors";

export type TransferActionResult =
  | { ok: true }
  | { ok: false; error: string };

async function runTransfer(
  work: (siteId: string, actor: string, now: string, division: Parameters<typeof updateAcrossSites>[0]) => Promise<void>,
): Promise<TransferActionResult> {
  const user = await requireUser();
  if (!hasPermission(user.role, "transferFreight")) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  const viewer = await resolveViewerSite();
  if (!viewer.siteId) {
    return { ok: false, error: "Choose a work site before transferring freight." };
  }
  try {
    await work(viewer.siteId, user.name, nowIso(), viewer.division);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ServiceError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function loadFacilityTransferAction(input: {
  inventoryItemId: string;
  destinationSiteId: string;
  trailerCode: string;
  quantity: number;
  notes?: string;
  confirmLargeInput?: boolean;
  confirmationQuantity?: number;
}): Promise<TransferActionResult> {
  const parsed = LoadFacilityTransferInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the trailer load and try again." };
  }
  return runTransfer(async (siteId, actor, now, division) => {
    await updateAcrossSites(division, (system) =>
      loadFacilityTransfer(system, {
        ...parsed.data,
        actingSiteId: siteId,
        loadedBy: actor,
        now,
      }),
    );
  });
}

export async function receiveFacilityTransferAction(input: {
  transferId: string;
  verified: boolean;
  lines: Array<{ lineId: string; quantity: number }>;
  confirmLargeInput?: boolean;
  confirmationQuantity?: number;
}): Promise<TransferActionResult> {
  const parsed = ReceiveFacilityTransferInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the receipt and try again." };
  }
  if (!parsed.data.verified) {
    return {
      ok: false,
      error: "Verify the receipt before routing this trailer into the facility.",
    };
  }
  return runTransfer(async (siteId, actor, now, division) => {
    await updateAcrossSites(division, (system) =>
      receiveFacilityTransfer(system, {
        ...parsed.data,
        actingSiteId: siteId,
        receivedBy: actor,
        now,
      }),
    );
  });
}
