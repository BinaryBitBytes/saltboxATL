"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { createShippingOrder } from "@/backend/server/serverAction";
import type { InventoryRow } from "@/lib/inventory-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/frontend/client/field";
import { NonEmptyStringSchema } from "@/lib/inventory-schema";

const ShippingHeaderSchema = z.object({
  customer: NonEmptyStringSchema,
  shipmentNumber: NonEmptyStringSchema,
  carrierOutbound: NonEmptyStringSchema,
  shipperName: NonEmptyStringSchema,
  notes: z.string().optional(),
});

type ShippingHeader = z.infer<typeof ShippingHeaderSchema>;
type PickDraft = { inventoryItemId: string; quantity: number };

export function ShippingForm({ inventory }: { inventory: InventoryRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<PickDraft[]>([]);
  const form = useForm<ShippingHeader>({
    resolver: zodResolver(ShippingHeaderSchema),
    defaultValues: {
      customer: "",
      shipmentNumber: "",
      carrierOutbound: "",
      shipperName: "",
      notes: "",
    },
  });

  const pickMap = useMemo(
    () => new Map(picks.map((pick) => [pick.inventoryItemId, pick.quantity])),
    [picks],
  );

  function setQuantity(inventoryItemId: string, quantity: number) {
    setPicks((current) => {
      const next = current.filter((pick) => pick.inventoryItemId !== inventoryItemId);
      if (quantity > 0) next.push({ inventoryItemId, quantity });
      return next;
    });
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={form.handleSubmit((values) => {
        setError(null);
        if (picks.length === 0) {
          setError("Select at least one inventory line to ship.");
          return;
        }
        startTransition(async () => {
          const result = await createShippingOrder({
            ...values,
            picks,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push(`/shipping/${result.data.id}`);
          router.refresh();
        });
      })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer" htmlFor="customer" error={form.formState.errors.customer?.message}>
          <Input id="customer" {...form.register("customer")} />
        </Field>
        <Field
          label="Shipment number"
          htmlFor="shipmentNumber"
          error={form.formState.errors.shipmentNumber?.message}
        >
          <Input id="shipmentNumber" {...form.register("shipmentNumber")} />
        </Field>
        <Field
          label="Outbound carrier"
          htmlFor="carrierOutbound"
          error={form.formState.errors.carrierOutbound?.message}
        >
          <Input id="carrierOutbound" {...form.register("carrierOutbound")} />
        </Field>
        <Field
          label="Shipping associate"
          htmlFor="shipperName"
          error={form.formState.errors.shipperName?.message}
        >
          <Input id="shipperName" {...form.register("shipperName")} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" {...form.register("notes")} />
      </Field>

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Pick from on-hand inventory</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="border-b text-left">
              <tr>
                <th className="px-2 py-2 font-medium">SKU</th>
                <th className="px-2 py-2 font-medium">Location</th>
                <th className="px-2 py-2 font-medium">On hand</th>
                <th className="px-2 py-2 font-medium">Ship qty</th>
              </tr>
            </thead>
            <tbody>
              {inventory.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-muted-foreground" colSpan={4}>
                    Nothing on hand. Complete a receiving order first.
                  </td>
                </tr>
              ) : (
                inventory.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-2 py-2">
                      <div className="font-medium">{row.sku}</div>
                      <div className="text-muted-foreground">{row.description}</div>
                    </td>
                    <td className="px-2 py-2">
                      {row.roomName} / {row.locationCode}
                    </td>
                    <td className="px-2 py-2">{row.quantity}</td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={row.quantity}
                        className="w-24"
                        value={pickMap.get(row.id) ?? 0}
                        onChange={(event) =>
                          setQuantity(
                            row.id,
                            Math.min(row.quantity, Math.max(0, Number(event.target.value) || 0)),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div>
        <Button type="submit" disabled={pending || inventory.length === 0}>
          {pending ? "Shipping…" : "Ship selected inventory"}
        </Button>
      </div>
    </form>
  );
}
