import type {
  PhotoAttachment,
  PhotoDocumentKind,
  PhotoOwnerType,
} from "@/lib/inventory-schema";
import { compressProofPhoto } from "@/frontend/client/compress-image";

export type PhotoApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function readJson<T>(response: Response): Promise<PhotoApiResult<T>> {
  const json = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    error?: string;
  } | null;
  if (!response.ok || !json?.success || json.data === undefined) {
    return {
      ok: false,
      error: json?.error || "Unable to save that photo.",
    };
  }
  return { ok: true, data: json.data };
}

export async function uploadProofPhoto(input: {
  ownerType: PhotoOwnerType;
  ownerId: string;
  file: File;
  caption?: string;
  documentKind?: PhotoDocumentKind;
}): Promise<PhotoApiResult<PhotoAttachment>> {
  const compressed = await compressProofPhoto(input.file);
  const form = new FormData();
  form.set("ownerType", input.ownerType);
  form.set("ownerId", input.ownerId);
  form.set("documentKind", input.documentKind ?? "freight-proof");
  form.set("file", compressed, compressed.name);
  if (input.caption) form.set("caption", input.caption);
  const response = await fetch("/api/photos", { method: "POST", body: form });
  return readJson<PhotoAttachment>(response);
}

export async function uploadProofPhotos(input: {
  ownerType: PhotoOwnerType;
  ownerId: string;
  files: File[];
  caption?: string;
  documentKind?: PhotoDocumentKind;
}): Promise<PhotoApiResult<PhotoAttachment[]>> {
  const uploaded: PhotoAttachment[] = [];
  for (const file of input.files) {
    const result = await uploadProofPhoto({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      file,
      caption: input.caption,
      documentKind: input.documentKind,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    uploaded.push(result.data);
  }
  return { ok: true, data: uploaded };
}

export async function deleteProofPhoto(
  photoId: string,
): Promise<PhotoApiResult<{ id: string }>> {
  const response = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
  return readJson<{ id: string }>(response);
}

export function photoSrc(photoId: string): string {
  return `/api/photos/${photoId}`;
}
