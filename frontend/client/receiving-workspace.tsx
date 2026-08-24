"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CONNECTION_TYPES,
  STRAND_COUNTS,
  isReceivingEditable,
  type CaseItem,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import {
  defaultReopenExpectedPalletCount,
  hasPostedPutaway,
  isCasePutawayPosted,
  remainingExpectedPallets,
} from "@/lib/receiving/reopen";
import {
  addReceivingCase,
  addReceivingPallet,
  cancelReceiving,
  completeReceiving,
  removeReceivingCase,
  selectWorkingPallet,
  updateReceivingCase,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { ScanInput } from "@/frontend/client/scan-input";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import { LIMITS } from "@/lib/validation/limits";
import { useReceivingSession } from "@/frontend/client/receiving-session";
import { cn } from "@/lib/utils";
import type { ScanPayload } from "@/lib/scan-code";
import {
  resolveReceivingProductCodes,
  type KnownProduct,
} from "@/lib/codes/product-codes";
import { LabelPrintSheet } from "@/frontend/client/label-sheet";
import { buildInboundLabels } from "@/lib/labels/build-labels";

const PalletFormSchema = z.object({
  palletNumber: z.string().trim().min(1),
  isPartial: z.boolean(),
  partialedBy: z.string().nullable(),
  expectedSkuCount: z.number().int().min(0),
  expectedCaseCount: z.number().int().min(0),
});

const CaseFormSchema = z
  .object({
    upc: z.string().trim(),
    sku: z.string().trim(),
    generateSku: z.boolean(),
    generateUpc: z.boolean(),
    batch: z.string().nullable(),
    quantityInCase: z.number().int().min(1),
    description: z.string().trim().min(1, "Enter a case / item description."),
    isFiber: z.boolean(),
    connectionType: z.string().nullable(),
    strandCount: z.number().nullable(),
    lengthMeters: z.number().nullable(),
  })
  .superRefine((values, ctx) => {
    if (!values.generateSku && values.sku.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["sku"],
        message:
          "Enter a vendor SKU or auto-generate one after adding a description.",
      });
    }
    if (!values.generateUpc && values.upc.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["upc"],
        message:
          "Enter a vendor UPC or auto-generate one after adding a description.",
      });
    }
  });

type CaseFormValues = z.infer<typeof CaseFormSchema>;
type PalletFormValues = z.infer<typeof PalletFormSchema>;
type EditingLine = { palletId: string; caseId: string };

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-destructive">{error}</p>;
}

function emptyCaseValues(): CaseFormValues {
  return {
    upc: "",
    sku: "",
    generateSku: false,
    generateUpc: false,
    batch: null,
    quantityInCase: 1,
    description: "",
    isFiber: false,
    connectionType: null,
    strandCount: null,
    lengthMeters: null,
  };
}

function valuesFromCase(item: CaseItem): CaseFormValues {
  return {
    upc: item.upc,
    sku: item.sku,
    generateSku: false,
    generateUpc: false,
    batch: item.batch,
    quantityInCase: item.quantityInCase,
    description: item.description,
    isFiber: Boolean(item.fiber?.isFiber),
    connectionType: item.fiber?.connectionType ?? null,
    strandCount: item.fiber?.strandCount ?? null,
    lengthMeters: item.fiber?.lengthMeters ?? null,
  };
}

