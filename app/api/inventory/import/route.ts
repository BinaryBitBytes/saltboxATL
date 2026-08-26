import { importInventorySpreadsheet } from "@/backend/server/inventory-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";
import { spreadsheetTextFromForm } from "@/lib/inventory/spreadsheet-source";
import type { SpreadsheetImportMode } from "@/lib/inventory/spreadsheet";

export const runtime = "nodejs";

function parseMode(value: FormDataEntryValue | null): SpreadsheetImportMode {
  if (value === "add") return "add";
  return "set";
}

function parseFlag(value: FormDataEntryValue | null): boolean {
  return value === "1" || value === "true" || value === "on";
}

export async function POST(request: Request) {
  try {
    const user = await requireApiPermission("adjustInventory");
    const form = await request.formData();
    const { text } = await spreadsheetTextFromForm(form);

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
