"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import {
  CONNECTION_TYPES,
  STRAND_COUNTS,
  type Location,
  type ReceivingOrder,
  type Room,
} from "@/lib/inventory-schema";
import {
  addReceivingCase,
  addReceivingPallet,
  cancelReceiving,
  completeReceiving,
  selectWorkingPallet,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { ScanInput } from "@/frontend/client/scan-input";
import { useReceivingSession } from "@/frontend/client/receiving-session";
import { cn } from "@/lib/utils";
import type { ScanPayload } from "@/lib/scan-code";

const PalletFormSchema = z.object({
  palletNumber: z.string().trim().min(1),
  isPartial: z.boolean(),
  partialedBy: z.string().nullable(),
  expectedSkuCount: z.number().int().min(0),
  expectedCaseCount: z.number().int().min(0),
});

const CaseFormSchema = z.object({
  upc: z.string().trim().min(1),
  sku: z.string().trim().min(1),
  batch: z.string().nullable(),
  quantityInCase: z.number().int().min(1),
  description: z.string().trim().min(1),
  isFiber: z.boolean(),
  connectionType: z.string().nullable(),
  strandCount: z.number().nullable(),
  lengthMeters: z.number().nullable(),
  putawayRoomId: z.string().nullable(),
  putawayLocationId: z.uuid("Select a putaway location"),
});

type CaseFormValues = z.infer<typeof CaseFormSchema>;
type PalletFormValues = z.infer<typeof PalletFormSchema>;

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-destructive">{error}</p>;
}

