"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelReceivingOrder,
  completeReceivingOrder,
  reopenReceivingOrder,
  createLocationRecord,
  createReceivingOrderRecord,
  createRoomRecord,
  createShippingOrderRecord,
  createAdjustmentRecord,
  addCaseToPallet,
  addPalletToOrder,
  setWorkingPallet,
  updateCaseOnPallet,
  removeCaseFromPallet,
  assignPutawayLocation,
  completePutawayOrder,
  importInventorySpreadsheet,
  ServiceError,
} from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import type { ReceivingOrder, ShippingOrder } from "@/lib/inventory-schema";
import {
  replaySpreadsheetText,
  spreadsheetTextFromForm,
  type SpreadsheetFormText,
} from "@/lib/inventory/spreadsheet-source";
import { ValidationError } from "@/lib/validation/errors";

export type ActionFailure = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
  sourceText?: string;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | ActionFailure;

function fail(error: unknown): ActionFailure {
  if (error instanceof ServiceError || error instanceof ValidationError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Unexpected server error" };
}

function revalidateInventory() {
  revalidatePath("/");
  revalidatePath("/receiving");
  revalidatePath("/putaway");
  revalidatePath("/inventory");
  revalidatePath("/shipping");
  revalidatePath("/locations");
  revalidatePath("/transactions");
}

export async function createReceivingOrder(
  rawData: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    const user = await requireApiPermission("receive");
    const data = await createReceivingOrderRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    revalidatePath(`/receiving/${data.id}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function addReceivingPallet(
  orderId: string,
  rawData: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await addPalletToOrder(orderId, rawData);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function selectWorkingPallet(
  orderId: string,
  palletId: string,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await setWorkingPallet(orderId, palletId);
    revalidatePath(`/receiving/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function addReceivingCase(
  orderId: string,
  palletId: string,
  rawData: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await addCaseToPallet(orderId, palletId, rawData);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function updateReceivingCase(
  orderId: string,
  palletId: string,
  caseId: string,
  rawData: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await updateCaseOnPallet(orderId, palletId, caseId, rawData);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function removeReceivingCase(
  orderId: string,
  palletId: string,
  caseId: string,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await removeCaseFromPallet(orderId, palletId, caseId);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function completeReceiving(
  orderId: string,
  confirmation?: { confirmLargeInput?: boolean; confirmationQuantity?: number },
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await completeReceivingOrder(orderId, confirmation);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    revalidatePath(`/putaway/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function reopenReceiving(
  orderId: string,
  rawData?: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    const user = await requireApiPermission("reopenReceiving");
    const data = await reopenReceivingOrder(orderId, user.name, rawData ?? {});
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    revalidatePath(`/putaway/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export type ReopenReceivingState = {
  error?: string;
};

export async function reopenReceivingForm(
  orderId: string,
  _state: ReopenReceivingState,
  formData: FormData,
): Promise<ReopenReceivingState> {
  const raw = formData.get("expectedPalletCount");
  const expectedPalletCount =
    typeof raw === "string" && raw.trim().length > 0
      ? Number(raw)
      : undefined;

  try {
    const user = await requireApiPermission("reopenReceiving");
    await reopenReceivingOrder(
      orderId,
      user.name,
      Number.isFinite(expectedPalletCount)
        ? { expectedPalletCount }
        : {},
    );
  } catch (error) {
    return { error: fail(error).error };
  }

  revalidateInventory();
  revalidatePath(`/receiving/${orderId}`);
  revalidatePath(`/putaway/${orderId}`);
  redirect(`/receiving/${orderId}`);
}

export async function cancelReceiving(
  orderId: string,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await cancelReceivingOrder(orderId);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    revalidatePath(`/putaway/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function assignReceivingPutawayLocation(
  orderId: string,
  palletId: string,
  caseId: string,
  rawData: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("putaway");
    const data = await assignPutawayLocation(orderId, palletId, caseId, rawData);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    revalidatePath(`/putaway/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function completePutaway(
  orderId: string,
  confirmation?: { confirmLargeInput?: boolean; confirmationQuantity?: number },
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("putaway");
    const data = await completePutawayOrder(orderId, confirmation);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    revalidatePath(`/putaway/${orderId}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function createShippingOrder(
  rawData: unknown,
): Promise<ActionResult<ShippingOrder>> {
  try {
    const user = await requireApiPermission("ship");
    const data = await createShippingOrderRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    revalidatePath(`/shipping/${data.id}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function createRoom(rawData: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requireApiPermission("manageLocations");
    const data = await createRoomRecord(rawData);
    revalidatePath("/locations");
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function createLocation(
  rawData: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireApiPermission("manageLocations");
    const data = await createLocationRecord(rawData);
    revalidatePath("/locations");
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function createAdjustment(
  rawData: unknown,
): Promise<
  ActionResult<{ sku: string; quantityDelta: number; referenceId: string }>
> {
  try {
    const user = await requireApiPermission("adjustInventory");
    const data = await createAdjustmentRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    return {
      ok: true,
      data: {
        sku: data.sku,
        quantityDelta: data.quantityDelta,
        referenceId: data.referenceId,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function importInventoryForm(
  _previous: ActionResult<{
    dryRun: boolean;
    applied: boolean;
    created: number;
    updated: number;
    unchanged: number;
    unitsDelta: number;
    rowsRead: number;
    requiresConfirmation: boolean;
    errors: Array<{ row: number; message: string }>;
    sourceText: string;
    importId?: string;
  }> | null,
  formData: FormData,
): Promise<
  ActionResult<{
    dryRun: boolean;
    applied: boolean;
    created: number;
    updated: number;
    unchanged: number;
    unitsDelta: number;
    rowsRead: number;
    requiresConfirmation: boolean;
    errors: Array<{ row: number; message: string }>;
    sourceText: string;
    importId?: string;
  }>
> {
  let source: SpreadsheetFormText = {
    text: String(formData.get("text") ?? ""),
    source: "paste",
  };
  try {
    const user = await requireApiPermission("adjustInventory");
    source = await spreadsheetTextFromForm(formData);
    const confirmationRaw = String(formData.get("confirmationQuantity") ?? "").trim();
    const data = await importInventorySpreadsheet({
      text: source.text,
      mode: formData.get("mode") === "add" ? "add" : "set",
      dryRun: formData.get("intent") !== "apply",
      createdBy: user.name,
      confirmLargeInput:
        formData.get("confirmLargeInput") === "on" ||
        formData.get("confirmLargeInput") === "1",
      confirmationQuantity: confirmationRaw ? Number(confirmationRaw) : undefined,
    });
    if (data.applied) {
      revalidateInventory();
    }
    return {
      ok: true,
      data: { ...data, sourceText: replaySpreadsheetText(source, false) },
    };
  } catch (error) {
    return {
      ...fail(error),
      sourceText: replaySpreadsheetText(source, true),
    };
  }
}
