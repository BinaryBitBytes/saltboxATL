import type { BuyerPoLine, PurchaseOrder } from "@/lib/inventory-schema";
import { findPurchaseOrder, saveBuyerPurchaseOrder } from "@/lib/purchase-orders";
import { LIMITS } from "@/lib/validation/limits";
import { hasControlChars, hasHtmlMarkup, isSku, isUpc } from "@/lib/validation/sanitize";
import type { RecognizedLine, RecognizedPurchase } from "@/lib/documents/recognize";

/**
 * Write recognized header and line fields onto the inbound purchase order.
 * Prices stay off the purchase order. An existing project-manager job ID is kept.
 */
export function applyRecognizedPurchase(
  purchaseOrders: PurchaseOrder[],
  recognized: RecognizedPurchase,
  input: {
    id: string;
    now: string;
    uploadedBy?: string;
    nextLineId: () => string;
  },
): PurchaseOrder {
  const purchaseOrderNumber = recognized.purchaseOrderNumber;
  if (!purchaseOrderNumber) {
    throw new Error("The PDF did not include a purchase order number.");
  }
  const existing = findPurchaseOrder(purchaseOrders, purchaseOrderNumber);
  const incoming = buyerLinesFromRecognition(recognized.lines, input.nextLineId);
  const lines =
    incoming.length > 0
      ? incoming
      : existing?.lines && existing.lines.length > 0
        ? existing.lines
        : [];
  const status =
    existing?.expectationStatus === "in-transit"
      ? "in-transit"
      : existing?.expectationStatus === "cancelled" && incoming.length === 0
        ? "cancelled"
        : "expected";
  const saved = saveBuyerPurchaseOrder(purchaseOrders, {
    id: input.id,
    purchaseOrderNumber,
    generatedAt: recognized.expectedArrivalAt || existing?.expectedArrivalAt || input.now,
    createdAt: existing?.createdAt ?? input.now,
    projectId: recognized.projectId ?? existing?.projectId ?? null,
    vendor: recognized.vendor || existing?.vendor || "Unspecified vendor",
    carrier: recognized.carrier || existing?.carrier || "Unspecified carrier",
    expectedArrivalAt:
      recognized.expectedArrivalAt || existing?.expectedArrivalAt || input.now,
    buyerName: recognized.buyerName || existing?.buyerName || undefined,
    notes: associateNotes(recognized, existing?.expectationNotes),
    expectationStatus: status,
    expectedPalletCount:
      recognized.expectedPalletCount ?? existing?.expectedPalletCount ?? 0,
    lines,
    uploadedBy: input.uploadedBy ?? existing?.uploadedBy,
  });
  if (!saved.jobIdNumber && recognized.jobIdNumber) {
    saved.jobIdNumber = recognized.jobIdNumber;
  }
  return saved;
}

export type InboundReviewDraft = {
  purchaseOrderNumber: string;
  vendor: string;
  jobIdNumber: string;
  notes: string;
  lines: Array<{
    sku: string;
    upc: string;
    description: string;
    quantity: number;
  }>;
};

/** Fields for the inbound form. The user reviews these before the PO is saved. */
export function inboundReviewFromRecognition(
  recognized: RecognizedPurchase,
): InboundReviewDraft {
  return {
    purchaseOrderNumber: recognized.purchaseOrderNumber ?? "",
    vendor: recognized.vendor ?? "",
    jobIdNumber: recognized.jobIdNumber ?? "",
    notes: recognized.shipTo ?? "",
    lines: buyerLinesFromRecognition(recognized.lines, () => "00000000-0000-4000-8000-000000000001").map(
      (line) => ({
        sku: line.sku,
        upc: line.upc,
        description: line.description,
        quantity: line.quantity,
      }),
    ),
  };
}

export function buyerLinesFromRecognition(
  lines: RecognizedLine[],
  nextLineId: () => string,
): BuyerPoLine[] {
  const buyerLines: BuyerPoLine[] = [];
  for (const line of lines) {
    const description = cleanDescription(
      stripKnownPrices(line.description, [line.unitPrice, line.extendedPrice]),
    );
    const sku = skuFromRecognition(line.sku);
    const upc = isUpc(line.upc) ? line.upc : "";
    if (!sku && !description) continue;
    if (!Number.isInteger(line.quantity) || line.quantity < 1) continue;
    buyerLines.push({
      id: nextLineId(),
      sku,
      upc,
      description,
      quantity: line.quantity,
    });
  }
  return buyerLines;
}

function associateNotes(
  recognized: RecognizedPurchase,
  existingNotes: string | undefined,
): string {
  const base = recognized.shipTo || existingNotes || recognized.note;
  const prices = recognized.lines.flatMap((line) => [line.unitPrice, line.extendedPrice]);
  return stripKnownPrices(base, prices) || recognized.note;
}

function stripKnownPrices(value: string, prices: Array<string | null>): string {
  const removable = prices
    .filter((price): price is string => Boolean(price))
    .sort((left, right) => right.length - left.length);
  let next = value;
  for (const price of removable) {
    next = next.split(price).join(" ");
  }
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function skuFromRecognition(value: string): string {
  const trimmed = value.trim();
  if (isSku(trimmed)) return trimmed;
  const hyphenated = trimmed.replace(/\s+/g, "-");
  return isSku(hyphenated) ? hyphenated : "";
}

function cleanDescription(value: string): string {
  const trimmed = value.trim().slice(0, LIMITS.description);
  if (!trimmed || hasControlChars(trimmed) || hasHtmlMarkup(trimmed)) return "";
  return trimmed;
}
