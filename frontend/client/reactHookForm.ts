"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReceivingOrderSchema, type ReceivingOrder } from "@/lib/inventory-schema";

export default function ReceivingForm() {
  const form = useForm<ReceivingOrder>({
    resolver: zodResolver(ReceivingOrderSchema),
    defaultValues: {
      status: "draft",
      pallets: [],
      loadPalletCount: 0,
    },
  });

  const onSubmit = (data: ReceivingOrder) => {
    // data is fully typed and already validated
    console.log(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* your form fields */}
    </form>
  );
}