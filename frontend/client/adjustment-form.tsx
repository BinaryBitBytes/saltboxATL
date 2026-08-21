"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { createAdjustment } from "@/backend/server/serverAction";
import type { InventoryRow, Location } from "@/lib/inventory-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { ScanInput } from "@/frontend/client/scan-input";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import {
  PhotoDraftCollector,
  revokePhotoDrafts,
  type PhotoDraft,
} from "@/frontend/client/photo-proof";
import { uploadProofPhotos } from "@/frontend/client/photo-api";
import { LIMITS } from "@/lib/validation/limits";
import { matchesScan, type ScanPayload } from "@/lib/scan-code";

const AdjustmentFormSchema = z.object({
  type: z.enum(["overage", "shortage", "damage"]),
  inventoryItemId: z.string().optional(),
  locationId: z.string().optional(),
  quantity: z.number().int().min(1),
  reason: z.string().trim().min(1),
  notes: z.string().optional(),
  moveDamaged: z.boolean(),
});

type AdjustmentFormValues = z.infer<typeof AdjustmentFormSchema>;

export function AdjustmentForm({
  inventory,
  locations,
  selectedItemId,
  onSelectedItemIdChange,
}: {
  inventory: InventoryRow[];
  locations: Location[];
  selectedItemId?: string;
  onSelectedItemIdChange?: (id: string | undefined) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scannedCode, setScannedCode] = useState<string | undefined>();
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const damagedLocationId =
    locations.find((location) => location.code === "DMG-01")?.id ?? "";

  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(AdjustmentFormSchema),
    defaultValues: {
      type: "overage",
      inventoryItemId: selectedItemId ?? "",
      locationId: "",
      quantity: 1,
      reason: "",
      notes: "",
      moveDamaged: true,
    },
  });

  useEffect(() => {
    if (selectedItemId) {
      form.setValue("inventoryItemId", selectedItemId);
    }
  }, [form, selectedItemId]);

  const type = useWatch({ control: form.control, name: "type" });
  const quantity = useWatch({ control: form.control, name: "quantity" });
  const selectedId = useWatch({
    control: form.control,
    name: "inventoryItemId",
  });
  const selected = inventory.find((item) => item.id === selectedId);

  function applyScan(payload: ScanPayload) {
    setScannedCode(payload.raw);
    const matches = inventory.filter((item) => matchesScan(item, payload));
    const preferred =
      matches.find((item) => item.quantity > 0) ?? matches[0];
    if (preferred) {
      form.setValue("inventoryItemId", preferred.id);
      onSelectedItemIdChange?.(preferred.id);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory adjustment</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ScanInput
          onScan={applyScan}
          placeholder="Scan UPC, SKU, or product QR to select a line"
        />
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            startTransition(async () => {
              const result = await createAdjustment({
                type: values.type,
                inventoryItemId: values.inventoryItemId || undefined,
                locationId: values.locationId || undefined,
                quantity: Number(values.quantity),
                reason: values.reason,
                notes: values.notes,
                scannedCode,
                moveDamagedToLocationId:
                  values.type === "damage" && values.moveDamaged
                    ? damagedLocationId || undefined
                    : undefined,
                ...largeInputPayload(
                  Number(values.quantity),
                  confirmLargeInput,
                  confirmationQuantity,
                ),
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              if (values.type === "damage" && photoDrafts.length > 0) {
                const uploaded = await uploadProofPhotos({
                  ownerType: "adjustment",
                  ownerId: result.data.referenceId,
                  files: photoDrafts.map((draft) => draft.file),
                });
                if (!uploaded.ok) {
                  setError(
                    `Adjustment posted, but photos failed: ${uploaded.error}`,
                  );
                }
              }
              revokePhotoDrafts(photoDrafts);
              setPhotoDrafts([]);
              form.reset({
                type: values.type,
                inventoryItemId: values.inventoryItemId,
                locationId: values.locationId,
                quantity: 1,
                reason: "",
                notes: "",
                moveDamaged: true,
              });
              setScannedCode(undefined);
              setConfirmLargeInput(false);
              setConfirmationQuantity("");
              router.refresh();
            });
          })}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" error={form.formState.errors.type?.message}>
              <NativeSelect {...form.register("type")}>
                <option value="overage">Overage (+)</option>
                <option value="shortage">Shortage (−)</option>
                <option value="damage">Damage</option>
              </NativeSelect>
            </Field>
            <Field
              label="Quantity"
              htmlFor="quantity"
              error={form.formState.errors.quantity?.message}
            >
              <Input
                id="quantity"
                type="number"
                min={1}
                {...form.register("quantity", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <Field label="Inventory line">
            <NativeSelect
              {...form.register("inventoryItemId")}
              onChange={(event) => {
                form.setValue("inventoryItemId", event.target.value);
                onSelectedItemIdChange?.(event.target.value || undefined);
              }}
            >
              <option value="">Select a line</option>
              {inventory.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.locationCode} · qty {item.quantity}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {selected ? (
            <p className="text-xs text-muted-foreground">
              {selected.description || selected.sku} · UPC {selected.upc || "—"} ·{" "}
              {selected.roomName}/{selected.locationCode}
            </p>
          ) : null}
          <Field
            label="Reason"
            htmlFor="reason"
            error={form.formState.errors.reason?.message}
          >
            <Input
              id="reason"
              placeholder="Cycle count, crushed carton, extra pallet..."
              {...form.register("reason")}
            />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" rows={2} {...form.register("notes")} />
          </Field>
          {type === "damage" ? (
            <PhotoDraftCollector
              drafts={photoDrafts}
              onChange={setPhotoDrafts}
              disabled={pending}
              title="Proof of damage"
              description="Photograph crushed cartons, wet freight, or other damage before posting the adjustment."
            />
          ) : null}
          {type === "damage" ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" {...form.register("moveDamaged")} />
              Move damaged units to DMG-01 instead of writing them off
            </label>
          ) : null}
          <LargeInputConfirm
            total={Number(quantity) || 0}
            threshold={LIMITS.largeQuantity}
            label="adjustment quantity"
            confirmed={confirmLargeInput}
            onConfirmedChange={setConfirmLargeInput}
            confirmationQuantity={confirmationQuantity}
            onConfirmationQuantityChange={setConfirmationQuantity}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Post adjustment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
