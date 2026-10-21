import type { RecognizedLine, RecognizedPurchase } from "@/lib/documents/recognize";
import { LIMITS } from "@/lib/validation/limits";
import type { PdfGlyph } from "@/lib/documents/pdf-layout";

const PRICE_VALUE = /^\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})$/;

type ColumnRole = "mpn" | "sku" | "item" | "upc" | "description" | "quantity" | "rate" | "amount" | "skip";

type Span = {
  role: ColumnRole;
  left: number;
  right: number;
};

const SKU_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.#:$]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function columnRole(text: string): ColumnRole | null {
  switch (normalizeLabel(text)) {
    case "mpn":
    case "manufacturer part number":
      return "mpn";
    case "sku":
      return "sku";
    case "item":
    case "item no":
    case "item number":
      return "item";
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
    case "manufacturer":
      return "skip";
    default:
      return null;
  }
}

function clusterRows(glyphs: readonly PdfGlyph[]): PdfGlyph[][] {
  const sorted = [...glyphs].sort((left, right) => right.y - left.y || left.x - right.x);
  const rows: PdfGlyph[][] = [];
  for (const glyph of sorted) {
    const row = rows.find((entry) => Math.abs(entry[0].y - glyph.y) <= 1.8);
    if (row) row.push(glyph);
    else rows.push([glyph]);
  }
  for (const row of rows) row.sort((left, right) => left.x - right.x);
  return rows;
}

function headerSpans(row: readonly PdfGlyph[]): Span[] | null {
  const roles = row.map((glyph) => ({ glyph, role: columnRole(glyph.text) }));
  if (roles.some((entry) => entry.role == null)) return null;
  const known = roles as Array<{ glyph: PdfGlyph; role: ColumnRole }>;
  if (!known.some((entry) => entry.role === "quantity")) return null;
  if (!known.some((entry) => entry.role === "rate" || entry.role === "amount")) return null;
  if (!known.some((entry) => entry.role === "mpn" || entry.role === "sku" || entry.role === "item" || entry.role === "description")) {
    return null;
  }
  const sorted = [...known].sort((left, right) => left.glyph.x - right.glyph.x);
  return sorted.map((entry, index) => {
    const center = entry.glyph.x + entry.glyph.width / 2;
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const previousCenter = previous
      ? previous.glyph.x + previous.glyph.width / 2
      : entry.glyph.x - 12;
    const nextCenter = next ? next.glyph.x + next.glyph.width / 2 : center + 90;
    return {
      role: entry.role,
      left: index === 0 ? entry.glyph.x - 8 : (previousCenter + center) / 2,
      right: index === sorted.length - 1 ? entry.glyph.x + entry.glyph.width + 80 : (center + nextCenter) / 2,
    };
  });
}

function spanFor(spans: readonly Span[], glyph: PdfGlyph): Span | null {
  const center = glyph.x + glyph.width / 2;
  return spans.find((span) => center >= span.left && center < span.right) ?? null;
}

function valueUnder(glyphs: readonly PdfGlyph[], label: PdfGlyph): string | null {
  const labelRight = label.x + Math.max(label.width, 36);
  const candidates = glyphs
    .filter(
      (glyph) =>
        glyph !== label &&
        glyph.y < label.y - 2 &&
        glyph.y > label.y - 30 &&
        glyph.x + glyph.width / 2 >= label.x - 16 &&
        glyph.x < labelRight + 36,
    )
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const value = candidates[0]?.text.trim() ?? "";
  return value || null;
}

function shipToBlock(glyphs: readonly PdfGlyph[], label: PdfGlyph): string | null {
  const lines = glyphs
    .filter(
      (glyph) =>
        glyph !== label &&
        glyph.y < label.y - 2 &&
        glyph.x >= label.x - 16 &&
        glyph.x < label.x + 280,
    )
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const collected: string[] = [];
  let previousY = label.y;
  for (const line of lines) {
    if (previousY - line.y > 22) break;
    if (columnRole(line.text) || normalizeLabel(line.text) === "job number") break;
    collected.push(line.text.trim());
    previousY = line.y;
  }
  const value = collected.join("\n").trim().slice(0, LIMITS.notes);
  return value || null;
}

function findLabel(glyphs: readonly PdfGlyph[], names: readonly string[]): PdfGlyph | null {
  const wanted = new Set(names);
  return glyphs.find((glyph) => wanted.has(normalizeLabel(glyph.text))) ?? null;
}

