import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { UuidSchema } from "@/lib/inventory-schema";
import { ValidationError } from "@/lib/validation/errors";

const DOCUMENT_DIR = path.join(process.cwd(), "data", "purchase-documents");

function safeDocumentId(id: string): string {
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Purchase document was not found.", 404);
  }
  return parsed.data;
}

export function purchaseDocumentPath(id: string, redacted = false): string {
  const suffix = redacted ? ".redacted.pdf" : ".pdf";
  return path.join(DOCUMENT_DIR, `${safeDocumentId(id)}${suffix}`);
}

export async function writePurchaseDocumentFile(
  id: string,
  bytes: Uint8Array,
  redacted = false,
): Promise<void> {
  await mkdir(DOCUMENT_DIR, { recursive: true });
  await writeFile(purchaseDocumentPath(id, redacted), bytes);
}

export async function readPurchaseDocumentFile(
  id: string,
  redacted = false,
): Promise<Uint8Array> {
  try {
    return await readFile(purchaseDocumentPath(id, redacted));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ValidationError("Purchase document file is missing.", 404);
    }
    throw error;
  }
}

export async function deletePurchaseDocumentFile(
  id: string,
  redacted = false,
): Promise<void> {
  try {
    await unlink(purchaseDocumentPath(id, redacted));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
