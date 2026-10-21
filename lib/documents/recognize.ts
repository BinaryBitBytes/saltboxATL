import { JobIdNumberSchema } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { hasControlChars, hasHtmlMarkup } from "@/lib/validation/sanitize";
import { PersonNameSchema } from "@/lib/validation/fields";
import { extractPdfText } from "@/lib/documents/pdf-text";
import { readPdfGlyphs } from "@/lib/documents/pdf-layout";
import { parsePositionedPurchase } from "@/lib/documents/positioned-po";

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
  shipTo: string | null;
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
  /SKU:\s*([A-Za-z0-9._/-]+)\s+UPC:\s*([A-Za-z0-9-]+)\s+Description:\s*(.+?)\s+Qty:\s*(\d+)(?:\s+(?:Unit Price|Rate):\s*(\$[\d,]+\.\d{2}|\d[\d,]*\.\d{2}))?(?:\s+(?:Amount|Extended):\s*(\$[\d,]+\.\d{2}|\d[\d,]*\.\d{2}))?/gi;

const MPN_LINE =
  /^(?:MPN|Manufacturer Part Number):\s*([A-Za-z0-9._/-]+)(?:\s+SKU:\s*[A-Za-z0-9._/-]+)?(?:\s+UPC:\s*([A-Za-z0-9-]+))?\s+Description:\s*(.+?)\s+Qty:\s*(\d+)(?:\s+(?:Rate|Unit Price):\s*(\$[\d,]+\.\d{2}|\d[\d,]*\.\d{2}))?(?:\s+(?:Amount|Extended(?: Amount)?|Line Amount):\s*(\$[\d,]+\.\d{2}|\d[\d,]*\.\d{2}))?\s*$/i;

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
    shipTo: null,
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
      labeled(text, [
        "Job ID Number",
        "JobIDNumber",
        "Job Number",
        "Job No\\.",
        "Job ID",
        "Job #",
      ]),
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
    shipTo: shipToSection(text),
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
  const positioned = await readPositionedFields(bytes);
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
    mergeFields(positioned ?? emptyRecognition(), embedded),
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

function hasCompressedPdfText(bytes: Uint8Array): boolean {
  const raw = Buffer.from(bytes).toString("latin1");
  return raw.includes("startxref") && raw.includes("/FlateDecode");
}

async function readPositionedFields(
  bytes: Uint8Array,
): Promise<Omit<RecognizedPurchase, "source" | "note"> | null> {
  if (!hasCompressedPdfText(bytes)) return null;
  try {
    return parsePositionedPurchase(await readPdfGlyphs(bytes));
  } catch (error) {
    console.log("[pdf] positioned read failed", {
      message: error instanceof Error ? error.message : "PDF text could not be positioned.",
    });
    return null;
  }
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
    shipTo: primary.shipTo ?? fallback.shipTo,
    lines: primary.lines.length > 0 ? primary.lines : fallback.lines,
  };
}

function parseLines(text: string): RecognizedLine[] {
  const lines: RecognizedLine[] = [];
  const rows = text.split(/\n/);
  const consumed = new Set<number>();
  rows.forEach((row, index) => {
    const match = row.match(MPN_LINE);
    if (!match) return;
    pushLine(lines, match[1], match[2], match[3], match[4], match[5], match[6]);
    consumed.add(index);
  });
  const table = parseTableLines(rows, consumed);
  for (const tableLine of table.lines) {
    pushLine(
      lines,
      tableLine.sku,
      tableLine.upc,
      tableLine.description,
      String(tableLine.quantity),
      tableLine.unitPrice ?? undefined,
      tableLine.extendedPrice ?? undefined,
    );
  }
  const remainder = rows.filter((_, index) => !consumed.has(index)).join("\n");
  for (const match of remainder.matchAll(LINE_PATTERN)) {
    pushLine(lines, match[1], match[2], match[3], match[4], match[5], match[6]);
  }
  if (!table.found) {
    for (const match of remainder.matchAll(ROW_PATTERN)) {
      pushLine(lines, match[1], match[2], match[3], match[4], match[5], match[6]);
    }
  }
  return lines;
}

