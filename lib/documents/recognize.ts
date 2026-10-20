import { JobIdNumberSchema } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { hasControlChars, hasHtmlMarkup } from "@/lib/validation/sanitize";
import { PersonNameSchema } from "@/lib/validation/fields";
import { extractPdfText } from "@/lib/documents/pdf-text";

export const COMPOSIO_NOTE = "Read with Composio image recognition.";
export const EMBEDDED_NOTE = "Read from text embedded in the PDF.";

export type RecognizedLine = {
  sku: string;
  upc: string;
  description: string;
  quantity: number;
  unitPrice: string | null;
  extendedPrice: string | null;
};

export type RecognizedPurchase = {
  purchaseOrderNumber: string | null;
  jobIdNumber: string | null;
  projectId: string | null;
  vendor: string | null;
  carrier: string | null;
  buyerName: string | null;
  expectedArrivalAt: string | null;
  expectedPalletCount: number | null;
  lines: RecognizedLine[];
  source: "composio" | "embedded-text";
  note: string;
};

export type VisionReadResult = {
  text: string | null;
  failure?: { message: string } | null;
};

export type VisionReader = (
  bytes: Uint8Array,
  fileName: string,
) => Promise<string | null | VisionReadResult>;

const LINE_PATTERN =
  /SKU:\s*([A-Za-z0-9._/-]+)\s+UPC:\s*([A-Za-z0-9-]+)\s+Description:\s*(.+?)\s+Qty:\s*(\d+)(?:\s+Unit Price:\s*(\$[\d,]+\.\d{2}|\d[\d,]*\.\d{2}))?(?:\s+(?:Amount|Extended):\s*(\$[\d,]+\.\d{2}|\d[\d,]*\.\d{2}))?/gi;

const ROW_PATTERN =
  /^([A-Za-z0-9][A-Za-z0-9._/-]{0,63})\s+([A-Za-z0-9-]{6,32})\s+(.+?)\s+(\d+)\s+(\$[\d,]+\.\d{2})\s+(\$[\d,]+\.\d{2})\s*$/gm;

export function emptyRecognition(): RecognizedPurchase {
  return {
    purchaseOrderNumber: null,
    jobIdNumber: null,
    projectId: null,
    vendor: null,
    carrier: null,
    buyerName: null,
    expectedArrivalAt: null,
    expectedPalletCount: null,
    lines: [],
    source: "embedded-text",
    note: EMBEDDED_NOTE,
  };
}

export function parsePurchaseFields(text: string): Omit<
  RecognizedPurchase,
  "source" | "note"
> {
  const purchaseOrderNumber = codeToken(
    labeled(text, [
      "PO Number",
      "P\\.O\\. Number",
      "Purchase Order Number",
      "Purchase Order",
      "PO #",
      "P\\.O\\.",
      "PO",
    ]),
    LIMITS.text,
  );
  const jobIdNumber = optionalJobId(
    codeToken(
      labeled(text, ["Job ID Number", "JobIDNumber", "Job ID", "Job #"]),
      LIMITS.code,
    ),
  );
  const projectId = optionalJobId(
    codeToken(labeled(text, ["Project ID", "Project #", "Project"]), LIMITS.code),
  );
  const vendor = prose(labeled(text, ["Vendor", "Supplier"]));
  const carrier = prose(labeled(text, ["Carrier", "Ship Via"]));
  const buyerName = optionalBuyer(prose(labeled(text, ["Buyer Name", "Buyer"])));
  const expectedArrivalAt = parseArrival(
    labeled(text, ["Expected Arrival", "Arrival", "ETA", "Ship Date"]),
  );
  const palletText = labeled(text, ["Expected Pallets", "Pallet Count", "Pallets"]);
  const palletMatch = palletText?.match(/\d+/);
  const expectedPalletCount = palletMatch
    ? clampCount(Number.parseInt(palletMatch[0], 10))
    : null;
  return {
    purchaseOrderNumber,
    jobIdNumber,
    projectId,
    vendor,
    carrier,
    buyerName,
    expectedArrivalAt,
    expectedPalletCount,
    lines: parseLines(text),
  };
}

export async function recognizePurchasePdf(
  bytes: Uint8Array,
  options?: {
    fileName?: string;
    vision?: VisionReader | null;
    purchaseOrderNumber?: string | null;
  },
): Promise<RecognizedPurchase> {
  const embedded = parsePurchaseFields(extractPdfText(bytes));
  let visionText: string | null = null;
  let failureMessage: string | null = null;
  if (options?.vision) {
    try {
      const read = await options.vision(bytes, options.fileName ?? "document.pdf");
      const parsed = readVisionResult(read);
      visionText = parsed.text;
      failureMessage = parsed.failureMessage;
    } catch (error) {
      visionText = null;
      failureMessage = error instanceof Error ? error.message : "Composio request failed.";
      console.log("[composio]", { step: "recognize-threw", message: failureMessage });
    }
  }
  const fromVision = visionText?.trim()
    ? parsePurchaseFields(visionText)
    : emptyRecognition();
  const merged = mergeFields(
    visionText?.trim() ? fromVision : emptyRecognition(),
    embedded,
  );
  const override = codeToken(options?.purchaseOrderNumber ?? null, LIMITS.text);
  if (override) merged.purchaseOrderNumber = override;
  const usedVision = Boolean(visionText?.trim());
  return {
    ...merged,
    source: usedVision ? "composio" : "embedded-text",
    note: recognitionNote(usedVision, failureMessage),
  };
}

