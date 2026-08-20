import { getTransactionRows } from "@/backend/server/inventory-service";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    return jsonOk(await getTransactionRows());
  } catch (error) {
    return jsonError(error);
  }
}
