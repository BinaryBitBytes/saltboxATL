import {
  createShippingOrderRecord,
  listSystem,
} from "@/backend/server/inventory-service";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET() {
  try {
    const system = await listSystem();
    return jsonOk(system.shippingOrders);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await createShippingOrderRecord(body);
    return jsonOk(data, 201);
  } catch (error) {
    return jsonError(error);
  }
}
