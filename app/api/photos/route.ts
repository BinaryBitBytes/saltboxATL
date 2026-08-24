import {
  attachPhotoRecord,
  listPhotoRecords,
} from "@/backend/server/photo-service";
import { requireApiPermission, requireApiUser } from "@/backend/server/dal";
import { jsonError, jsonOk } from "@/backend/server/http";
import { PhotoOwnerTypeSchema } from "@/lib/inventory-schema";
import { permissionForPhotoWrite } from "@/lib/photos/owner";
import { LIMITS } from "@/lib/validation/limits";
import { ServiceError } from "@/backend/server/inventory-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const { searchParams } = new URL(request.url);
    const ownerTypeParsed = PhotoOwnerTypeSchema.safeParse(
      searchParams.get("ownerType"),
    );
    const ownerId = searchParams.get("ownerId")?.trim() ?? "";
    if (!ownerTypeParsed.success || !ownerId) {
      throw new ServiceError("ownerType and ownerId are required.");
    }
    return jsonOk(await listPhotoRecords(ownerTypeParsed.data, ownerId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const ownerType = form.get("ownerType");
    const ownerId = form.get("ownerId");
    const caption = form.get("caption");
    const documentKind = form.get("documentKind");
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new ServiceError("Choose a photo to attach.");
    }
    if (file.size > LIMITS.photoMaxBytes) {
      throw new ServiceError(
        `Each photo must be ${Math.round(LIMITS.photoMaxBytes / (1024 * 1024))} MB or smaller.`,
      );
    }

    const ownerTypeParsed = PhotoOwnerTypeSchema.safeParse(ownerType);
    if (!ownerTypeParsed.success) {
      throw new ServiceError("Choose a receiving order, shipment, or adjustment.");
    }

    const user = await requireApiPermission(
      permissionForPhotoWrite(ownerTypeParsed.data),
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const photo = await attachPhotoRecord({
      ownerType: ownerTypeParsed.data,
      ownerId,
      documentKind: typeof documentKind === "string" ? documentKind : "freight-proof",
      originalName: file.name,
      caption: typeof caption === "string" ? caption : "",
      bytes,
      createdBy: user.name,
    });
    return jsonOk(photo, 201);
  } catch (error) {
    return jsonError(error);
  }
}
