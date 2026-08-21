"use server";

import { revalidatePath } from "next/cache";
import {
  cancelReceivingOrder,
  completeReceivingOrder,
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
  ServiceError,
} from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import type { ReceivingOrder, ShippingOrder } from "@/lib/inventory-schema";
import { ValidationError } from "@/lib/validation/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function fail(error: unknown): ActionResult<never> {
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
