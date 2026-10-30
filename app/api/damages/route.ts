import {
  createAdjustmentRecord,
  getDamageReport,
} from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    await requireApiPermission("damageInventory");
    return jsonOk(await getDamageReport());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiPermission("damageInventory");
    const body = await request.json();
    const payload = withCreatedBy(body, user);
    payload.type = "damage";
    const data = await createAdjustmentRecord(payload, "damage-report");
    return jsonOk(data, 201);
  } catch (error) {
    return jsonError(error);
  }
}
