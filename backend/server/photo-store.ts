import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { UuidSchema, type PhotoMimeType } from "@/lib/inventory-schema";
import { extensionForMime } from "@/lib/photos/image";
import { ValidationError } from "@/lib/validation/errors";

const PHOTO_DIR = path.join(process.cwd(), "data", "photos");

function safePhotoId(id: string): string {
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Photo was not found.", 404);
  }
  return parsed.data;
}

export function photoDiskPath(id: string, mimeType: PhotoMimeType): string {
  return path.join(PHOTO_DIR, `${safePhotoId(id)}.${extensionForMime(mimeType)}`);
}

export async function writePhotoFile(
  id: string,
  mimeType: PhotoMimeType,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(PHOTO_DIR, { recursive: true });
  await writeFile(photoDiskPath(id, mimeType), bytes);
}

export async function readPhotoFile(
  id: string,
  mimeType: PhotoMimeType,
): Promise<Uint8Array> {
  try {
    return await readFile(photoDiskPath(id, mimeType));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ValidationError("Photo file is missing.", 404);
    }
    throw error;
  }
}

export async function deletePhotoFile(
  id: string,
  mimeType: PhotoMimeType,
): Promise<void> {
  try {
    await unlink(photoDiskPath(id, mimeType));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
