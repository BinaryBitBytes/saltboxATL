import { getTransactionRows } from "@/backend/server/inventory-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    await requireApiPermission("viewTransactions");
    return jsonOk(await getTransactionRows());
  } catch (error) {
    return jsonError(error);
  }
}
