import { ValidationError } from "@/lib/validation/errors";

export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function serializeCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  options: { bom?: boolean } = {},
): string {
  const lines = [
    headers.map((header) => csvCell(header)).join(","),
    ...rows.map((row) =>
      row
        .map((cell) => csvCell(cell == null ? "" : String(cell)))
        .join(","),
    ),
  ];
  const body = `${lines.join("\r\n")}\r\n`;
  return options.bom ? `\uFEFF${body}` : body;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function firstLine(text: string): string {
  const end = text.search(/\r\n|\n|\r/);
  return end === -1 ? text : text.slice(0, end);
}

export function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  if (tabs > commas && tabs > semicolons) return "\t";
  if (semicolons > commas && semicolons > tabs) return ";";
  return ",";
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const source = stripBom(text);
  if (source.includes("\0")) {
    throw new ValidationError(
      "This file looks like a binary Excel workbook. In Excel or Google Sheets, save it as CSV UTF-8 and import that file.",
    );
  }
  if (!source.trim()) {
    throw new ValidationError("Spreadsheet is empty.");
  }

  const delimiter = detectDelimiter(firstLine(source));
  const records = parseRecords(source, delimiter);
  const nonempty = records.filter((record) =>
    record.some((cell) => cell.trim() !== ""),
  );
  if (nonempty.length === 0) {
    throw new ValidationError("Spreadsheet is empty.");
  }

  const [headerRow, ...dataRows] = nonempty;
  return {
    headers: headerRow.map((header) => header.trim()),
    rows: dataRows,
  };
}

function parseRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char === "\r") {
      if (text[index + 1] === "\n") continue;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (inQuotes) {
    throw new ValidationError("Spreadsheet has an unclosed quoted cell.");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
