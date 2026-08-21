import type { PhotoAttachment, PhotoOwnerType } from "@/lib/inventory-schema";

export function photosForOwner(
  photos: PhotoAttachment[],
  ownerType: PhotoOwnerType,
  ownerId: string,
): PhotoAttachment[] {
  return photos.filter(
    (photo) => photo.ownerType === ownerType && photo.ownerId === ownerId,
  );
}

export function photosForReference(
  photos: PhotoAttachment[],
  referenceType: string | undefined,
  referenceId: string | undefined,
): PhotoAttachment[] {
  if (
    !referenceId ||
    (referenceType !== "receiving-order" &&
      referenceType !== "shipping-order" &&
      referenceType !== "adjustment")
  ) {
    return [];
  }
  return photosForOwner(photos, referenceType, referenceId);
}
