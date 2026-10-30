"use client";

import { T } from "@/frontend/client/language";
import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAdjustment } from "@/backend/server/serverAction";
import type { InventoryRow, ItemCube } from "@/lib/inventory-schema";
import { inventoryQuantityCubeMessage } from "@/lib/cubing/workflow";
import type { LocationCubeRow } from "@/frontend/client/location-cube-table";
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
import { LIMITS } from "@/lib/validation/limits";
import { matchesScan, type ScanPayload } from "@/lib/scan-code";

const AdjustmentFormSchema = z.object({
  type: z.enum(["overage", "shortage"]),
  inventoryItemId: z.string().optional(),
  locationId: z.string().optional(),
  quantity: z.number().int().min(1),
  reason: z.string().trim().min(1),
  notes: z.string().optional(),
});

type AdjustmentFormValues = z.infer<typeof AdjustmentFormSchema>;

export function AdjustmentForm({
  inventory,
  cubes = [],
  locationCubes = [],
  selectedItemId,
  onSelectedItemIdChange,
}: {
  inventory: InventoryRow[];
  cubes?: ItemCube[];
  locationCubes?: LocationCubeRow[];
  selectedItemId?: string;
  onSelectedItemIdChange?: (id: string | undefined) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scannedCode, setScannedCode] = useState<string | undefined>();
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");

  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(AdjustmentFormSchema),
    defaultValues: {
      type: "overage",
      inventoryItemId: selectedItemId ?? "",
      locationId: "",
      quantity: 1,
      reason: "",
      notes: "",
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
  const cubeHint = cubeHintForAdjustment({
    type,
    quantity: Number(quantity) || 0,
    selected,
    cubes,
    locationCubes,
  });

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
        <CardTitle><T>Inventory adjustment</T></CardTitle>
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
              form.reset({
                type: values.type,
                inventoryItemId: values.inventoryItemId,
                locationId: values.locationId,
                quantity: 1,
                reason: "",
                notes: "",
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
                <option value="overage"><T>Overage (+)</T></option>
                <option value="shortage"><T>Shortage (−)</T></option>
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
              <option value=""><T>Select a line</T></option>
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
          {cubeHint ? (
            <p className={cubeHint.blocks ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {cubeHint.text}
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
          <p className="text-xs text-muted-foreground">
            <Link href="/damages" className="underline">
              <T>Report damaged inventory on the Damages tab.</T>
            </Link>
          </p>
          <LargeInputConfirm
            total={Number(quantity) || 0}
            threshold={LIMITS.largeQuantity}
            label="adjustment quantity"
            confirmed={confirmLargeInput}
            onConfirmedChange={setConfirmLargeInput}
            confirmationQuantity={confirmationQuantity}
            onConfirmationQuantityChange={setConfirmationQuantity}
          />
          {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Post adjustment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function cubeHintForAdjustment(input: {
  type: "overage" | "shortage";
  quantity: number;
  selected: InventoryRow | undefined;
  cubes: ItemCube[];
  locationCubes: LocationCubeRow[];
}): { text: string; blocks: boolean } | null {
  const { selected, quantity, type } = input;
  if (!selected || quantity < 1 || type !== "overage") return null;
  const location = input.locationCubes.find((entry) => entry.id === selected.locationId);
  if (!location) return null;
  const cube = input.cubes.find((entry) => entry.sku === selected.sku);
  if (!cube) {
    return {
      blocks: false,
      text: `${selected.sku} has not been cubed. Open the Cubing tab so this location's capacity can be checked.`,
    };
  }
  const message = inventoryQuantityCubeMessage({
    sku: selected.sku,
    locationCode: location.code,
    capacity: location.cubeCapacityCubicInches,
    committedCubicInches: location.committedCubicInches,
    cube: {
      sku: cube.sku,
      cubicInches: cube.cubicInches,
      unitsPerCase: cube.unitsPerCase,
    },
    quantityBefore: selected.quantity,
    quantityAfter: selected.quantity + quantity,
  });
  return message ? { text: message, blocks: true } : null;
}
