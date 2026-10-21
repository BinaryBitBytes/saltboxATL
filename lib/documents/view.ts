import type {
  PurchaseDocument,
  PurchaseDocumentKind,
} from "@/lib/inventory-schema";

export type PurchaseDocumentLineView = {
  sku: string;
  upc: string;
  description: string;
  quantity: number;
  unitPrice: string | null;
  extendedPrice: string | null;
};

export type PurchaseDocumentView = {
  id: string;
  purchaseOrderNumber: string;
  kind: PurchaseDocumentKind;
  originalName: string;
  recognitionNote: string;
  pricesRedacted: boolean;
  canOpenFile: boolean;
  canRedact: boolean;
  canImport: boolean;
  canDelete: boolean;
  imported: boolean;
  lines: PurchaseDocumentLineView[];
};

export function purchaseDocumentView(
  document: PurchaseDocument,
  access: { canOpenFile: boolean; canUpload: boolean; canSeePrices: boolean },
): PurchaseDocumentView {
  const showPrices =
    access.canSeePrices &&
    document.kind === "invoice" &&
    !document.pricesRedacted;
  return {
    id: document.id,
    purchaseOrderNumber: document.purchaseOrderNumber,
    kind: document.kind,
    originalName: document.originalName,
    recognitionNote: document.recognitionNote ?? "",
    pricesRedacted: document.pricesRedacted,
    canOpenFile: access.canOpenFile,
    canDelete: access.canUpload,
    canRedact: access.canUpload && document.kind === "invoice" && !document.pricesRedacted,
    canImport:
      access.canUpload &&
      document.kind === "invoice" &&
      document.pricesRedacted &&
      !document.inboundLoadId,
    imported: Boolean(document.inboundLoadId),
    lines: document.lines.map((line) => ({
      sku: line.sku,
      upc: line.upc,
      description: line.description,
      quantity: line.quantity,
      unitPrice: showPrices ? line.unitPrice : null,
      extendedPrice: showPrices ? line.extendedPrice : null,
    })),
  };
}