/** Read a QuickBooks-style purchase order from positioned text. */
export function parsePositionedPurchase(
  glyphs: readonly PdfGlyph[],
): Omit<RecognizedPurchase, "source" | "note"> | null {
  if (glyphs.length === 0) return null;
  const rows = clusterRows(glyphs);
  const header = rows
    .map((row) => ({ row, spans: headerSpans(row) }))
    .find((entry) => entry.spans);
  const poLabel = findLabel(glyphs, ["p o no", "po no", "po number", "purchase order number"]);
  const vendorLabel = findLabel(glyphs, ["vendor", "supplier"]);
  const jobLabel = findLabel(glyphs, ["job number", "job no", "job id", "job id number"]);
  const shipLabel = findLabel(glyphs, ["ship to"]);
  if (!header?.spans && !poLabel && !vendorLabel && !jobLabel) return null;

  const lines: RecognizedLine[] = [];
  if (header?.spans) {
    const headerY = header.row[0]?.y ?? 0;
    const body = rows.filter((row) => (row[0]?.y ?? 0) < headerY - 2);
    let previousY = headerY;
    let leadingDescription = "";
    for (const row of body) {
      const rowY = row[0]?.y ?? 0;
      if (previousY - rowY > 28 && lines.length > 0) break;
      previousY = rowY;
      const cells: Partial<Record<ColumnRole, string>> = {};
      for (const glyph of row) {
        const span = spanFor(header.spans, glyph);
        if (!span || span.role === "skip") continue;
        const current = cells[span.role];
        cells[span.role] = current ? `${current} ${glyph.text}` : glyph.text;
      }
      const quantity = Number.parseInt((cells.quantity ?? "").replace(/,/g, ""), 10);
      const description = (cells.description ?? "").replace(/\s+/g, " ").trim();
      if (!Number.isInteger(quantity) || quantity < 1) {
        if (!description) continue;
        if (lines.length > 0) {
          const previous = lines[lines.length - 1];
          if (previous) previous.description = `${previous.description} ${description}`.trim();
        } else {
          leadingDescription = `${leadingDescription} ${description}`.trim();
        }
        continue;
      }
      const fullDescription = `${leadingDescription} ${description}`.trim();
      leadingDescription = "";
      const sku = (cells.mpn || cells.sku || cells.item || "").trim();
      if (sku && !SKU_TOKEN.test(sku) && !sku.includes(" ")) continue;
      if (!sku && !fullDescription) continue;
      const rate = cells.rate?.trim() ?? "";
      const amount = cells.amount?.trim() ?? "";
      lines.push({
        sku,
        upc: (cells.upc ?? "").trim(),
        description: fullDescription.slice(0, LIMITS.description),
        quantity,
        unitPrice: PRICE_VALUE.test(rate) ? rate : null,
        extendedPrice: PRICE_VALUE.test(amount) ? amount : null,
      });
    }
  }

  const purchaseOrderNumber = poLabel ? valueUnder(glyphs, poLabel)?.split(/\s+/)[0] ?? null : null;
  const vendor = vendorLabel ? valueUnder(glyphs, vendorLabel) : null;
  const jobIdNumber = jobLabel ? valueUnder(glyphs, jobLabel)?.split(/\s+/)[0] ?? null : null;
  return {
    purchaseOrderNumber,
    jobIdNumber,
    projectId: null,
    vendor,
    carrier: null,
    buyerName: null,
    expectedArrivalAt: null,
    expectedPalletCount: null,
    shipTo: shipLabel ? shipToBlock(glyphs, shipLabel) : null,
    lines,
  };
}

export type PriceBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Money glyphs that sit in a Rate or Amount column, including that column's total. */
export function rateAmountPriceBoxes(glyphs: readonly PdfGlyph[]): PriceBox[] {
  const header = clusterRows(glyphs)
    .map((row) => headerSpans(row))
    .find((spans) => spans?.some((span) => span.role === "rate" || span.role === "amount"));
  if (!header) return [];
  const moneySpans = header.filter((span) => span.role === "rate" || span.role === "amount");
  return glyphs
    .filter((glyph) => PRICE_VALUE.test(glyph.text) && moneySpans.some((span) => {
      const center = glyph.x + glyph.width / 2;
      return center >= span.left && center < span.right;
    }))
    .map((glyph) => ({
      text: glyph.text,
      x: glyph.x,
      y: glyph.y,
      width: glyph.width,
      height: glyph.height,
    }));
}

export function rateAmountSpans(glyphs: readonly PdfGlyph[]): Array<{ left: number; right: number }> {
  const header = clusterRows(glyphs)
    .map((row) => headerSpans(row))
    .find((spans) => spans?.some((span) => span.role === "rate" || span.role === "amount"));
  if (!header) return [];
  return header
    .filter((span) => span.role === "rate" || span.role === "amount")
    .map((span) => ({ left: span.left, right: span.right }));
}
