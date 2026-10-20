import "server-only";

import {
  PhotoFileNameSchema,
  PurchaseDocumentKindSchema,
  PurchaseDocumentSchema,
  type PurchaseDocument,
  type PurchaseOrder,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import { PersonNameSchema } from "@/lib/validation/fields";
import { LIMITS } from "@/lib/validation/limits";
import {
  assertLargeInputConfirmed,
  sumQuantities,
  type LargeInputConfirmationInput,
} from "@/lib/validation/large-input";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { parseWithSchema } from "@/backend/server/safeParsing";
import { ServiceError } from "@/backend/server/inventory-service";
import { readSystem, updateSystem } from "@/backend/server/store";
import {
  deletePurchaseDocumentFile,
  readPurchaseDocumentFile,
  writePurchaseDocumentFile,
} from "@/backend/server/document-store";
import {
  blackOutPricingColumns,
  isPdf,
  pricingBlackoutTokens,
  redactPdfBytes,
} from "@/lib/documents/pdf-text";
import { recognizePurchasePdf } from "@/lib/documents/recognize";
import { assessComposioSetup, composioVisionClient } from "@/lib/documents/composio-vision";
import { applyRecognizedPurchase } from "@/lib/documents/apply";
import {
  INVOICE_ONLY,
  buildExpectedInboundLoad,
  invoiceImportError,
  receivableInvoiceLines,
  redactDocumentLines,
  stageExpectedReceivingOrder,
} from "@/lib/documents/inbound-load";
import { findPurchaseOrder } from "@/lib/purchase-orders";

export type PurchaseDocumentUpload = {
  bytes: Uint8Array;
  originalName?: string;
  kind: unknown;
  purchaseOrderNumber?: string | null;
  createdBy?: string;
};

export async function uploadPurchaseDocumentRecord(
  input: PurchaseDocumentUpload,
): Promise<{ document: PurchaseDocument; purchaseOrder: PurchaseOrder }> {
  if (input.bytes.byteLength > LIMITS.purchaseDocumentMaxBytes) {
    throw new ServiceError(
      `Each PDF must be ${Math.round(LIMITS.purchaseDocumentMaxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }
  if (!isPdf(input.bytes)) {
    throw new ServiceError("That file is not a PDF.");
  }
  const kindParsed = parseWithSchema(PurchaseDocumentKindSchema, input.kind);
  if (!kindParsed.success) {
    throw new ServiceError("Choose a purchase order or an invoice.");
  }
  const nameParsed = parseWithSchema(
    PhotoFileNameSchema,
    input.originalName?.trim() || "document.pdf",
  );
  const originalName = nameParsed.success ? nameParsed.data : "document.pdf";
  console.log("[composio] setup", assessComposioSetup());
  const recognized = await recognizePurchasePdf(input.bytes, {
    fileName: originalName,
    vision: composioVisionClient(),
    purchaseOrderNumber: input.purchaseOrderNumber,
  });
  if (!recognized.purchaseOrderNumber) {
    throw new ServiceError("The PDF did not include a purchase order number.");
  }

  const storedBytes = blackOutPricingColumns(
    input.bytes,
    pricingBlackoutTokens(recognized.lines),
  );
  const documentId = createId();
  const now = nowIso();
  const draft = {
    id: documentId,
    purchaseOrderNumber: recognized.purchaseOrderNumber,
    kind: kindParsed.data,
    originalName,
    mimeType: "application/pdf" as const,
    size: storedBytes.byteLength,
    pricesRedacted: true,
    recognitionSource: recognized.source,
    recognitionNote: recognized.note,
    jobIdNumber: recognized.jobIdNumber,
    lines: recognized.lines.slice(0, 200).map((line) => ({
      sku: line.sku,
      upc: line.upc,
      description: line.description,
      quantity: line.quantity,
      unitPrice: null,
      extendedPrice: null,
    })),
    createdAt: now,
    createdBy: input.createdBy,
  };
  const parsed = parseWithSchema(PurchaseDocumentSchema, draft);
  if (!parsed.success) {
    throw new ServiceError(parsed.error);
  }

  await writePurchaseDocumentFile(documentId, storedBytes);
  try {
    return await updateSystem((system) => {
      const purchaseOrder = applyRecognizedPurchase(system.purchaseOrders, recognized, {
        id: createId(),
        now,
        uploadedBy: input.createdBy,
        nextLineId: createId,
      });
      const receiver = PersonNameSchema.safeParse(input.createdBy);
      const expectedLines = receivableInvoiceLines(recognized.lines);
      const load = stageExpectedReceivingOrder(system.receivingOrders, {
        id: createId(),
        palletId: createId(),
        caseIds: expectedLines.map(() => createId()),
        now,
        purchaseOrderNumber: purchaseOrder.purchaseOrderNumber,
        vendor: purchaseOrder.vendor?.trim() || "Unspecified vendor",
        carrier: purchaseOrder.carrier?.trim() || "Unspecified carrier",
        palletCount: purchaseOrder.expectedPalletCount || 1,
        receiverName: receiver.success ? receiver.data : "Expected Receiver",
        createdBy: input.createdBy,
        lines: expectedLines,
        existingOrderNumbers: system.receivingOrders.map((order) => order.orderNumber),
      });
      if (load) parsed.data.inboundLoadId = load.id;
      if (!system.purchaseDocuments) system.purchaseDocuments = [];
      system.purchaseDocuments.unshift(parsed.data);
      return { document: parsed.data, purchaseOrder };
    });
  } catch (error) {
    await deletePurchaseDocumentFile(documentId);
    throw error;
  }
}

export async function getPurchaseDocumentFile(documentId: string): Promise<{
  document: PurchaseDocument;
  bytes: Uint8Array;
}> {
  const system = await readSystem();
  const document = (system.purchaseDocuments ?? []).find((entry) => entry.id === documentId);
  if (!document) {
    throw new ServiceError("Purchase document was not found.", 404);
  }
  return {
    document,
    bytes: await readPurchaseDocumentFile(document.id),
  };
}

export async function redactPurchaseDocumentRecord(
  documentId: string,
): Promise<PurchaseDocument> {
  const id = documentId.trim();
  const existing = (await readSystem()).purchaseDocuments?.find((entry) => entry.id === id);
  if (!existing) {
    throw new ServiceError("Purchase document was not found.", 404);
  }
  if (existing.kind !== "invoice") {
    throw new ServiceError(INVOICE_ONLY);
  }
  if (existing.pricesRedacted) return existing;
  const original = await readPurchaseDocumentFile(existing.id);
  await writePurchaseDocumentFile(existing.id, redactPdfBytes(original), true);
  return updateSystem((system) => {
    const document = (system.purchaseDocuments ?? []).find((entry) => entry.id === id);
    if (!document) {
      throw new ServiceError("Purchase document was not found.", 404);
    }
    document.pricesRedacted = true;
    document.lines = redactDocumentLines(document.lines);
    return document;
  });
}

export async function importInvoiceLoadRecord(
  documentId: string,
  confirmation?: LargeInputConfirmationInput,
  createdBy?: string,
): Promise<ReceivingOrder> {
  return updateSystem((system) => {
    const document = (system.purchaseDocuments ?? []).find(
      (entry) => entry.id === documentId.trim(),
    );
    if (!document) {
      throw new ServiceError("Purchase document was not found.", 404);
    }
    const importError = invoiceImportError(document);
    if (importError) {
      throw new ServiceError(importError);
    }
    if (document.inboundLoadId) {
      const existing = system.receivingOrders.find(
        (order) => order.id === document.inboundLoadId,
      );
      if (existing) return existing;
    }
    const purchaseOrder = findPurchaseOrder(
      system.purchaseOrders,
      document.purchaseOrderNumber,
    );
    if (!purchaseOrder) {
      throw new ServiceError("Upload the purchase order before importing the invoice.");
    }
    const lines = receivableInvoiceLines(document.lines);
    if (lines.length === 0) {
      throw new ServiceError("The invoice did not include lines that can be received.");
    }
    assertLargeInputConfirmed(
      sumQuantities(lines),
      confirmation,
      LIMITS.largeQuantity,
      "expected quantity",
    );
    const receiver = PersonNameSchema.safeParse(createdBy);
    const order = buildExpectedInboundLoad({
      id: createId(),
      palletId: createId(),
      caseIds: lines.map(() => createId()),
      now: nowIso(),
      purchaseOrderNumber: purchaseOrder.purchaseOrderNumber,
      vendor: purchaseOrder.vendor?.trim() || "Unspecified vendor",
      carrier: purchaseOrder.carrier?.trim() || "Unspecified carrier",
      palletCount: purchaseOrder.expectedPalletCount || 1,
      receiverName: receiver.success ? receiver.data : "Expected Receiver",
      createdBy,
      lines,
      existingOrderNumbers: system.receivingOrders.map((entry) => entry.orderNumber),
    });
    system.receivingOrders.unshift(order);
    document.inboundLoadId = order.id;
    return order;
  });
}
