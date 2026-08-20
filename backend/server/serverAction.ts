"use server";

import { revalidatePath } from "next/cache";
import {
  cancelReceivingOrder,
  completeReceivingOrder,
  createLocationRecord,
  createReceivingOrderRecord,
  createRoomRecord,
  createShippingOrderRecord,
  addCaseToPallet,
  addPalletToOrder,
  setWorkingPallet,
  ServiceError,
} from "@/backend/server/inventory-service";
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
}

export async function createReceivingOrder(
  rawData: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    const data = await createReceivingOrderRecord(rawData);
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
    const data = await createShippingOrderRecord(rawData);
    revalidateInventory();
    revalidatePath(`/shipping/${data.id}`);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function createRoom(rawData: unknown): Promise<ActionResult<{ id: string }>> {
  try {
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
    const data = await createLocationRecord(rawData);
    revalidatePath("/locations");
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}
