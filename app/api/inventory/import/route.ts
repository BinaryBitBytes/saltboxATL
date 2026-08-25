import { importInventorySpreadsheet } from "@/backend/server/inventory-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";
import { ServiceError } from "@/backend/server/inventory-service";
import { LIMITS } from "@/lib/validation/limits";
import type { SpreadsheetImportMode } from "@/lib/inventory/spreadsheet";

export const runtime = "nodejs";

function parseMode(value: FormDataEntryValue | null): SpreadsheetImportMode {
  if (value === "add") return "add";
  return "set";
}

function parseFlag(value: FormDataEntryValue | null): boolean {
  return value === "1" || value === "true" || value === "on";
}

async function spreadsheetTextFromForm(form: FormData): Promise<string> {
  const pasted = form.get("text");
  if (typeof pasted === "string" && pasted.trim()) {
    return pasted;
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ServiceError("Choose a CSV spreadsheet or paste rows to import.");
  }
  if (file.size === 0) {
    throw new ServiceError("The spreadsheet file is empty.");
  }
  if (file.size > LIMITS.spreadsheetMaxBytes) {
    throw new ServiceError(
      `Spreadsheet must be ${Math.round(LIMITS.spreadsheetMaxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    throw new ServiceError(
      "Save the workbook as CSV UTF-8 (Excel: File → Save As → CSV UTF-8) and import that file.",
    );
  }
  return file.text();
}

export async function POST(request: Request) {
  try {
    const user = await requireApiPermission("adjustInventory");
    const form = await request.formData();
    const text = await spreadsheetTextFromForm(form);
    if (text.length > LIMITS.spreadsheetMaxBytes) {
      throw new ServiceError(
        `Spreadsheet must be ${Math.round(LIMITS.spreadsheetMaxBytes / (1024 * 1024))} MB or smaller.`,
      );
    }

    const confirmationRaw = form.get("confirmationQuantity");
    const confirmationQuantity =
      typeof confirmationRaw === "string" && confirmationRaw.trim()
        ? Number(confirmationRaw)
        : undefined;

    const data = await importInventorySpreadsheet({
      text,
      mode: parseMode(form.get("mode")),
      dryRun: parseFlag(form.get("dryRun")),
      createdBy: user.name,
      confirmLargeInput: parseFlag(form.get("confirmLargeInput")),
      confirmationQuantity: Number.isFinite(confirmationQuantity)
        ? confirmationQuantity
        : undefined,
    });
    return jsonOk(data);
  } catch (error) {
    return jsonError(error);
  }
}
