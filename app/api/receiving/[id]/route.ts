import {
  addCaseToPallet,
  addPalletToOrder,
  completeReceivingOrder,
  getReceivingOrder,
  ServiceError,
} from "@/backend/server/inventory-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiPermission("receive");
    const { id } = await context.params;
    const order = await getReceivingOrder(id);
    return jsonOk(order);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiPermission("receive");
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: string;
      palletId?: string;
      pallet?: unknown;
      caseItem?: unknown;
    };

    if (body.action === "add-pallet") {
      return jsonOk(await addPalletToOrder(id, body.pallet));
    }
    if (body.action === "add-case" && body.palletId) {
      return jsonOk(await addCaseToPallet(id, body.palletId, body.caseItem));
    }
    if (body.action === "complete") {
      return jsonOk(await completeReceivingOrder(id));
    }

    return jsonError(new ServiceError("Unsupported receiving action"));
  } catch (error) {
    return jsonError(error);
  }
}
