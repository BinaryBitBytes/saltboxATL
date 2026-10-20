import {
  ReceivingOrderSchema,
  type PurchaseDocumentLine,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import { slugFromDescription } from "@/lib/codes/product-codes";
import { LIMITS } from "@/lib/validation/limits";
import { isSku, isUpc } from "@/lib/validation/sanitize";
import { redactMoneyTokens } from "@/lib/documents/pdf-text";
import { expectedOrderNumber, uniqueOrderNumber } from "@/lib/documents/order-number";

export const IMPORT_REQUIRES_REDACTION =
  "Redact invoice prices before importing this inbound load.";

export const INVOICE_ONLY =
  "Only invoices can have prices redacted.";

export const INVOICE_IMPORT_ONLY =
  "Only an invoice can be imported into an inbound load.";

export function invoiceImportError(document: {
  kind: string;
  pricesRedacted: boolean;
}): string | null {
  if (document.kind !== "invoice") return INVOICE_IMPORT_ONLY;
  if (!document.pricesRedacted) return IMPORT_REQUIRES_REDACTION;
  return null;
}

export { expectedOrderNumber, uniqueOrderNumber };

export type ReceivableLine = {
  sku: string;
  upc: string;
  description: string;
  quantity: number;
};

/** Invoice rows that can land on an inbound load. Prices are not copied. */
export function receivableInvoiceLines(
  lines: readonly Pick<
    PurchaseDocumentLine,
    "sku" | "upc" | "description" | "quantity"
  >[],
): ReceivableLine[] {
  const receivable: ReceivableLine[] = [];
  for (const line of lines) {
    const description = line.description.trim().slice(0, LIMITS.description);
    const sku = isSku(line.sku)
      ? line.sku
      : isSku(slugFromDescription(description))
        ? slugFromDescription(description)
        : "";
    if (!sku || !Number.isInteger(line.quantity) || line.quantity < 1) continue;
    receivable.push({
      sku,
      upc: isUpc(line.upc) ? line.upc : "NA",
      description: description || sku,
      quantity: line.quantity,
    });
  }
  return receivable;
}

export function redactDocumentLines<T extends PurchaseDocumentLine>(lines: readonly T[]): T[] {
  return lines.map((line) => ({
    ...line,
    unitPrice: null,
    extendedPrice: null,
    description: line.description
      .replace(
        /(?:USD\s*)?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})*\.\d{2}\s*USD\b/gi,
        "",
      )
      .replace(/\s{2,}/g, " ")
      .trim(),
  }));
}

export function buildExpectedInboundLoad(input: {
  id: string;
  palletId: string;
  caseIds: string[];
  now: string;
  purchaseOrderNumber: string;
  vendor: string;
  carrier: string;
  palletCount: number;
  receiverName: string;
  createdBy?: string;
  lines: ReceivableLine[];
  existingOrderNumbers: readonly string[];
  notes?: string;
}): ReceivingOrder {
  const cases = input.lines.map((line, index) => ({
    id: input.caseIds[index] ?? input.caseIds[0],
    upc: line.upc,
    sku: line.sku,
    batch: null,
    quantityInCase: line.quantity,
    description: line.description,
    manufacturer: "",
    color: null,
    fiber: null,
    putawayRoomId: null,
    putawayLocationId: null,
    putawayPostedAt: null,
  }));
  const skuCount = new Set(cases.map((entry) => entry.sku)).size;
  const orderNumber = uniqueOrderNumber(
    expectedOrderNumber(input.purchaseOrderNumber),
    input.existingOrderNumbers,
  );
  return ReceivingOrderSchema.parse({
    id: input.id,
    poNumber: input.purchaseOrderNumber,
    receivedAt: input.now,
    vendor: input.vendor,
    orderNumber,
    carrierInbound: input.carrier,
    receiverName: input.receiverName,
    loadPalletCount: input.palletCount,
    status: "draft",
    intake: "expected",
    isPartialed: false,
    workingPalletId: input.palletId,
    pallets: [
      {
        id: input.palletId,
        palletNumber: "EXPECTED",
        trackingNumber: "",
        isPartial: false,
        partialedBy: null,
        expectedSkuCount: skuCount,
        actualSkuCount: skuCount,
        expectedCaseCount: cases.length,
        actualCaseCount: cases.length,
        cases,
        cubeRoute: null,
      },
    ],
    notes:
      input.notes ??
      "Expected inbound load imported from the invoice after prices were redacted.",
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.createdBy,
  });
}

/** Open one expected receiving load for a PO, with the parsed lines already on the pallet. */
export function stageExpectedReceivingOrder(
  receivingOrders: ReceivingOrder[],
  input: {
    id: string;
    palletId: string;
    caseIds: string[];
    now: string;
    purchaseOrderNumber: string;
    vendor: string;
    carrier: string;
    palletCount: number;
    receiverName: string;
    createdBy?: string;
    lines: ReceivableLine[];
    existingOrderNumbers: readonly string[];
  },
): ReceivingOrder | null {
  if (input.lines.length === 0) return null;
  const open = receivingOrders.find(
    (order) =>
      order.poNumber === input.purchaseOrderNumber &&
      order.status !== "cancelled" &&
      order.status !== "completed" &&
      order.status !== "received",
  );
  if (open) return open;
  const created = buildExpectedInboundLoad({
    ...input,
    notes: "Expected contents from the purchase PDF after Rate and Amount were blacked out.",
  });
  receivingOrders.unshift(created);
  return created;
}

export function pdfStillContainsPrices(bytes: Uint8Array): boolean {
  const raw = Buffer.from(bytes).toString("latin1");
  return raw !== redactMoneyTokens(raw);
}
