import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { readPdfGlyphs } from "@/lib/documents/pdf-layout";
import { rateAmountPriceBoxes, rateAmountSpans } from "@/lib/documents/positioned-po";

const PRICE_VALUE = /^\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})$/;

type Piece =
  | { kind: "text"; text: string; source: string }
  | { kind: "kern"; value: number; source: string };

/**
 * Black out numeric Rate and Amount cells on a real PDF.
 * Header words stay. Other columns stay. Returns null when those columns are absent.
 */
export async function redactPositionedPrices(bytes: Uint8Array): Promise<Uint8Array | null> {
  let glyphs;
  try {
    glyphs = await readPdfGlyphs(bytes);
  } catch {
    return null;
  }
  const spans = rateAmountSpans(glyphs);
  const boxes = rateAmountPriceBoxes(glyphs);
  if (spans.length === 0 || boxes.length === 0) return null;

  let document;
  try {
    document = await PDFDocument.load(bytes);
  } catch {
    return null;
  }

  let removed = 0;
  for (const page of document.getPages()) {
    for (const ref of contentRefs(page.node.Contents() as unknown)) {
      const stream = document.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      const edited = blankPriceRuns(decoded, spans);
      removed += edited.removed;
      if (edited.text === decoded) continue;
      const contents = new Uint8Array(Buffer.from(edited.text, "latin1"));
      const dict = stream.dict;
      dict.delete(PDFName.of("Filter"));
      dict.set(PDFName.of("Length"), PDFNumber.of(contents.byteLength));
      document.context.assign(ref, PDFRawStream.of(dict, contents));
    }
  }
  if (removed === 0) return null;

  const page = document.getPages()[0];
  if (page) {
    for (const box of boxes) {
      page.drawRectangle({
        x: box.x - 1,
        y: box.y - 2,
        width: Math.max(box.width + 2, 8),
        height: box.height + 3,
        color: rgb(0, 0, 0),
      });
    }
  }
  return document.save();
}

function contentRefs(contents: unknown): PDFRef[] {
  if (!contents || typeof contents !== "object") return [];
  if ("asArray" in contents && typeof contents.asArray === "function") {
    return contents.asArray() as PDFRef[];
  }
  return [contents as PDFRef];
}

function blankPriceRuns(
  stream: string,
  spans: ReadonlyArray<{ left: number; right: number }>,
): { text: string; removed: number } {
  let fontSize = 9;
  let removed = 0;
  const next = stream.replace(
    /(?:\/F\d+\s+([\d.]+)\s+Tf)|(?:([\d.]+)\s+([\d.]+)\s+Tm\s*\[([\s\S]*?)\]\s*TJ)/g,
    (full, font, tmX, _tmY, body: string | undefined) => {
      if (font) {
        fontSize = Number(font) || fontSize;
        return full;
      }
      if (!body || tmX == null) return full;
      const pieces = parsePieces(body);
      const blanked = blankRuns(pieces, Number(tmX), fontSize, spans);
      if (blanked.removed === 0) return full;
      removed += blanked.removed;
      return full.replace(`[${body}]`, `[${blanked.body}]`);
    },
  );
  return { text: next, removed };
}

function parsePieces(body: string): Piece[] {
  const pieces: Piece[] = [];
  const pattern = /<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)|\((?:\\.|[^\\)])*\)/g;
  for (const match of body.matchAll(pattern)) {
    if (match[1] != null) {
      pieces.push({ kind: "text", text: decodeHex(match[1]), source: match[0] });
    } else if (match[2] != null) {
      pieces.push({ kind: "kern", value: Number(match[2]), source: match[0] });
    } else {
      pieces.push({
        kind: "text",
        text: match[0].slice(1, -1).replace(/\\([()\\])/g, "$1"),
        source: match[0],
      });
    }
  }
  return pieces;
}

function blankRuns(
  pieces: Piece[],
  startX: number,
  fontSize: number,
  spans: ReadonlyArray<{ left: number; right: number }>,
): { body: string; removed: number } {
  let x = startX;
  let runText = "";
  let runStart = startX;
  let runIndexes: number[] = [];
  let removed = 0;
  const sources = pieces.map((piece) => piece.source);

  function flush() {
    const inColumn = spans.some((span) => runStart >= span.left - 8 && runStart < span.right + 8);
    if (PRICE_VALUE.test(runText) && inColumn) {
      for (const index of runIndexes) sources[index] = "<0020>";
      removed += 1;
    }
    runText = "";
    runIndexes = [];
  }

  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    if (!piece) continue;
    if (piece.kind === "kern") {
      if (Math.abs(piece.value) >= 1000) flush();
      x += (-piece.value / 1000) * fontSize;
      continue;
    }
    if (!runText) {
      runStart = x;
      runIndexes = [];
    }
    runText += piece.text;
    runIndexes.push(index);
    x += piece.text.length * fontSize * 0.5;
  }
  flush();
  return { body: sources.join(""), removed };
}

function decodeHex(hex: string): string {
  const pairs = hex.replace(/\s+/g, "").match(/[0-9A-Fa-f]{4}/g) ?? [];
  return pairs.map((pair) => String.fromCharCode(Number.parseInt(pair, 16))).join("");
}
