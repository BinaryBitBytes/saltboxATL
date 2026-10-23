"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelReceivingOrder,
  completeReceivingOrder,
  reopenReceivingOrder,
  createLocationRecord,
  createReceivingOrderRecord,
  recordDeliveryScanRecord,
  deleteInboundPurchaseOrderRecord,
  saveBuyerPurchaseOrderRecord,
  saveDeliveryNotesRecord,
  setPurchaseOrderJobIdRecord,
  updateInboundPurchaseOrderRecord,
  createRoomRecord,
  acknowledgeWarehousePrintsRecord,
  cancelCustomerOrderRecord,
  completeCustomerOrderPickRecord,
  createCustomerOrderRecord,
  createShippingOrderRecord,
  createAdjustmentRecord,
  moveInventoryRecord,
  addCaseToPallet,
  addPalletToOrder,
  setWorkingPallet,
  updateCaseOnPallet,
  removeCaseFromPallet,
  assignPutawayLocation,
  completePutawayOrder,
  breakDownPalletForCube,
  saveItemCubeRecord,
  updateLocationCapacityRecord,
  importInventorySpreadsheet,
  ServiceError,
} from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import type {
  ItemCube,
  Location,
  DeliveryRecord,
  PurchaseOrder,
  PurchaseDocument,
  CustomerOrder,
  ReceivingOrder,
  ShippingOrder,
} from "@/lib/inventory-schema";
import {
  replaySpreadsheetText,
  spreadsheetTextFromForm,
  type SpreadsheetFormText,
} from "@/lib/inventory/spreadsheet-source";
import { ValidationError } from "@/lib/validation/errors";
import { hydrateForDom } from "@/lib/validation/dom-hydration";
import { sanitizeDomText } from "@/lib/validation/sanitize";
import {
  deletePurchaseDocumentRecord,
  importInvoiceLoadRecord,
  redactPurchaseDocumentRecord,
} from "@/backend/server/document-service";
import { deletePurchaseDocumentFile } from "@/backend/server/document-store";

export type ActionFailure = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
  sourceText?: string;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | ActionFailure;

function clientPayload<T>(data: T): T {
  return hydrateForDom(data);
}

function fail(error: unknown): ActionFailure {
  if (error instanceof ServiceError || error instanceof ValidationError) {
    return { ok: false, error: sanitizeDomText(error.message) };
  }
  if (error instanceof Error) {
    return { ok: false, error: sanitizeDomText(error.message) };
  }
  return { ok: false, error: "Unexpected server error" };
}

function revalidateInventory() {
  revalidatePath("/");
  revalidatePath("/receiving");
  revalidatePath("/putaway");
  revalidatePath("/moves");
  revalidatePath("/inventory");
  revalidatePath("/cubing");
  revalidatePath("/shipping");
  revalidatePath("/orders");
  revalidatePath("/locations");
  revalidatePath("/transactions");
  revalidatePath("/inbound");
  revalidatePath("/loads");
}

