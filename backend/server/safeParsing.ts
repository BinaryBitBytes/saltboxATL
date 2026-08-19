const result = ReceivingOrderSchema.safeParse(incomingData);

if (!result.success) {
  console.error(result.error.flatten());
  return;
}

const order: ReceivingOrder = result.data;