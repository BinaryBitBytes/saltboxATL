import { NextResponse } from "next/server";
import {
  deletePhotoRecord,
  getPhotoRecord,
} from "@/backend/server/photo-service";
import { requireApiPermission, requireApiUser } from "@/backend/server/dal";
import { jsonError } from "@/backend/server/http";
import { extensionForMime } from "@/lib/photos/image";
import { permissionForPhotoWrite } from "@/lib/photos/owner";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    const { photo, bytes } = await getPhotoRecord(id);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${photo.id}.${extensionForMime(photo.mimeType)}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { photo } = await getPhotoRecord(id);
    await requireApiPermission(permissionForPhotoWrite(photo.ownerType));
    await deletePhotoRecord(id);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    return jsonError(error);
  }
}
