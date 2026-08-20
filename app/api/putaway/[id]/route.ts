import {
  assignPutawayLocation,
  completePutawayOrder,
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
    await requireApiPermission("putaway");
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
    await requireApiPermission("putaway");
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: string;
      palletId?: string;
      caseId?: string;
      putaway?: unknown;
      confirmLargeInput?: boolean;
      confirmationQuantity?: number;
    };

    if (body.action === "assign-location" && body.palletId && body.caseId) {
      return jsonOk(
        await assignPutawayLocation(id, body.palletId, body.caseId, body.putaway),
      );
    }
    if (body.action === "complete") {
      return jsonOk(
        await completePutawayOrder(id, {
          confirmLargeInput: body.confirmLargeInput,
          confirmationQuantity: body.confirmationQuantity,
        }),
      );
    }

    return jsonError(new ServiceError("Unsupported putaway action"));
  } catch (error) {
    return jsonError(error);
  }
}
