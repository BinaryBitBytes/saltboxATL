import { moveInventoryRecord } from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function POST(request: Request) {
  try {
    const user = await requireApiPermission("moveInventory");
    const body = await request.json();
    const data = await moveInventoryRecord(withCreatedBy(body, user));
    return jsonOk(data, 201);
  } catch (error) {
    return jsonError(error);
  }
}
