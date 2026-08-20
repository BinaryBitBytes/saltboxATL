import { getInventoryRows } from "@/backend/server/inventory-service";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    return jsonOk(await getInventoryRows());
  } catch (error) {
    return jsonError(error);
  }
}