export function ReceivingWorkspace({
  order,
  knownProducts,
  canReopen = false,
}: {
  order: ReceivingOrder;
  knownProducts: KnownProduct[];
  canReopen?: boolean;
}) {
  const router = useRouter();
  const editable = isReceivingEditable(order.status);
  const setWorking = useReceivingSession((state) => state.setWorking);
  const workingPalletId =
    useReceivingSession((state) =>
      state.orderId === order.id ? state.palletId : null,
    ) ?? order.workingPalletId;
  const workingPallet =
    order.pallets.find((pallet) => pallet.id === workingPalletId) ??
    order.pallets.find((pallet) =>
      pallet.cases.some((item) => !isCasePutawayPosted(item)),
    ) ??
    (editable ? null : order.pallets.at(-1)) ??
    null;
  const [editing, setEditing] = useState<EditingLine | null>(null);
  const editingCase =
    editing == null
      ? null
      : (order.pallets
          .find((pallet) => pallet.id === editing.palletId)
          ?.cases.find((item) => item.id === editing.caseId) ?? null);

  useEffect(() => {
    setWorking(order.id, workingPallet?.id ?? null);
  }, [order.id, setWorking, workingPallet?.id]);

  function selectPallet(palletId: string) {
    if (editing && editing.palletId !== palletId) setEditing(null);
    setWorking(order.id, palletId);
    void selectWorkingPallet(order.id, palletId).then(() => router.refresh());
  }

  function startEdit(palletId: string, caseId: string) {
    setEditing({ palletId, caseId });
    setWorking(order.id, palletId);
    void selectWorkingPallet(order.id, palletId).then(() => router.refresh());
  }

  return (
    <div className="grid gap-6">
      {editable ? (
        <div className="grid gap-6 min-[56rem]:grid-cols-[minmax(0,22rem)_1fr]">
          <AddPalletForm orderId={order.id} />
          <WorkingCaseForm
            key={editingCase?.id ?? "new-case"}
            orderId={order.id}
            pallet={workingPallet}
            knownProducts={knownProducts}
            editingCase={editingCase}
            onCancelEdit={() => setEditing(null)}
            onSaved={() => setEditing(null)}
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
              <PalletCard
                key={pallet.id}
                pallet={pallet}
                editable={editable}
                isWorking={workingPallet?.id === pallet.id}
                editingCaseId={editingCase?.id ?? null}
                onSelect={() => selectPallet(pallet.id)}
                onEdit={(caseId) => startEdit(pallet.id, caseId)}
                onRemoved={(caseId) => {
                  if (editing?.caseId === caseId) setEditing(null);
                  router.refresh();
                }}
                orderId={order.id}
              />
            ))
          )}
        </CardContent>
      </Card>

      {order.status === "received" || order.status === "completed" ? (
        <Card className="print:border-0 print:shadow-none print:ring-0">
          <CardHeader className="print:hidden">
            <CardTitle>Inbound freight labels</CardTitle>
          </CardHeader>
          <CardContent>
            <LabelPrintSheet
              printId="inbound-labels"
              title="Print inbound labels"
              description="Print case labels after receiving so putaway and inventory can scan the freight."
              labels={buildInboundLabels(order)}
            />
          </CardContent>
        </Card>
      ) : null}

      {order.status === "received" ? (
        <ReceivedOrderActions
          order={order}
          canCancel={!hasPostedPutaway(order)}
          canReopen={canReopen}
        />
      ) : null}

      {order.status === "completed" ? (
        <CompletedOrderActions order={order} canReopen={canReopen} />
      ) : null}

      {editable ? (
        <ReceivingActions
          orderId={order.id}
          canCancel={!hasPostedPutaway(order)}
          totalUnits={order.pallets.reduce(
            (sum, pallet) =>
              sum +
              pallet.cases.reduce(
                (caseSum, item) =>
                  isCasePutawayPosted(item)
                    ? caseSum
                    : caseSum + item.quantityInCase,
                0,
              ),
            0,
          )}
        />
      ) : null}
    </div>
  );
}

