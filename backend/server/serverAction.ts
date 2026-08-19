"use server";

import { ReceivingOrderSchema, type ReceivingOrder } from "@/lib/inventory-schema";

export async function createReceivingOrder(rawData: unknown) {
  const data = ReceivingOrderSchema.parse(rawData);
  // data is typed as ReceivingOrder
  // persist to database...
  return data;
}