const HEADER_PHRASES = [
  "manufacturer part number",
  "item description",
  "extended amount",
  "extended price",
  "line amount",
  "item number",
  "line number",
  "unit price",
  "unit rate",
  "ext amount",
  "ext price",
  "item no",
  "line no",
  "description",
  "quantity",
  "amount",
  "price",
  "total",
  "rate",
  "item",
  "line",
  "mpn",
  "sku",
  "upc",
  "qty",
  "ln",
  "no",
] as const;

type ColumnRole =
  | "mpn"
  | "sku"
  | "upc"
  | "description"
  | "quantity"
  | "rate"
  | "amount"
  | "index";

const SKU_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const UPC_TOKEN = /^[A-Za-z0-9-]{1,32}$/;
const LINE_NO = /^\d{1,4}$/;

function parseTableLines(
  rows: string[],
  consumed: Set<number>,
): { found: boolean; lines: RecognizedLine[] } {
  const headerIndex = rows.findIndex((row, index) => !consumed.has(index) && headerRoles(row));
  if (headerIndex < 0) return { found: false, lines: [] };
  const roles = headerRoles(rows[headerIndex]);
  if (!roles) return { found: false, lines: [] };
  consumed.add(headerIndex);
  const lines: RecognizedLine[] = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    if (consumed.has(index)) continue;
    const row = rows[index].trim();
    if (!row) continue;
    if (isNextField(row) || headerRoles(row)) break;
    const parsed = alignedTableRow(row, roles);
    if (!parsed) break;
    lines.push(parsed);
    consumed.add(index);
  }
  return { found: true, lines };
}

function headerRoles(row: string): ColumnRole[] | null {
  const cells = splitHeader(row);
  if (!cells) return null;
  const raw = cells.map(roleForHeader);
  if (raw.some((role) => role == null)) return null;
  const named = raw as Array<ColumnRole | "item">;
  const hasPart = named.includes("mpn") || named.includes("sku");
  let skuSeen = hasPart;
  const roles: ColumnRole[] = named.map((role) => {
    if (role !== "item") return role;
    if (!skuSeen) {
      skuSeen = true;
      return "sku";
    }
    return "index";
  });
  if (!roles.includes("quantity")) return null;
  if (!roles.some((role) => role === "mpn" || role === "sku" || role === "description")) {
    return null;
  }
  return roles;
}

function roleForHeader(cell: string): ColumnRole | "item" | null {
  switch (normalizeHeader(cell)) {
    case "mpn":
    case "manufacturer part number":
      return "mpn";
    case "sku":
      return "sku";
    case "upc":
      return "upc";
    case "description":
    case "item description":
      return "description";
    case "qty":
    case "quantity":
      return "quantity";
    case "rate":
    case "unit rate":
    case "unit price":
    case "price":
      return "rate";
    case "amount":
    case "line amount":
    case "ext amount":
    case "extended amount":
    case "ext price":
    case "extended price":
    case "total":
      return "amount";
    case "line":
    case "line no":
    case "line number":
    case "ln":
    case "no":
      return "index";
    case "item":
    case "item no":
    case "item number":
      return "item";
    default:
      return null;
  }
}

function splitHeader(row: string): string[] | null {
  const wide = splitWide(row);
  if (
    wide.length >= 3 &&
    wide.every((cell) => roleForHeader(cell) != null)
  ) {
    return wide;
  }
  const words = row
    .trim()
    .split(/\s+/)
    .filter((word) => normalizeHeader(word) !== "");
  const cells: string[] = [];
  for (let index = 0; index < words.length; ) {
    const phrase = HEADER_PHRASES.find((candidate) => {
      const parts = candidate.split(" ");
      return (
        words
          .slice(index, index + parts.length)
          .map(normalizeHeader)
          .join(" ") === candidate
      );
    });
    if (!phrase) return null;
    cells.push(phrase);
    index += phrase.split(" ").length;
  }
  return cells.length >= 3 ? cells : null;
}