function PalletCard({
  orderId,
  pallet,
  editable,
  isWorking,
  editingCaseId,
  onSelect,
  onEdit,
  onRemoved,
}: {
  orderId: string;
  pallet: ReceivingOrder["pallets"][number];
  editable: boolean;
  isWorking: boolean;
  editingCaseId: string | null;
  onSelect: () => void;
  onEdit: (caseId: string) => void;
  onRemoved: (caseId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className={cn(
        "rounded-lg border border-border transition-colors",
        isWorking ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        disabled={!editable}
        onClick={onSelect}
        className="w-full px-3 py-3 text-left"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Pallet {pallet.palletNumber}
            {pallet.isPartial ? " · partial" : ""}
            {isWorking ? " · working" : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {pallet.actualCaseCount}/{pallet.expectedCaseCount || "?"} cases
            · {pallet.actualSkuCount}/{pallet.expectedSkuCount || "?"} SKUs
          </p>
        </div>
      </button>
      {pallet.cases.length > 0 ? (
        <ul className="grid gap-1 border-t border-border px-3 py-2">
          {pallet.cases.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex flex-wrap items-start justify-between gap-2 rounded-md px-1 py-1 text-xs",
                editingCaseId === item.id ? "bg-background" : "",
              )}
            >
              <div className="min-w-0 text-muted-foreground">
                <p>
                  {item.sku} · UPC {item.upc} · qty {item.quantityInCase}
                  {item.fiber?.isFiber
                    ? ` · fiber ${item.fiber.connectionType ?? ""} ${item.fiber.strandCount ?? ""}ct`
                    : ""}
                </p>
                <p>{item.description}</p>
              </div>
              {editable && !isCasePutawayPosted(item) ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onEdit(item.id)}
                  >
                    {editingCaseId === item.id ? "Editing" : "Edit"}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Remove ${item.sku} from pallet ${pallet.palletNumber}?`,
                        )
                      ) {
                        return;
                      }
                      setError(null);
                      startTransition(async () => {
                        const result = await removeReceivingCase(
                          orderId,
                          pallet.id,
                          item.id,
                        );
                        if (!result.ok) {
                          setError(result.error);
                          return;
                        }
                        onRemoved(item.id);
                      });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : isCasePutawayPosted(item) ? (
                <p className="shrink-0 text-[0.65rem] text-muted-foreground">
                  On-hand
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText error={error} />
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
  knownProducts,
  editingCase,
  onCancelEdit,
  onSaved,
}: {
  orderId: string;
  pallet: ReceivingOrder["pallets"][number] | null;
  knownProducts: KnownProduct[];
  editingCase: CaseItem | null;
  onCancelEdit: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const form = useForm<CaseFormValues>({
    resolver: zodResolver(CaseFormSchema),
    defaultValues: editingCase ? valuesFromCase(editingCase) : emptyCaseValues(),
  });

  const catalog = useMemo(
    () =>
      knownProducts.filter((product) => product.caseId !== editingCase?.id),
    [knownProducts, editingCase?.id],
  );

  const isFiber = useWatch({ control: form.control, name: "isFiber" });
  const quantityInCase = useWatch({
    control: form.control,
    name: "quantityInCase",
  });
  const description = useWatch({ control: form.control, name: "description" });
  const generateSku = useWatch({ control: form.control, name: "generateSku" });
  const generateUpc = useWatch({ control: form.control, name: "generateUpc" });
  const canAutoGenerate = Boolean(description?.trim());

  async function fillFromScan(payload: ScanPayload) {
    const code = payload.upc || payload.sku || payload.raw;
    form.setValue("upc", payload.upc || code);
    form.setValue("generateUpc", false);
    form.setValue("generateSku", false);
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

  function autoGenerate(kind: "sku" | "upc" | "both") {
    setError(null);
    const values = form.getValues();
    if (!values.description.trim()) {
      setError(
        "Enter a case / item description before auto-generating a UPC or SKU.",
      );
      return;
    }
    try {
      const codes = resolveReceivingProductCodes({
        description: values.description,
        sku: kind === "sku" || kind === "both" ? "" : values.sku,
        upc: kind === "upc" || kind === "both" ? "" : values.upc,
        generateSku: kind === "sku" || kind === "both",
        generateUpc: kind === "upc" || kind === "both",
        products: catalog,
      });
      if (kind === "sku" || kind === "both") {
        form.setValue("sku", codes.sku, { shouldValidate: true });
        form.setValue("generateSku", true);
      }
      if (kind === "upc" || kind === "both") {
        form.setValue("upc", codes.upc, { shouldValidate: true });
        form.setValue("generateUpc", true);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to auto-generate unique codes.",
      );
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
            Add or select a pallet to record case items, including fiber details.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editingCase
            ? `Edit case on pallet ${pallet.palletNumber}`
            : `Working on pallet ${pallet.palletNumber}`}
        </CardTitle>
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
              const payload = {
                upc: values.upc,
                sku: values.sku,
                generateSku: values.generateSku,
                generateUpc: values.generateUpc,
                batch: values.batch,
                quantityInCase: Number(values.quantityInCase),
                description: values.description,
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
                ...largeInputPayload(
                  Number(values.quantityInCase),
                  confirmLargeInput,
                  confirmationQuantity,
                ),
              };
              const result = editingCase
                ? await updateReceivingCase(
                    orderId,
                    pallet.id,
                    editingCase.id,
                    payload,
                  )
                : await addReceivingCase(orderId, pallet.id, payload);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              onSaved();
              form.reset(emptyCaseValues());
              router.refresh();
            });
          })}
        >
          <Field
            label="Case / item description"
            htmlFor="description"
            error={form.formState.errors.description?.message}
          >
            <Input id="description" {...form.register("description")} />
          </Field>
          <p className="text-xs text-muted-foreground">
            If the vendor did not provide a UPC or SKU, enter the description
            first, then auto-generate unique codes. Duplicate UPCs and SKUs are
            not allowed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canAutoGenerate || pending}
              onClick={() => autoGenerate("sku")}
            >
              Auto-generate SKU
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canAutoGenerate || pending}
              onClick={() => autoGenerate("upc")}
            >
              Auto-generate UPC
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canAutoGenerate || pending}
              onClick={() => autoGenerate("both")}
            >
              Auto-generate both
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={generateUpc ? "UPC (auto-generated)" : "UPC"}
              htmlFor="upc"
              error={form.formState.errors.upc?.message}
            >
              <Input
                id="upc"
                {...form.register("upc", {
                  onChange: () => form.setValue("generateUpc", false),
                })}
              />
            </Field>
            <Field
              label={generateSku ? "SKU (auto-generated)" : "SKU"}
              htmlFor="sku"
              error={form.formState.errors.sku?.message}
            >
              <Input
                id="sku"
                {...form.register("sku", {
                  onChange: () => form.setValue("generateSku", false),
                })}
              />
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
          <LargeInputConfirm
            total={Number(quantityInCase) || 0}
            threshold={LIMITS.largeQuantity}
            label="case quantity"
            confirmed={confirmLargeInput}
            onConfirmedChange={setConfirmLargeInput}
            confirmationQuantity={confirmationQuantity}
            onConfirmationQuantityChange={setConfirmationQuantity}
          />
          <ErrorText error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending
                ? editingCase
                  ? "Saving…"
                  : "Adding…"
                : editingCase
                  ? "Save case changes"
                  : "Add case to pallet"}
            </Button>
            {editingCase ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  onCancelEdit();
                  form.reset(emptyCaseValues());
                  setError(null);
                }}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ReopenAsPartialControls({ order }: { order: ReceivingOrder }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remaining = remainingExpectedPallets(order);
  const needsExpectedCount = remaining === 0;
  const [expectedPalletCount, setExpectedPalletCount] = useState(
    defaultReopenExpectedPalletCount(order),
  );

  function reopen() {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/receiving/${order.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          needsExpectedCount
            ? { action: "reopen", expectedPalletCount }
            : { action: "reopen" },
        ),
      });
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !json?.success) {
        setError(json?.error || "Unable to reopen this order.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        reopen();
      }}
    >
      {needsExpectedCount ? (
        <Field label="Expected pallets" htmlFor="reopen-expected-pallets">
          <Input
            id="reopen-expected-pallets"
            type="number"
            min={order.pallets.length + 1}
            value={expectedPalletCount}
            onChange={(event) =>
              setExpectedPalletCount(Number(event.target.value) || 0)
            }
          />
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">
          {remaining} pallet{remaining === 1 ? "" : "s"} still expected. Reopen
          as a partialed PO so remaining freight can be checked in.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Reopening…" : "Reopen as partialed"}
        </Button>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

function CompletedOrderActions({
  order,
  canReopen,
}: {
  order: ReceivingOrder;
  canReopen: boolean;
}) {
  const remaining = remainingExpectedPallets(order);

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Completed</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          This order has been put away. On-hand inventory includes these cases.
          {order.isPartialed
            ? " It is marked partialed until remaining freight is received."
            : remaining > 0
              ? ` It was closed with ${order.pallets.length} of ${order.loadPalletCount} expected pallets.`
              : ""}
        </p>
        {canReopen ? <ReopenAsPartialControls order={order} /> : null}
      </CardContent>
    </Card>
  );
}

function ReceivedOrderActions({
  order,
  canCancel = true,
  canReopen = false,
}: {
  order: ReceivingOrder;
  canCancel?: boolean;
  canReopen?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const clear = useReceivingSession((state) => state.clear);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receiving complete</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Cases are checked in. Assign bin locations in putaway to add this
          stock to on-hand inventory.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button nativeButton={false} render={<Link href={`/putaway/${order.id}`} />}>
            Open putaway
          </Button>
          {canCancel ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await cancelReceiving(order.id);
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
          ) : null}
          <ErrorText error={error} />
        </div>
        {canReopen ? <ReopenAsPartialControls order={order} /> : null}
      </CardContent>
    </Card>
  );
}

function ReceivingActions({
  orderId,
  totalUnits,
  canCancel = true,
}: {
  orderId: string;
  totalUnits: number;
  canCancel?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const clear = useReceivingSession((state) => state.clear);

  return (
    <div className="grid gap-3">
      <LargeInputConfirm
        total={totalUnits}
        threshold={LIMITS.largeQuantity}
        label="receiving total"
        confirmed={confirmLargeInput}
        onConfirmedChange={setConfirmLargeInput}
        confirmationQuantity={confirmationQuantity}
        onConfirmationQuantityChange={setConfirmationQuantity}
      />
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await completeReceiving(
              orderId,
              largeInputPayload(
                totalUnits,
                confirmLargeInput,
                confirmationQuantity,
              ),
            );
            if (!result.ok) {
              setError(result.error);
              return;
            }
            clear();
            router.push(`/receiving/${orderId}`);
            router.refresh();
          });
        }}
      >
        Complete receiving
      </Button>
      {canCancel ? (
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
      ) : null}
      <ErrorText error={error} />
    </div>
    </div>
  );
}
