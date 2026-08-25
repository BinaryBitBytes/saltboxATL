import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

export function assertSpreadsheetSize(size: number): void {
  if (size > LIMITS.spreadsheetMaxBytes) {
    throw new ValidationError(
      `Spreadsheet must be ${Math.round(LIMITS.spreadsheetMaxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }
}

export async function spreadsheetTextFromForm(form: FormData): Promise<string> {
  const pasted = form.get("text");
  if (typeof pasted === "string" && pasted.trim()) {
    const text = pasted.trim();
    assertSpreadsheetSize(Buffer.byteLength(text, "utf8"));
    return text;
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("Choose a CSV spreadsheet or paste rows to import.");
  }
  if (file.size === 0) {
    throw new ValidationError("The spreadsheet file is empty.");
  }
  assertSpreadsheetSize(file.size);

  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    throw new ValidationError(
      "Save the workbook as CSV UTF-8 (Excel: File → Save As → CSV UTF-8) and import that file.",
    );
  }

  const text = await file.text();
  assertSpreadsheetSize(Buffer.byteLength(text, "utf8"));
  return text;
}
