import { z } from "zod";
import { ReceivingOrderSchema } from "@/lib/inventory-schema";

/** Generate a new UUID (browser / Node 19+) */
export function createId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Partial update helper */
export const PartialReceivingOrderSchema = ReceivingOrderSchema.partial();
export type PartialReceivingOrder = z.infer<typeof PartialReceivingOrderSchema>;