export async function createReceivingOrder(
  rawData: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    const user = await requireApiPermission("receive");
    const payload = withCreatedBy(rawData, user);
    if (!hasPermission(user.role, "assignJobId")) {
      delete payload.jobIdNumber;
    }
    const data = await createReceivingOrderRecord(payload);
    revalidateInventory();
    revalidatePath(`/receiving/${data.id}`);
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function setPurchaseOrderJobId(
  rawData: unknown,
): Promise<ActionResult<PurchaseOrder>> {
  try {
    await requireApiPermission("assignJobId");
    const data = await setPurchaseOrderJobIdRecord(rawData);
    revalidateInventory();
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function deletePurchaseDocument(
  rawData: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireApiPermission("uploadBuyerOrders");
    const documentId = await deletePurchaseDocumentRecord(rawData);
    await Promise.all([
      deletePurchaseDocumentFile(documentId, false),
      deletePurchaseDocumentFile(documentId, true),
    ]);
    revalidateInventory();
    return { ok: true, data: clientPayload({ id: documentId }) };
  } catch (error) {
    return fail(error);
  }
}

export async function redactInvoicePrices(
  documentId: string,
): Promise<ActionResult<PurchaseDocument>> {
  try {
    await requireApiPermission("uploadBuyerOrders");
    const data = await redactPurchaseDocumentRecord(documentId);
    revalidateInventory();
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function importInvoiceInboundLoad(
  documentId: string,
  rawData?: unknown,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    const user = await requireApiPermission("uploadBuyerOrders");
    const record =
      rawData && typeof rawData === "object" && !Array.isArray(rawData)
        ? (rawData as {
            confirmLargeInput?: boolean;
            confirmationQuantity?: number;
          })
        : {};
    const data = await importInvoiceLoadRecord(documentId, record, user.name);
    revalidateInventory();
    if (data.id) revalidatePath(`/receiving/${data.id}`);
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function saveBuyerPurchaseOrder(
  rawData: unknown,
): Promise<ActionResult<PurchaseOrder>> {
  try {
    const user = await requireApiPermission("uploadBuyerOrders");
    const data = await saveBuyerPurchaseOrderRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateInboundPurchaseOrder(
  rawData: unknown,
): Promise<ActionResult<PurchaseOrder>> {
  try {
    const user = await requireApiPermission("uploadBuyerOrders");
    const data = await updateInboundPurchaseOrderRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteInboundPurchaseOrder(
  rawData: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireApiPermission("uploadBuyerOrders");
    const id =
      rawData && typeof rawData === "object" && !Array.isArray(rawData)
        ? String((rawData as { id?: unknown }).id ?? "")
        : "";
    const documentIds = await deleteInboundPurchaseOrderRecord(rawData, {
      role: user.role,
      id: user.id,
    });
    await Promise.all(
      documentIds.flatMap((documentId) => [
        deletePurchaseDocumentFile(documentId, false),
        deletePurchaseDocumentFile(documentId, true),
      ]),
    );
    revalidateInventory();
    return { ok: true, data: clientPayload({ id }) };
  } catch (error) {
    return fail(error);
  }
}

export async function recordDeliveryScan(
  rawData: unknown,
): Promise<ActionResult<DeliveryRecord>> {
  try {
    const user = await requireApiPermission("confirmDelivery");
    const payload =
      rawData && typeof rawData === "object" && !Array.isArray(rawData)
        ? { ...(rawData as Record<string, unknown>), scannedBy: user.name }
        : { scannedBy: user.name };
    const data = await recordDeliveryScanRecord(payload);
    revalidateInventory();
    revalidatePath("/loads");
    revalidatePath("/shipping");
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function saveDeliveryNotes(
  rawData: unknown,
): Promise<ActionResult<DeliveryRecord>> {
  try {
    const user = await requireApiPermission("confirmDelivery");
    const payload =
      rawData && typeof rawData === "object" && !Array.isArray(rawData)
        ? { ...(rawData as Record<string, unknown>), updatedBy: user.name }
        : { updatedBy: user.name };
    const data = await saveDeliveryNotesRecord(payload);
    revalidateInventory();
    revalidatePath("/loads");
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function createCustomerOrder(
  rawData: unknown,
): Promise<ActionResult<CustomerOrder>> {
  try {
    const user = await requireApiPermission("placeOrder");
    const data = await createCustomerOrderRecord({
      ...withCreatedBy(rawData, user),
      placedBy: user.name,
    });
    revalidateInventory();
    revalidatePath(`/orders/${data.id}`);
    revalidatePath("/orders/printer");
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelCustomerOrder(
  orderId: string,
): Promise<ActionResult<CustomerOrder>> {
  try {
    await requireApiPermission("placeOrder");
    const data = await cancelCustomerOrderRecord(orderId);
    revalidateInventory();
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders/printer");
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function completeCustomerOrderPick(
  orderId: string,
): Promise<ActionResult<CustomerOrder>> {
  try {
    const user = await requireApiPermission("fulfillOrder");
    const data = await completeCustomerOrderPickRecord(orderId, user.name);
    revalidateInventory();
    revalidatePath(`/orders/${orderId}`);
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function acknowledgeWarehousePrints(
  orderIds: string[],
): Promise<ActionResult<{ count: number }>> {
  try {
    await requireApiPermission("fulfillOrder");
    const count = await acknowledgeWarehousePrintsRecord(orderIds);
    revalidatePath("/orders");
    revalidatePath("/orders/printer");
    for (const orderId of orderIds) {
      revalidatePath(`/orders/${orderId}`);
    }
    return { ok: true, data: clientPayload({ count }) };
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
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function createRoom(rawData: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requireApiPermission("manageLocations");
    const data = await createRoomRecord(rawData);
    revalidatePath("/locations");
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function breakDownReceivingPallet(
  orderId: string,
  palletId: string,
): Promise<ActionResult<ReceivingOrder>> {
  try {
    await requireApiPermission("receive");
    const data = await breakDownPalletForCube(orderId, palletId);
    revalidateInventory();
    revalidatePath(`/receiving/${orderId}`);
    revalidatePath(`/putaway/${orderId}`);
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function saveItemCube(
  rawData: unknown,
): Promise<ActionResult<ItemCube>> {
  try {
    const user = await requireApiPermission("cube");
    const data = await saveItemCubeRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateLocationCapacity(
  rawData: unknown,
): Promise<ActionResult<Location>> {
  try {
    await requireApiPermission("manageLocations");
    const data = await updateLocationCapacityRecord(rawData);
    revalidateInventory();
    revalidatePath("/locations");
    revalidatePath("/cubing");
    return { ok: true, data: clientPayload(data) };
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
    return { ok: true, data: clientPayload(data) };
  } catch (error) {
    return fail(error);
  }
}

export async function moveInventory(
  rawData: unknown,
): Promise<
  ActionResult<{
    sku: string;
    quantity: number;
    sourceLocationCode: string;
    destinationLocationCode: string;
    referenceId: string;
  }>
> {
  try {
    const user = await requireApiPermission("moveInventory");
    const data = await moveInventoryRecord(withCreatedBy(rawData, user));
    revalidateInventory();
    return { ok: true, data: clientPayload(data) };
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
      data: clientPayload({ ...data, sourceText: replaySpreadsheetText(source, false) }),
    };
  } catch (error) {
    return {
      ...fail(error),
      sourceText: sanitizeDomText(replaySpreadsheetText(source, true)),
    };
  }
}