function readVisionResult(value: string | null | VisionReadResult): {
  text: string | null;
  failureMessage: string | null;
} {
  if (value && typeof value === "object") {
    return {
      text: value.text,
      failureMessage: value.failure?.message ?? null,
    };
  }
  return { text: value, failureMessage: null };
}

function recognitionNote(usedVision: boolean, failureMessage: string | null): string {
  if (usedVision) return COMPOSIO_NOTE;
  if (!failureMessage) return EMBEDDED_NOTE;
  return `${EMBEDDED_NOTE} ${failureMessage}`
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F]/g, " ")
    .slice(0, 1800);
}

function mergeFields(
  primary: Omit<RecognizedPurchase, "source" | "note">,
  fallback: Omit<RecognizedPurchase, "source" | "note">,
): Omit<RecognizedPurchase, "source" | "note"> {
  return {
    purchaseOrderNumber: primary.purchaseOrderNumber ?? fallback.purchaseOrderNumber,
    jobIdNumber: primary.jobIdNumber ?? fallback.jobIdNumber,
    projectId: primary.projectId ?? fallback.projectId,
    vendor: primary.vendor ?? fallback.vendor,
    carrier: primary.carrier ?? fallback.carrier,
    buyerName: primary.buyerName ?? fallback.buyerName,
    expectedArrivalAt: primary.expectedArrivalAt ?? fallback.expectedArrivalAt,
    expectedPalletCount: primary.expectedPalletCount ?? fallback.expectedPalletCount,
    lines: primary.lines.length > 0 ? primary.lines : fallback.lines,
  };
}

function parseLines(text: string): RecognizedLine[] {
  const lines: RecognizedLine[] = [];
  for (const match of text.matchAll(LINE_PATTERN)) {
    pushLine(lines, match[1], match[2], match[3], match[4], match[5], match[6]);
  }
  for (const match of text.matchAll(ROW_PATTERN)) {
    pushLine(lines, match[1], match[2], match[3], match[4], match[5], match[6]);
  }
  return lines;
}

function pushLine(
  lines: RecognizedLine[],
  skuRaw: string | undefined,
  upcRaw: string | undefined,
  descriptionRaw: string | undefined,
  quantityRaw: string | undefined,
  unitRaw: string | undefined,
  extendedRaw: string | undefined,
) {
  const quantity = Number.parseInt(quantityRaw ?? "", 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > LIMITS.quantityMax) {
    return;
  }
  const sku = (skuRaw ?? "").trim().slice(0, LIMITS.sku);
  const upc = (upcRaw ?? "").trim().slice(0, LIMITS.upc);
  const description = (descriptionRaw ?? "").trim().replace(/\s+/g, " ").slice(0, LIMITS.description);
  if ((!sku && !description) || hasControlChars(sku + upc + description) || hasHtmlMarkup(description)) {
    return;
  }
  const line: RecognizedLine = {
    sku,
    upc: upc === "-" ? "" : upc,
    description,
    quantity,
    unitPrice: cleanPrice(unitRaw),
    extendedPrice: cleanPrice(extendedRaw),
  };
  const key = `${line.sku}|${line.upc}|${line.description}|${line.quantity}`;
  if (lines.some((entry) => `${entry.sku}|${entry.upc}|${entry.description}|${entry.quantity}` === key)) {
    return;
  }
  lines.push(line);
}

function cleanPrice(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 32 || hasControlChars(trimmed) || hasHtmlMarkup(trimmed)) {
    return null;
  }
  return trimmed;
}

function labeled(text: string, labels: string[]): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${labels.join("|")})\\s*[:#]\\s*([^\\n]+)`,
    "i",
  );
  const match = text.match(pattern);
  const value = match?.[1]?.trim().replace(/\s{2,}/g, " ") ?? "";
  return value || null;
}

function codeToken(value: string | null, max: number): string | null {
  if (!value) return null;
  const token = value.split(/\s+/)[0]?.replace(/[.,;:]+$/g, "") ?? "";
  if (!token || token.length > max || hasControlChars(token) || hasHtmlMarkup(token)) {
    return null;
  }
  return token;
}

function prose(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, LIMITS.text);
  if (!trimmed || hasControlChars(trimmed) || hasHtmlMarkup(trimmed)) return null;
  return trimmed;
}

function optionalJobId(value: string | null): string | null {
  if (!value) return null;
  const parsed = JobIdNumberSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function optionalBuyer(value: string | null): string | null {
  if (!value) return null;
  const parsed = PersonNameSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseArrival(value: string | null): string | null {
  if (!value) return null;
  const iso = value.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z/,
  );
  if (iso) {
    const date = new Date(iso[0]);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const day = value.match(/\d{4}-\d{2}-\d{2}/);
  if (!day) return null;
  const date = new Date(`${day[0]}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clampCount(value: number): number | null {
  if (!Number.isInteger(value) || value < 0 || value > LIMITS.quantityMax) return null;
  return value;
}
