import { uploadPurchaseDocumentRecord } from "@/backend/server/document-service";
import { requireApiPermission } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";
import { LIMITS } from "@/lib/validation/limits";
import { ServiceError } from "@/backend/server/inventory-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireApiPermission("uploadBuyerOrders");
    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    const purchaseOrderNumber = form.get("purchaseOrderNumber");
    if (!(file instanceof File)) {
      throw new ServiceError("Choose a PDF purchase order or invoice.");
    }
    if (file.size > LIMITS.purchaseDocumentMaxBytes) {
      throw new ServiceError(
        `Each PDF must be ${Math.round(LIMITS.purchaseDocumentMaxBytes / (1024 * 1024))} MB or smaller.`,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await uploadPurchaseDocumentRecord({
      bytes,
      originalName: file.name,
      kind,
      purchaseOrderNumber:
        typeof purchaseOrderNumber === "string" ? purchaseOrderNumber : null,
      createdBy: user.name,
    });
    return jsonOk(saved, 201);
  } catch (error) {
    return jsonError(error);
  }
}
