/** Generate a new UUID (browser / Node 19+) */
export function createId(): string {
  return crypto.randomUUID();
}

/** Partial update helper */
export const PartialReceivingOrderSchema = ReceivingOrderSchema.partial();
export type PartialReceivingOrder = z.infer<typeof PartialReceivingOrderSchema>;