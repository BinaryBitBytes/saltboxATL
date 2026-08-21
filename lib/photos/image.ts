import type { PhotoMimeType } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export function sniffImageMime(bytes: Uint8Array): PhotoMimeType | null {
  if (bytes.length < 12) return null;
  if (JPEG_MAGIC.every((value, index) => bytes[index] === value)) {
    return "image/jpeg";
  }
  if (PNG_MAGIC.every((value, index) => bytes[index] === value)) {
    return "image/png";
  }
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === "RIFF" && webp === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function extensionForMime(mime: PhotoMimeType): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function assertPhotoBytes(bytes: Uint8Array): PhotoMimeType {
  if (bytes.byteLength < 12) {
    throw new ValidationError("That photo file is empty or too small.");
  }
  if (bytes.byteLength > LIMITS.photoMaxBytes) {
    throw new ValidationError(
      `Each photo must be ${Math.round(LIMITS.photoMaxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }
  const mime = sniffImageMime(bytes);
  if (!mime) {
    throw new ValidationError(
      "Use a JPEG, PNG, or WebP photo. HEIC and other formats are not accepted.",
    );
  }
  return mime;
}

export function assertPhotoCollectionRoom(
  existingCount: number,
  incomingCount = 1,
): void {
  if (existingCount + incomingCount > LIMITS.photoMaxCount) {
    throw new ValidationError(
      `A transaction can keep at most ${LIMITS.photoMaxCount} photos.`,
    );
  }
  if (incomingCount < 1) {
    throw new ValidationError("Choose at least one photo to attach.");
  }
}
