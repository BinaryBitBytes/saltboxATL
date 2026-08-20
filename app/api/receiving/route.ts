import {
  createReceivingOrderRecord,
  listSystem,
} from "@/backend/server/inventory-service";
import { requireApiPermission, withCreatedBy } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    await requireApiPermission("receive");
    const system = await listSystem();
    return jsonOk(system.receivingOrders);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiPermission("receive");
    const body = await request.json();
    const data = await createReceivingOrderRecord(withCreatedBy(body, user));
    return jsonOk(data, 201);
  } catch (error) {
    return jsonError(error);
  }
}
