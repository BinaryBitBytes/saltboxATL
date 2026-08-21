import "server-only";

import {
  PhotoOwnerTypeSchema,
  type PhotoAttachment,
  type PhotoOwnerType,
} from "@/lib/inventory-schema";
import { PhotoFileNameSchema } from "@/lib/inventory-schema";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { parseWithSchema } from "@/backend/server/safeParsing";
import { ServiceError } from "@/backend/server/inventory-service";
import { readSystem, updateSystem } from "@/backend/server/store";
import {
  deletePhotoFile,
  readPhotoFile,
  writePhotoFile,
} from "@/backend/server/photo-store";
import { assertPhotoBytes, assertPhotoCollectionRoom } from "@/lib/photos/image";
import { photosForOwner } from "@/lib/photos/query";
import { resolvePhotoOwner } from "@/lib/photos/owner";
import { OptionalNotesSchema } from "@/lib/validation/fields";

export type PhotoUploadInput = {
  ownerType: unknown;
  ownerId: unknown;
  originalName?: unknown;
  caption?: unknown;
  bytes: Uint8Array;
  createdBy?: string;
};

function requireOwnerId(value: unknown): string {
  const ownerId = typeof value === "string" ? value.trim() : "";
  if (!ownerId) {
    throw new ServiceError(
      "A receiving order, shipment, or adjustment is required.",
    );
  }
  return ownerId;
}

export async function attachPhotoRecord(
  input: PhotoUploadInput,
): Promise<PhotoAttachment> {
  const ownerTypeParsed = parseWithSchema(PhotoOwnerTypeSchema, input.ownerType);
  if (!ownerTypeParsed.success) {
    throw new ServiceError("Choose a receiving order, shipment, or adjustment.");
  }
  const ownerType = ownerTypeParsed.data;
  const ownerId = requireOwnerId(input.ownerId);
  const mime = assertPhotoBytes(input.bytes);
  const originalNameParsed = parseWithSchema(
    PhotoFileNameSchema,
    typeof input.originalName === "string" ? input.originalName : "photo",
  );
  const captionParsed = parseWithSchema(
    OptionalNotesSchema,
    typeof input.caption === "string" ? input.caption : "",
  );
  if (!captionParsed.success) {
    throw new ServiceError(captionParsed.error);
  }

  const photo: PhotoAttachment = {
    id: createId(),
    ownerType,
    ownerId,
    originalName: originalNameParsed.success
      ? originalNameParsed.data
      : "photo",
    mimeType: mime,
    size: input.bytes.byteLength,
    caption: captionParsed.data,
    createdAt: nowIso(),
    createdBy: input.createdBy,
  };

  await writePhotoFile(photo.id, photo.mimeType, input.bytes);

  try {
    return await updateSystem((system) => {
      const owner = resolvePhotoOwner(system, ownerType, ownerId);
      if (!owner.ok) {
        throw new ServiceError(owner.error, 404);
      }
      if (!system.photos) system.photos = [];
      assertPhotoCollectionRoom(
        photosForOwner(system.photos, ownerType, ownerId).length,
      );
      system.photos.unshift(photo);
      return photo;
    });
  } catch (error) {
    await deletePhotoFile(photo.id, photo.mimeType);
    throw error;
  }
}

export async function getPhotoRecord(photoId: string): Promise<{
  photo: PhotoAttachment;
  bytes: Uint8Array;
}> {
  const system = await readSystem();
  const photo = (system.photos ?? []).find((entry) => entry.id === photoId);
  if (!photo) {
    throw new ServiceError("Photo was not found.", 404);
  }
  return { photo, bytes: await readPhotoFile(photo.id, photo.mimeType) };
}

export async function listPhotoRecords(
  ownerType: PhotoOwnerType,
  ownerId: string,
): Promise<PhotoAttachment[]> {
  const system = await readSystem();
  const owner = resolvePhotoOwner(system, ownerType, ownerId);
  if (!owner.ok) {
    throw new ServiceError(owner.error, 404);
  }
  return photosForOwner(system.photos ?? [], ownerType, ownerId);
}

export async function deletePhotoRecord(photoId: string): Promise<PhotoAttachment> {
  const photo = await updateSystem((system) => {
    const index = (system.photos ?? []).findIndex((entry) => entry.id === photoId);
    if (index === -1) {
      throw new ServiceError("Photo was not found.", 404);
    }
    const [removed] = system.photos.splice(index, 1);
    return removed;
  });
  await deletePhotoFile(photo.id, photo.mimeType);
  return photo;
}
