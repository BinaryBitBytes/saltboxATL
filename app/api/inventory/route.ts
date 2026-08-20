import {
  createAdjustmentRecord,
  getInventoryRows,
} from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    await requireApiPermission("viewInventory");
    return jsonOk(await getInventoryRows());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiPermission("adjustInventory");
    const body = await request.json();
    const data = await createAdjustmentRecord(withCreatedBy(body, user));
    return jsonOk(data, 201);
  } catch (error) {
    return jsonError(error);
  }
}
