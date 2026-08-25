import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

export function assertSpreadsheetSize(size: number): void {
  if (size > LIMITS.spreadsheetMaxBytes) {
    throw new ValidationError(
      `Spreadsheet must be ${Math.round(LIMITS.spreadsheetMaxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }
}

export type SpreadsheetFormText = {
  text: string;
  source: "paste" | "file";
};

export function replaySpreadsheetText(input: SpreadsheetFormText, failed: boolean): string {
  if (failed && input.source === "file") return "";
  return input.text;
}

export async function spreadsheetTextFromForm(
  form: FormData,
): Promise<SpreadsheetFormText> {
  const file = form.get("file");
  // A file chosen on this submit wins. The Inventory form remounts the file
  // input after each result so leftover selections do not override paste edits.
  if (file instanceof File && file.size > 0) {
    return { text: await spreadsheetTextFromUpload(file), source: "file" };
  }

  const pasted = form.get("text");
  if (typeof pasted === "string" && pasted.trim()) {
    const text = pasted.trim();
    assertSpreadsheetSize(Buffer.byteLength(text, "utf8"));
    return { text, source: "paste" };
  }

  if (file instanceof File) {
    throw new ValidationError("The spreadsheet file is empty.");
  }
  throw new ValidationError("Choose a CSV spreadsheet or paste rows to import.");
}

async function spreadsheetTextFromUpload(file: File): Promise<string> {
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
