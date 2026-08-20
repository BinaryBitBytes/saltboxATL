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
  ServiceError,
} from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import type { ReceivingOrder, ShippingOrder } from "@/lib/inventory-schema";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function fail(error: unknown): ActionResult<never> {
  if (error instanceof ServiceError) {
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

export async function completeReceiving(
  orderId: string,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await completeReceivingOrder(orderId);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
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
): Promise<ActionResult<{ sku: string; quantityDelta: number }>> {
  try {
    const user = await requireApiPermission("adjustInventory");
    const data = await createAdjustmentRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    return {
      ok: true,
      data: { sku: data.sku, quantityDelta: data.quantityDelta },
    };
  } catch (error) {
    return fail(error);
  }
}
