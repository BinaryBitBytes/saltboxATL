import {
  addCaseToPallet,
  addPalletToOrder,
  completeReceivingOrder,
  getReceivingOrder,
  partialReceivingPalletRecord,
  removeCaseFromPallet,
  reopenReceivingOrder,
  updateCaseOnPallet,
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
      caseId?: string;
      confirmLargeInput?: boolean;
      confirmationQuantity?: number;
      acknowledgeBackorder?: boolean;
      expectedPalletCount?: number;
    };

    if (body.action === "add-pallet") {
      await requireApiPermission("receive");
      return jsonOk(await addPalletToOrder(id, body.pallet));
    }
    if (body.action === "add-case" && body.palletId) {
      await requireApiPermission("receive");
      return jsonOk(await addCaseToPallet(id, body.palletId, body.caseItem));
    }
    if (body.action === "update-case" && body.palletId && body.caseId) {
      await requireApiPermission("receive");
      return jsonOk(
        await updateCaseOnPallet(id, body.palletId, body.caseId, body.caseItem),
      );
    }
    if (body.action === "remove-case" && body.palletId && body.caseId) {
      await requireApiPermission("receive");
      return jsonOk(await removeCaseFromPallet(id, body.palletId, body.caseId));
    }
    if (body.action === "partial-pallet" && body.palletId) {
      const user = await requireApiPermission("receive");
      return jsonOk(await partialReceivingPalletRecord(id, body.palletId, user.name));
    }
    if (body.action === "complete") {
      await requireApiPermission("receive");
      return jsonOk(
        await completeReceivingOrder(id, {
          confirmLargeInput: body.confirmLargeInput,
          confirmationQuantity: body.confirmationQuantity,
          acknowledgeBackorder: body.acknowledgeBackorder,
        }),
      );
    }
    if (body.action === "reopen") {
      const user = await requireApiPermission("reopenReceiving");
      return jsonOk(
        await reopenReceivingOrder(
          id,
          user.name,
          typeof body.expectedPalletCount === "number"
            ? { expectedPalletCount: body.expectedPalletCount }
            : {},
        ),
      );
    }

    await requireApiPermission("receive");
    return jsonError(new ServiceError("Unsupported receiving action"));
  } catch (error) {
    return jsonError(error);
  }
}
