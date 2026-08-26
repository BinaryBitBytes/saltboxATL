import { NextResponse } from "next/server";
import { getInventoryRows } from "@/backend/server/inventory-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError } from "@/backend/server/http";
import {
  inventoryRowsToSpreadsheet,
  inventorySpreadsheetTemplate,
  spreadsheetFileName,
} from "@/lib/inventory/spreadsheet";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireApiPermission("viewInventory");
    const template = new URL(request.url).searchParams.get("template") === "1";
    const csv = template
      ? inventorySpreadsheetTemplate()
      : inventoryRowsToSpreadsheet(await getInventoryRows());
    const filename = spreadsheetFileName(template ? "template" : "inventory");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
