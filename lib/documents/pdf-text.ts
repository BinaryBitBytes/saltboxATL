/** Pull visible text out of an uncompressed PDF and mask currency amounts. */

const MONEY =
  /(?:USD\s*)?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})*\.\d{2}\s*USD\b/gi;

const LITERAL = /\((?:\\.|[^\\)])*\)/g;

export function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const pieces: string[] = [];
  for (const match of raw.matchAll(LITERAL)) {
    const decoded = decodePdfLiteral(match[0].slice(1, -1));
    if (decoded && isMostlyText(decoded)) pieces.push(decoded);
  }
  return pieces.join("\n").slice(0, 100_000);
}

export function redactMoneyTokens(value: string): string {
  return value.replace(MONEY, (match) => "X".repeat(match.length));
}

/** Replace currency amounts without changing byte length, so the PDF xref stays valid. */
export function redactPdfBytes(bytes: Uint8Array): Uint8Array {
  const raw = Buffer.from(bytes).toString("latin1");
  const redacted = redactMoneyTokens(raw);
  return new Uint8Array(Buffer.from(redacted, "latin1"));
}

const PRICE_VALUE = /^\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})$/;

/** Numeric Rate and Price/Amount cell values. Header words are not included. */
export function pricingBlackoutTokens(
  lines: ReadonlyArray<{ unitPrice?: string | null; extendedPrice?: string | null }>,
): string[] {
  const tokens: string[] = [];
  for (const line of lines) {
    const rate = line.unitPrice?.trim() ?? "";
    const amount = line.extendedPrice?.trim() ?? "";
    if (PRICE_VALUE.test(rate)) tokens.push(rate);
    if (PRICE_VALUE.test(amount)) tokens.push(amount);
  }
  return tokens;
}

/**
 * Mask only the numeric Rate and Price/Amount values inside readable PDF text.
 * Other words, and bytes that are not readable text, stay as they are.
 * Replacements keep the same byte length so the PDF cross-reference table stays valid.
 */
export function blackOutPricingColumns(bytes: Uint8Array, tokens: readonly string[]): Uint8Array {
  const prices = tokens.map((token) => token.trim()).filter((token) => PRICE_VALUE.test(token));
  if (prices.length === 0) return bytes;
  const raw = Buffer.from(bytes).toString("latin1");
  const masked = maskPdfLiterals(raw, prices);
  return new Uint8Array(Buffer.from(masked, "latin1"));
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function maskPdfLiterals(raw: string, tokens: readonly string[]): string {
  const removable = [...new Set(tokens.map((token) => token.trim()).filter((token) => token.length > 0))]
    .sort((left, right) => right.length - left.length);
  if (removable.length === 0) return raw;
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "(") {
      out += raw[index];
      continue;
    }
    const end = findLiteralEnd(raw, index + 1);
    if (end < 0) {
      out += raw.slice(index);
      break;
    }
    const encoded = raw.slice(index + 1, end);
    const decoded = decodePdfLiteral(encoded);
    if (!isMostlyText(decoded)) {
      out += raw.slice(index, end + 1);
      index = end;
      continue;
    }
    const masked = maskTokens(decoded, removable);
    const reencoded = encodePdfLiteral(masked);
    if (masked !== decoded && reencoded.length === encoded.length) {
      out += `(${reencoded})`;
    } else {
      out += raw.slice(index, end + 1);
    }
    index = end;
  }
  return out;
}

function findLiteralEnd(raw: string, start: number): number {
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === ")") return index;
  }
  return -1;
}

function encodePdfLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function maskTokens(text: string, tokens: readonly string[]): string {
  let next = text;
  for (const token of tokens) {
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9])(${escapeRegExp(token)})(?=$|[^A-Za-z0-9])`,
      "g",
    );
    next = next.replace(pattern, (_full, prefix: string, match: string) => {
      return prefix + "#".repeat(match.length);
    });
  }
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodePdfLiteral(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value[(index += 1)];
    if (next == null) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (next >= "0" && next <= "7") {
      let octal = next;
      for (let extra = 0; extra < 2; extra += 1) {
        const digit = value[index + 1];
        if (digit == null || digit < "0" || digit > "7") break;
        octal += digit;
        index += 1;
      }
      out += String.fromCharCode(Number.parseInt(octal, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function isMostlyText(value: string): boolean {
  if (!value.trim() || value.length > 4_000) return false;
  let printable = 0;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) {
      printable += 1;
    }
  }
  return printable / value.length > 0.85;
}
