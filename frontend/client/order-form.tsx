"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { createCustomerOrder } from "@/backend/server/serverAction";
import type { InventoryRow } from "@/lib/inventory-schema";
import { NonEmptyStringSchema } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { matchesScan } from "@/lib/scan-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/frontend/client/field";
import { ScanInput } from "@/frontend/client/scan-input";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";

const OrderHeaderSchema = z.object({
  customer: NonEmptyStringSchema,
  notes: z.string().optional(),
});

type OrderHeader = z.infer<typeof OrderHeaderSchema>;
type LineDraft = { inventoryItemId: string; quantity: number };

export type OrderableInventoryRow = InventoryRow & {
  reserved: number;
  available: number;
};

export function OrderForm({ inventory }: { inventory: OrderableInventoryRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const form = useForm<OrderHeader>({
    resolver: zodResolver(OrderHeaderSchema),
    defaultValues: { customer: "", notes: "" },
  });

  const orderTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  const lineMap = useMemo(
    () => new Map(lines.map((line) => [line.inventoryItemId, line.quantity])),
    [lines],
  );
  const orderable = inventory.filter((row) => row.available > 0);

  function setQuantity(inventoryItemId: string, quantity: number, available: number) {
    setLines((current) => {
      const next = current.filter((line) => line.inventoryItemId !== inventoryItemId);
      const capped = Math.min(available, Math.max(0, quantity));
      if (capped > 0) next.push({ inventoryItemId, quantity: capped });
      return next;
    });
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={form.handleSubmit((values) => {
        setError(null);
        if (lines.length === 0) {
          setError("Select at least one on-hand line to order.");
          return;
        }
        startTransition(async () => {
          const result = await createCustomerOrder({
            customer: values.customer,
            notes: values.notes,
            lines,
            ...largeInputPayload(
              orderTotal,
              confirmLargeInput,
              confirmationQuantity,
              LIMITS.largePickTotal,
            ),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push(`/orders/${result.data.id}`);
          router.refresh();
        });
      })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer" htmlFor="customer" error={form.formState.errors.customer?.message}>
          <Input id="customer" {...form.register("customer")} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" {...form.register("notes")} />
      </Field>

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Order against on-hand inventory</h2>
        <p className="text-xs text-muted-foreground">
          Available quantity is on hand minus units already reserved by open orders.
        </p>
        <ScanInput
          onScan={(payload) => {
            const hit = orderable.find((row) => matchesScan(row, payload));
            if (!hit) {
              setError("Scanned code did not match inventory that can still be ordered.");
              return;
            }
            setError(null);
            setQuantity(
              hit.id,
              (lineMap.get(hit.id) ?? 0) + 1,
              hit.available,
            );
          }}
          placeholder="Scan barcode/QR to add 1 from available stock"
        />
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="border-b text-left">
              <tr>
                <th className="px-2 py-2 font-medium">SKU</th>
                <th className="px-2 py-2 font-medium">Location</th>
                <th className="px-2 py-2 font-medium">On hand</th>
                <th className="px-2 py-2 font-medium">Reserved</th>
                <th className="px-2 py-2 font-medium">Available</th>
                <th className="px-2 py-2 font-medium">Order qty</th>
              </tr>
            </thead>
            <tbody>
              {orderable.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-muted-foreground" colSpan={6}>
                    Nothing is available to order. On-hand stock is empty or already reserved.
                  </td>
                </tr>
              ) : (
                orderable.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-2 py-2">
                      <div className="font-medium">{row.sku}</div>
                      <div className="text-muted-foreground">{row.description}</div>
                    </td>
                    <td className="px-2 py-2">
                      {row.roomName} / {row.locationCode}
                    </td>
                    <td className="px-2 py-2">{row.quantity}</td>
                    <td className="px-2 py-2">{row.reserved}</td>
                    <td className="px-2 py-2">{row.available}</td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={row.available}
                        className="w-24"
                        aria-label={`Order quantity for ${row.sku}`}
                        value={lineMap.get(row.id) ?? 0}
                        onChange={(event) =>
                          setQuantity(
                            row.id,
                            Number(event.target.value) || 0,
                            row.available,
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
      <LargeInputConfirm
        total={orderTotal}
        threshold={LIMITS.largePickTotal}
        label="order quantity"
        confirmed={confirmLargeInput}
        onConfirmedChange={setConfirmLargeInput}
        confirmationQuantity={confirmationQuantity}
        onConfirmationQuantityChange={setConfirmationQuantity}
      />
      <div>
        <Button type="submit" disabled={pending || orderable.length === 0}>
          {pending ? "Submitting…" : "Submit order"}
        </Button>
      </div>
    </form>
  );
}
