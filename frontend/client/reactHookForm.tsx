"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { z } from "zod";
import { NonEmptyStringSchema } from "@/lib/inventory-schema";
import { createReceivingOrder } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/frontend/client/field";
import { localDateTimeValue, toIsoDateTime } from "@/lib/format";

const ReceivingFormSchema = z.object({
  poNumber: NonEmptyStringSchema,
  poGeneratedAtLocal: z.string().min(1),
  vendor: NonEmptyStringSchema,
  orderNumber: NonEmptyStringSchema,
  carrierInbound: NonEmptyStringSchema,
  receiverName: NonEmptyStringSchema,
  loadPalletCount: z.number().int().min(0),
  receivedAtLocal: z.string().min(1),
  notes: z.string().optional(),
});

type ReceivingFormValues = z.infer<typeof ReceivingFormSchema>;

export default function ReceivingForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ReceivingFormValues>({
    resolver: zodResolver(ReceivingFormSchema),
    defaultValues: {
      poNumber: "",
      vendor: "",
      orderNumber: "",
      carrierInbound: "",
      receiverName: "",
      loadPalletCount: 1,
      notes: "",
      receivedAtLocal: localDateTimeValue(),
      poGeneratedAtLocal: localDateTimeValue(),
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createReceivingOrder({
        poNumber: values.poNumber,
        vendor: values.vendor,
        orderNumber: values.orderNumber,
        carrierInbound: values.carrierInbound,
        receiverName: values.receiverName,
        loadPalletCount: Number(values.loadPalletCount),
        notes: values.notes,
        receivedAt: toIsoDateTime(values.receivedAtLocal),
        poGeneratedAt: toIsoDateTime(values.poGeneratedAtLocal),
      });

      if (!result.ok) {
        setServerError(result.error);
        return;
      }

      router.push(`/receiving/${result.data.id}`);
      router.refresh();
    });
  });

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="PO number" htmlFor="poNumber" error={errors.poNumber?.message}>
          <Input id="poNumber" {...form.register("poNumber")} />
        </Field>
        <Field
          label="PO generated"
          htmlFor="poGeneratedAtLocal"
          error={errors.poGeneratedAtLocal?.message}
        >
          <Input
            id="poGeneratedAtLocal"
            type="datetime-local"
            {...form.register("poGeneratedAtLocal")}
          />
        </Field>
        <Field label="Vendor" htmlFor="vendor" error={errors.vendor?.message}>
          <Input id="vendor" {...form.register("vendor")} />
        </Field>
        <Field
          label="Order number"
          htmlFor="orderNumber"
          error={errors.orderNumber?.message}
        >
          <Input id="orderNumber" {...form.register("orderNumber")} />
        </Field>
        <Field
          label="Inbound carrier"
          htmlFor="carrierInbound"
          error={errors.carrierInbound?.message}
        >
          <Input id="carrierInbound" {...form.register("carrierInbound")} />
        </Field>
        <Field
          label="Receiver name"
          htmlFor="receiverName"
          error={errors.receiverName?.message}
        >
          <Input id="receiverName" {...form.register("receiverName")} />
        </Field>
        <Field
          label="Expected pallet count"
          htmlFor="loadPalletCount"
          error={errors.loadPalletCount?.message}
        >
          <Input
            id="loadPalletCount"
            type="number"
            min={0}
            {...form.register("loadPalletCount", { valueAsNumber: true })}
          />
        </Field>
        <Field
          label="Date received"
          htmlFor="receivedAtLocal"
          error={errors.receivedAtLocal?.message}
        >
          <Input
            id="receivedAtLocal"
            type="datetime-local"
            {...form.register("receivedAtLocal")}
          />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
        <Textarea id="notes" rows={3} {...form.register("notes")} />
      </Field>
      {serverError ? (
        <p className="text-xs text-destructive">{serverError}</p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Start receiving"}
        </Button>
      </div>
    </form>
  );
}