function splitWide(row: string): string[] {
  if (row.includes("|")) return row.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (row.includes("\t")) return row.split("\t").map((cell) => cell.trim()).filter(Boolean);
  return row.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function alignedTableRow(row: string, roles: ColumnRole[]): RecognizedLine | null {
  const wide = splitWide(row);
  const atomic = wide.length === roles.length;
  const tokens = atomic ? wide : row.split(/\s+/).filter(Boolean);
  const descriptionColumns = roles.filter((role) => role === "description").length;
  if (descriptionColumns > 1) return null;
  if (atomic || descriptionColumns === 0) {
    if (tokens.length !== roles.length) return null;
  } else if (tokens.length < roles.length) {
    return null;
  }
  const descriptionWidth = descriptionColumns === 0 ? 0 : tokens.length - (roles.length - 1);
  if (descriptionColumns === 1 && descriptionWidth < 1) return null;

  let cursor = 0;
  const values: Partial<Record<ColumnRole, string>> = {};
  for (const role of roles) {
    if (role === "description") {
      values.description = tokens.slice(cursor, cursor + descriptionWidth).join(" ");
      cursor += descriptionWidth;
      continue;
    }
    const token = tokens[cursor] ?? "";
    cursor += 1;
    if (role === "index") {
      if (!LINE_NO.test(token)) return null;
      continue;
    }
    values[role] = token;
  }
  if (cursor !== tokens.length) return null;

  const quantity = Number.parseInt((values.quantity ?? "").replace(/,/g, ""), 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > LIMITS.quantityMax) return null;
  if (roles.includes("rate") && !isMoney(values.rate)) return null;
  if (roles.includes("amount") && !isMoney(values.amount)) return null;

  const sku = (values.mpn || values.sku || "").trim();
  if ((roles.includes("mpn") || roles.includes("sku")) && !SKU_TOKEN.test(sku)) return null;
  const upc = (values.upc ?? "").trim();
  if (roles.includes("upc") && upc && upc !== "-" && !UPC_TOKEN.test(upc)) return null;
  const description = (values.description ?? "").replace(/\s+/g, " ").trim();
  if (description && isMoney(description)) return null;
  if (!sku && !description) return null;

  return {
    sku,
    upc: upc === "-" ? "" : upc,
    description,
    quantity,
    unitPrice: values.rate ?? null,
    extendedPrice: values.amount ?? null,
  };
}

function isMoney(value: string | undefined): boolean {
  return Boolean(value && /^\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})$/.test(value));
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.#:$]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function shipToSection(text: string): string | null {
  const rows = text.split(/\n/);
  const start = rows.findIndex((row) => /^\s*ship\s*to\s*:?/i.test(row));
  if (start < 0) return null;
  const inline = rows[start].replace(/^\s*ship\s*to\s*:?\s*/i, "").trim();
  const collected: string[] = [];
  if (inline) collected.push(inline);
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index].trim();
    if (!row || isNextField(row) || headerRoles(row)) break;
    collected.push(row);
  }
  const value = collected.join("\n").trim().slice(0, LIMITS.notes);
  if (!value || hasControlChars(value) || hasHtmlMarkup(value)) return null;
  return value;
}

function isNextField(row: string): boolean {
  return (
    /^(?:vendor|supplier|carrier|ship via|buyer|expected|arrival|eta|pallets|pallet count|project|upc|sku|mpn|manufacturer part number)\s*:/i.test(
      row,
    ) ||
    /^(?:p\.?\s*o\.?|purchase order)\b[^:\n]*:/i.test(row) ||
    /^job\b[^:\n]*:/i.test(row)
  );
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
  const inline = match?.[1]?.trim().replace(/\s{2,}/g, " ") ?? "";
  if (inline) return inline;
  const wanted = new Set(labels.map((label) => normalizeHeader(label.replace(/\\/g, ""))));
  const rows = text.split(/\n/);
  for (let index = 0; index < rows.length; index += 1) {
    const label = normalizeHeader(rows[index] ?? "");
    if (!wanted.has(label)) continue;
    for (let next = index + 1; next < rows.length; next += 1) {
      const value = (rows[next] ?? "").trim().replace(/\s{2,}/g, " ");
      if (!value) continue;
      if (wanted.has(normalizeHeader(value)) || isNextField(value) || headerRoles(value)) {
        return null;
      }
      return value;
    }
  }
  return null;
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