export function ReceivingWorkspace({
  order,
  rooms,
  locations,
}: {
  order: ReceivingOrder;
  rooms: Room[];
  locations: Location[];
}) {
  const router = useRouter();
  const editable = order.status === "draft" || order.status === "in-progress";
  const setWorking = useReceivingSession((state) => state.setWorking);
  const workingPalletId =
    useReceivingSession((state) =>
      state.orderId === order.id ? state.palletId : null,
    ) ?? order.workingPalletId;
  const workingPallet =
    order.pallets.find((pallet) => pallet.id === workingPalletId) ??
    order.pallets.at(-1) ??
    null;

  useEffect(() => {
    setWorking(order.id, workingPallet?.id ?? null);
  }, [order.id, setWorking, workingPallet?.id]);

  return (
    <div className="grid gap-6">
      {editable ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_1fr]">
          <AddPalletForm orderId={order.id} />
          <WorkingCaseForm
            orderId={order.id}
            pallet={workingPallet}
            rooms={rooms}
            locations={locations}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Pallets</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {order.pallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pallets yet. Add the pallet you are working on to start
              scanning cases.
            </p>
          ) : (
            order.pallets.map((pallet) => (
              <button
                key={pallet.id}
                type="button"
                disabled={!editable}
                onClick={() => {
                  setWorking(order.id, pallet.id);
                  void selectWorkingPallet(order.id, pallet.id).then(() =>
                    router.refresh(),
                  );
                }}
                className={cn(
                  "rounded-lg border border-border px-3 py-3 text-left transition-colors",
                  workingPallet?.id === pallet.id
                    ? "bg-muted"
                    : "hover:bg-muted/50",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Pallet {pallet.palletNumber}
                    {pallet.isPartial ? " · partial" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pallet.actualCaseCount}/{pallet.expectedCaseCount || "?"} cases
                    · {pallet.actualSkuCount}/{pallet.expectedSkuCount || "?"} SKUs
                  </p>
                </div>
                {pallet.cases.length > 0 ? (
                  <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    {pallet.cases.map((item) => (
                      <li key={item.id}>
                        {item.sku} · UPC {item.upc} · qty {item.quantityInCase}
                        {item.fiber?.isFiber
                          ? ` · fiber ${item.fiber.connectionType ?? ""} ${item.fiber.strandCount ?? ""}ct`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {editable ? <ReceivingActions orderId={order.id} /> : null}
    </div>
  );
}

function AddPalletForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const setWorking = useReceivingSession((state) => state.setWorking);
  const form = useForm<PalletFormValues>({
    resolver: zodResolver(PalletFormSchema),
    defaultValues: {
      palletNumber: "",
      isPartial: false,
      partialedBy: null,
      expectedSkuCount: 0,
      expectedCaseCount: 0,
    },
  });
  const isPartial = useWatch({ control: form.control, name: "isPartial" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current pallet</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            startTransition(async () => {
              const result = await addReceivingPallet(orderId, {
                ...values,
                expectedSkuCount: Number(values.expectedSkuCount),
                expectedCaseCount: Number(values.expectedCaseCount),
                partialedBy: values.isPartial ? values.partialedBy : null,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const pallet = result.data.pallets.at(-1);
              if (pallet) setWorking(orderId, pallet.id);
              form.reset({
                palletNumber: "",
                isPartial: false,
                partialedBy: null,
                expectedSkuCount: 0,
                expectedCaseCount: 0,
              });
              router.refresh();
            });
          })}
        >
          <Field
            label="Pallet number"
            htmlFor="palletNumber"
            error={form.formState.errors.palletNumber?.message}
          >
            <Input id="palletNumber" {...form.register("palletNumber")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Expected SKUs"
              htmlFor="expectedSkuCount"
              error={form.formState.errors.expectedSkuCount?.message}
            >
              <Input
                id="expectedSkuCount"
                type="number"
                min={0}
                {...form.register("expectedSkuCount", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Expected cases"
              htmlFor="expectedCaseCount"
              error={form.formState.errors.expectedCaseCount?.message}
            >
              <Input
                id="expectedCaseCount"
                type="number"
                min={0}
                {...form.register("expectedCaseCount", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" {...form.register("isPartial")} />
            Partial pallet
          </label>
          {isPartial ? (
            <Field
              label="Partialed by"
              htmlFor="partialedBy"
              error={form.formState.errors.partialedBy?.message}
            >
              <Input id="partialedBy" {...form.register("partialedBy")} />
            </Field>
          ) : null}
          <ErrorText error={error} />
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add pallet"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function WorkingCaseForm({
  orderId,
  pallet,
  rooms,
  locations,
}: {
  orderId: string;
  pallet: ReceivingOrder["pallets"][number] | null;
  rooms: Room[];
  locations: Location[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CaseFormValues>({
    resolver: zodResolver(CaseFormSchema),
    defaultValues: {
      upc: "",
      sku: "",
      batch: null,
      quantityInCase: 1,
      description: "",
      isFiber: false,
      connectionType: null,
      strandCount: null,
      lengthMeters: null,
      putawayRoomId: rooms[0]?.id ?? null,
      putawayLocationId: undefined,
    },
  });

  const selectedRoomId = useWatch({
    control: form.control,
    name: "putawayRoomId",
  });
  const isFiber = useWatch({ control: form.control, name: "isFiber" });
  const roomLocations = useMemo(
    () =>
      locations.filter(
        (location) => location.isActive && location.roomId === selectedRoomId,
      ),
    [locations, selectedRoomId],
  );

  async function fillFromScan(payload: ScanPayload) {
    const code = payload.upc || payload.sku || payload.raw;
    form.setValue("upc", payload.upc || code);
    if (payload.sku) form.setValue("sku", payload.sku);
    if (payload.batch) form.setValue("batch", payload.batch);
    try {
      const response = await fetch(
        `/api/inventory/lookup?code=${encodeURIComponent(code)}`,
      );
      const json = (await response.json()) as {
        success: boolean;
        data?: Array<{
          sku: string;
          upc?: string;
          description?: string;
          batch?: string | null;
        }>;
      };
      const hit = json.data?.[0];
      if (hit) {
        form.setValue("sku", hit.sku);
        form.setValue("upc", hit.upc || payload.upc || code);
        if (hit.description) form.setValue("description", hit.description);
        if (hit.batch) form.setValue("batch", hit.batch);
      } else if (!payload.sku) {
        form.setValue("sku", code);
      }
    } catch {
      if (!payload.sku) form.setValue("sku", code);
    }
  }

  if (!pallet) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pallet contents</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Add or select a pallet to record case items, including fiber details
            and putaway location.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Working on pallet {pallet.palletNumber}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ScanInput
          onScan={(payload) => void fillFromScan(payload)}
          placeholder="Scan UPC, SKU, or product QR to fill this case"
        />
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            startTransition(async () => {
              const result = await addReceivingCase(orderId, pallet.id, {
                upc: values.upc,
                sku: values.sku,
                batch: values.batch,
                quantityInCase: Number(values.quantityInCase),
                description: values.description,
                putawayRoomId: values.putawayRoomId,
                putawayLocationId: values.putawayLocationId,
                fiber: values.isFiber
                  ? {
                      isFiber: true,
                      connectionType: values.connectionType || null,
                      strandCount: values.strandCount
                        ? Number(values.strandCount)
                        : null,
                      lengthMeters: values.lengthMeters
                        ? Number(values.lengthMeters)
                        : null,
                    }
                  : null,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              form.reset({
                ...form.getValues(),
                upc: "",
                sku: "",
                batch: null,
                quantityInCase: 1,
                description: "",
                isFiber: false,
                connectionType: null,
                strandCount: null,
                lengthMeters: null,
              });
              router.refresh();
            });
          })}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="UPC" htmlFor="upc" error={form.formState.errors.upc?.message}>
              <Input id="upc" {...form.register("upc")} />
            </Field>
            <Field label="SKU" htmlFor="sku" error={form.formState.errors.sku?.message}>
              <Input id="sku" {...form.register("sku")} />
            </Field>
            <Field label="Batch" htmlFor="batch">
              <Input id="batch" {...form.register("batch")} />
            </Field>
            <Field
              label="Quantity in case"
              htmlFor="quantityInCase"
              error={form.formState.errors.quantityInCase?.message}
            >
              <Input
                id="quantityInCase"
                type="number"
                min={1}
                {...form.register("quantityInCase", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <Field
            label="Description"
            htmlFor="description"
            error={form.formState.errors.description?.message}
          >
            <Input id="description" {...form.register("description")} />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" {...form.register("isFiber")} />
            Fiber item
          </label>
          {isFiber ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Connection">
                <NativeSelect {...form.register("connectionType")}>
                  <option value="">Select</option>
                  {CONNECTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Strand count">
                <NativeSelect {...form.register("strandCount", { valueAsNumber: true })}>
                  <option value="">Select</option>
                  {STRAND_COUNTS.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Length (m)">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  {...form.register("lengthMeters", { valueAsNumber: true })}
                />
              </Field>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Putaway room">
              <NativeSelect
                {...form.register("putawayRoomId")}
                onChange={(event) => {
                  form.setValue("putawayRoomId", event.target.value);
                  form.setValue("putawayLocationId", "" as never);
                }}
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Putaway location"
              error={form.formState.errors.putawayLocationId?.message}
            >
              <NativeSelect {...form.register("putawayLocationId")}>
                <option value="">Select location</option>
                {roomLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <ErrorText error={error} />
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add case to pallet"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ReceivingActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const clear = useReceivingSession((state) => state.clear);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await completeReceiving(orderId);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            clear();
            router.push("/inventory");
            router.refresh();
          });
        }}
      >
        Complete receiving & put away
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await cancelReceiving(orderId);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            clear();
            router.push("/receiving");
            router.refresh();
          });
        }}
      >
        Cancel order
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
