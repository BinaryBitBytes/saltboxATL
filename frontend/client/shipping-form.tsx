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
import { ScanInput } from "@/frontend/client/scan-input";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import {
  PhotoDraftCollector,
  revokePhotoDrafts,
  type PhotoDraft,
} from "@/frontend/client/photo-proof";
import { uploadProofPhotos } from "@/frontend/client/photo-api";
import { NonEmptyStringSchema } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { matchesScan } from "@/lib/scan-code";

const ShippingHeaderSchema = z.object({
  customer: NonEmptyStringSchema,
  shipmentNumber: NonEmptyStringSchema,
  carrierOutbound: NonEmptyStringSchema,
  shipperName: NonEmptyStringSchema,
  trackingNumber: z.string(),
  notes: z.string().optional(),
});

type ShippingHeader = z.infer<typeof ShippingHeaderSchema>;
type PickDraft = { inventoryItemId: string; quantity: number };

export function ShippingForm({
  inventory,
  defaultShipperName = "",
}: {
  inventory: InventoryRow[];
  defaultShipperName?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<PickDraft[]>([]);
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const form = useForm<ShippingHeader>({
    resolver: zodResolver(ShippingHeaderSchema),
    defaultValues: {
      customer: "",
      shipmentNumber: "",
      carrierOutbound: "",
      shipperName: defaultShipperName,
      trackingNumber: "",
      notes: "",
    },
  });

  const pickTotal = picks.reduce((sum, pick) => sum + pick.quantity, 0);
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
            ...largeInputPayload(
              pickTotal,
              confirmLargeInput,
              confirmationQuantity,
              LIMITS.largePickTotal,
            ),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          if (photoDrafts.length > 0) {
            const uploaded = await uploadProofPhotos({
              ownerType: "shipping-order",
              ownerId: result.data.id,
              files: photoDrafts.map((draft) => draft.file),
            });
            if (!uploaded.ok) {
              setError(
                `Shipment saved, but photos failed: ${uploaded.error}. Add them on the shipment page.`,
              );
            }
            revokePhotoDrafts(photoDrafts);
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
        <Field
          label="Tracking number"
          htmlFor="trackingNumber"
          error={form.formState.errors.trackingNumber?.message}
        >
          <Input id="trackingNumber" {...form.register("trackingNumber")} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" {...form.register("notes")} />
      </Field>
      <PhotoDraftCollector
        drafts={photoDrafts}
        onChange={setPhotoDrafts}
        disabled={pending}
        title="Proof of outbound freight"
        description="Photograph picked freight, packed pallets, and shipping papers. These attach to the shipment after you pick."
      />

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Pick from on-hand inventory</h2>
        <ScanInput
          onScan={(payload) => {
            const matches = inventory.filter(
              (row) => row.quantity > 0 && matchesScan(row, payload),
            );
            const hit = matches[0];
            if (!hit) {
              setError("Scanned code did not match on-hand inventory.");
              return;
            }
            setError(null);
            setQuantity(
              hit.id,
              Math.min(hit.quantity, (pickMap.get(hit.id) ?? 0) + 1),
            );
          }}
          placeholder="Scan barcode/QR to add 1 to the matching pick"
        />
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
              {inventory.filter((row) => row.quantity > 0).length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-muted-foreground" colSpan={4}>
                    Nothing on hand. Complete a receiving order first.
                  </td>
                </tr>
              ) : (
                inventory
                  .filter((row) => row.quantity > 0)
                  .map((row) => (
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
      <LargeInputConfirm
        total={pickTotal}
        threshold={LIMITS.largePickTotal}
        label="shipment quantity"
        confirmed={confirmLargeInput}
        onConfirmedChange={setConfirmLargeInput}
        confirmationQuantity={confirmationQuantity}
        onConfirmationQuantityChange={setConfirmationQuantity}
      />
      <div>
        <Button type="submit" disabled={pending || inventory.every((row) => row.quantity <= 0)}>
          {pending ? "Shipping…" : "Ship selected inventory"}
        </Button>
      </div>
    </form>
  );
}
