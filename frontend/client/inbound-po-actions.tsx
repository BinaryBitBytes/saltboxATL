"use client";

import { T, useT } from "@/frontend/client/language";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelInboundPurchaseOrder,
  deleteInboundPurchaseOrder,
  updateInboundPurchaseOrder,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/frontend/client/field";
import {
  LargeInputConfirm,
  largeInputPayload,
} from "@/frontend/client/large-input-confirm";
import { localDateTimeValue, toIsoDateTime } from "@/lib/format";
import {
  INBOUND_CANCEL_CONFIRMATION,
  INBOUND_DELETE_CONFIRMATION,
  INBOUND_DOCK_DELETE_CONFIRMATION,
} from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";

export type InboundPoDraft = {
  id: string;
  purchaseOrderNumber: string;
  projectId: string;
  jobIdNumber: string;
  vendor: string;
  carrier: string;
  expectedArrivalAt: string;
  buyerName: string;
  notes: string;
  expectationStatus: "expected" | "in-transit" | "cancelled";
  expectedPalletCount: number;
  lines: Array<{
    sku: string;
    upc: string;
    description: string;
    quantity: number;
  }>;
};

type LineDraft = {
  key: string;
  sku: string;
  upc: string;
  description: string;
  quantity: string;
};

function nextLineKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function arrivalValue(iso: string): string {
  if (!iso) return localDateTimeValue();
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return localDateTimeValue();
  return localDateTimeValue(date);
}

function linesFromOrder(order: InboundPoDraft): LineDraft[] {
  if (order.lines.length === 0) {
    return [
      { key: nextLineKey(), sku: "", upc: "", description: "", quantity: "1" },
    ];
  }
  return order.lines.map((line) => ({
    key: nextLineKey(),
    sku: line.sku,
    upc: line.upc,
    description: line.description,
    quantity: String(line.quantity),
  }));
}

export function InboundPoActions({
  order,
  freightOnDock = false,
  canDeleteDockFreight = false,
}: {
  order: InboundPoDraft;
  freightOnDock?: boolean;
  canDeleteDockFreight?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [cancelConfirmText, setCancelConfirmText] = useState("");
  const [dockConfirmText, setDockConfirmText] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(order.purchaseOrderNumber);
  const [projectId, setProjectId] = useState(order.projectId);
  const [jobIdNumber, setJobIdNumber] = useState(order.jobIdNumber);
  const [vendor, setVendor] = useState(order.vendor);
  const [carrier, setCarrier] = useState(order.carrier);
  const [buyerName, setBuyerName] = useState(order.buyerName);
  const [expectedArrival, setExpectedArrival] = useState(arrivalValue(order.expectedArrivalAt));
  const [expectedPalletCount, setExpectedPalletCount] = useState(
    String(order.expectedPalletCount),
  );
  const [status, setStatus] = useState(order.expectationStatus);
  const [notes, setNotes] = useState(order.notes);
  const [lines, setLines] = useState<LineDraft[]>(() => linesFromOrder(order));
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");

  const expectedUnits = lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0),
    0,
  );
  const fieldId = (name: string) => `${order.id}-${name}`;

  function openEdit() {
    setPurchaseOrderNumber(order.purchaseOrderNumber);
    setProjectId(order.projectId);
    setJobIdNumber(order.jobIdNumber);
    setVendor(order.vendor);
    setCarrier(order.carrier);
    setBuyerName(order.buyerName);
    setExpectedArrival(arrivalValue(order.expectedArrivalAt));
    setExpectedPalletCount(String(order.expectedPalletCount));
    setStatus(order.expectationStatus);
    setNotes(order.notes);
    setLines(linesFromOrder(order));
    setConfirmLargeInput(false);
    setConfirmationQuantity("");
    setError(null);
    setDeleting(false);
    setCancelling(false);
    setEditing(true);
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const expectedArrivalAt = toIsoDateTime(expectedArrival);
    if (!expectedArrivalAt) {
      setError("Enter the expected arrival date and time.");
      return;
    }
    startTransition(async () => {
      const result = await updateInboundPurchaseOrder({
        id: order.id,
        purchaseOrderNumber,
        projectId,
        jobIdNumber,
        vendor,
        carrier,
        buyerName,
        expectedArrivalAt,
        expectedPalletCount: Number(expectedPalletCount) || 0,
        expectationStatus: status,
        notes,
        lines: lines.map((line) => ({
          sku: line.sku,
          upc: line.upc,
          description: line.description,
          quantity: Number(line.quantity),
        })),
        ...largeInputPayload(
          expectedUnits,
          confirmLargeInput,
          confirmationQuantity,
          LIMITS.largeQuantity,
        ),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function remove(event: React.FormEvent) {
    event.preventDefault();
    if (confirmText !== INBOUND_DELETE_CONFIRMATION) return;
    if (
      freightOnDock &&
      (!canDeleteDockFreight || dockConfirmText !== INBOUND_DOCK_DELETE_CONFIRMATION)
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteInboundPurchaseOrder({
        id: order.id,
        confirmText,
        dockConfirmText: freightOnDock ? dockConfirmText : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleting(false);
      setConfirmText("");
      router.refresh();
    });
  }

  function cancelPurchaseOrder(event: React.FormEvent) {
    event.preventDefault();
    if (cancelConfirmText !== INBOUND_CANCEL_CONFIRMATION) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelInboundPurchaseOrder({
        id: order.id,
        confirmText: cancelConfirmText,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCancelling(false);
      setCancelConfirmText("");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={openEdit} disabled={pending}>
          Edit entry
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => {
            setEditing(false);
            setCancelling(false);
            setError(null);
            setConfirmText("");
            setDockConfirmText("");
            setDeleting(true);
          }}
          disabled={pending}
        >
          Delete entry
        </Button>
        {freightOnDock && order.expectationStatus !== "cancelled" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditing(false);
              setDeleting(false);
              setError(null);
              setCancelConfirmText("");
              setCancelling(true);
            }}
            disabled={pending}
          >
            Cancel PO
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={save} className="grid gap-4 rounded-md border border-border p-3">
          <p className="text-sm text-muted-foreground">
            <T>
              Correct the fields that were read from the PDF. Saving updates this inbound entry and its expected receiving load.
            </T>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Buyer PO number" htmlFor={fieldId("po")}>
              <Input
                id={fieldId("po")}
                value={purchaseOrderNumber}
                onChange={(event) => setPurchaseOrderNumber(event.target.value)}
                required
              />
            </Field>
            <Field label="Project ID" htmlFor={fieldId("project")}>
              <Input
                id={fieldId("project")}
                value={projectId}
                maxLength={LIMITS.code}
                onChange={(event) => setProjectId(event.target.value)}
              />
            </Field>
            <Field label="Job ID" htmlFor={fieldId("job")}>
              <Input
                id={fieldId("job")}
                value={jobIdNumber}
                maxLength={LIMITS.code}
                onChange={(event) => setJobIdNumber(event.target.value)}
              />
            </Field>
            <Field label="Vendor" htmlFor={fieldId("vendor")}>
              <Input
                id={fieldId("vendor")}
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
                required
              />
            </Field>
            <Field label="Carrier" htmlFor={fieldId("carrier")}>
              <Input
                id={fieldId("carrier")}
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                required
              />
            </Field>
            <Field label="Expected arrival" htmlFor={fieldId("arrival")}>
              <Input
                id={fieldId("arrival")}
                type="datetime-local"
                value={expectedArrival}
                onChange={(event) => setExpectedArrival(event.target.value)}
                required
              />
            </Field>
            <Field label="Buyer name" htmlFor={fieldId("buyer")}>
              <Input
                id={fieldId("buyer")}
                value={buyerName}
                onChange={(event) => setBuyerName(event.target.value)}
              />
            </Field>
            <Field label="Expected pallets" htmlFor={fieldId("pallets")}>
              <Input
                id={fieldId("pallets")}
                type="number"
                min={0}
                value={expectedPalletCount}
                onChange={(event) => setExpectedPalletCount(event.target.value)}
              />
            </Field>
            <Field label="Status" htmlFor={fieldId("status")}>
              <NativeSelect
                id={fieldId("status")}
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as InboundPoDraft["expectationStatus"])
                }
              >
                <option value="expected"><T>Expected</T></option>
                <option value="in-transit"><T>In transit</T></option>
                {freightOnDock && order.expectationStatus !== "cancelled" ? null : (
                  <option value="cancelled"><T>Cancelled</T></option>
                )}
              </NativeSelect>
            </Field>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium"><T>Expected contents</T></p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    {
                      key: nextLineKey(),
                      sku: "",
                      upc: "",
                      description: "",
                      quantity: "1",
                    },
                  ])
                }
              >
                Add line
              </Button>
            </div>
            {lines.map((line) => (
              <div
                key={line.key}
                className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-12"
              >
                <Field label="SKU" htmlFor={fieldId(`sku-${line.key}`)} className="sm:col-span-3">
                  <Input
                    id={fieldId(`sku-${line.key}`)}
                    value={line.sku}
                    onChange={(event) => updateLine(line.key, { sku: event.target.value })}
                  />
                </Field>
                <Field label="UPC" htmlFor={fieldId(`upc-${line.key}`)} className="sm:col-span-3">
                  <Input
                    id={fieldId(`upc-${line.key}`)}
                    value={line.upc}
                    onChange={(event) => updateLine(line.key, { upc: event.target.value })}
                  />
                </Field>
                <Field
                  label="Description"
                  htmlFor={fieldId(`desc-${line.key}`)}
                  className="sm:col-span-4"
                >
                  <Input
                    id={fieldId(`desc-${line.key}`)}
                    value={line.description}
                    onChange={(event) =>
                      updateLine(line.key, { description: event.target.value })
                    }
                  />
                </Field>
                <Field label="Qty" htmlFor={fieldId(`qty-${line.key}`)} className="sm:col-span-1">
                  <Input
                    id={fieldId(`qty-${line.key}`)}
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(line.key, { quantity: event.target.value })
                    }
                  />
                </Field>
                <div className="flex items-end sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((entry) => entry.key !== line.key))
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Field label="Notes" htmlFor={fieldId("notes")}>
            <Textarea
              id={fieldId("notes")}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <LargeInputConfirm
            total={expectedUnits}
            label="expected quantity"
            confirmed={confirmLargeInput}
            onConfirmedChange={setConfirmLargeInput}
            confirmationQuantity={confirmationQuantity}
            onConfirmationQuantityChange={setConfirmationQuantity}
          />

          {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {cancelling ? (
        <form
          onSubmit={cancelPurchaseOrder}
          className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-medium">
            {t("You are cancelling PO {{po}}.", { po: order.purchaseOrderNumber })}
          </p>
          <p className="text-sm text-muted-foreground">
            <T>
              Cancelling this order wipes the parsed expected entries. The PDF will have to be uploaded again by a coordinator if you proceed.
            </T>
          </p>
          <Field label="Type CancelRightMeow to continue." htmlFor={fieldId("cancel-confirm")}>
            <Input
              id={fieldId("cancel-confirm")}
              value={cancelConfirmText}
              onChange={(event) => setCancelConfirmText(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={t("Type CancelRightMeow to continue.")}
            />
          </Field>
          {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || cancelConfirmText !== INBOUND_CANCEL_CONFIRMATION}
            >
              {pending ? "Cancelling…" : "Cancel this PO"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setCancelling(false);
                setCancelConfirmText("");
                setError(null);
              }}
            >
              Keep order
            </Button>
          </div>
        </form>
      ) : null}

      {deleting ? (
        <form
          onSubmit={remove}
          className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-medium">
            {t("You are deleting PO {{po}}.", { po: order.purchaseOrderNumber })}
          </p>
          <p className="text-sm text-muted-foreground">
            {freightOnDock ? (
              canDeleteDockFreight ? (
                <T>
                  This purchase order has freight on the dock. Deleting it removes the dock receipt and balances any inventory that was put away from it. A coordinator can do this 5 times per day. This cannot be undone.
                </T>
              ) : (
                <T>
                  This purchase order has freight on the dock. Only a coordinator can delete it.
                </T>
              )
            ) : (
              <T>
                This removes this inbound card, its saved PDF, and the expected receiving load. It does not remove freight the dock has already started. This cannot be undone.
              </T>
            )}
          </p>
          {freightOnDock && !canDeleteDockFreight ? null : (
            <Field label="Type DELETE to confirm." htmlFor={fieldId("delete-confirm")}>
              <Input
                id={fieldId("delete-confirm")}
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label={t("Type DELETE to confirm.")}
              />
            </Field>
          )}
          {freightOnDock && canDeleteDockFreight && confirmText === INBOUND_DELETE_CONFIRMATION ? (
            <Field label="Type DeleteThisMeow to confirm." htmlFor={fieldId("dock-delete-confirm")}>
              <Input
                id={fieldId("dock-delete-confirm")}
                value={dockConfirmText}
                onChange={(event) => setDockConfirmText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label={t("Type DeleteThisMeow to confirm.")}
              />
            </Field>
          ) : null}
          {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
          <div className="flex flex-wrap gap-2">
            {freightOnDock && !canDeleteDockFreight ? null : (
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  pending ||
                  confirmText !== INBOUND_DELETE_CONFIRMATION ||
                  (freightOnDock && dockConfirmText !== INBOUND_DOCK_DELETE_CONFIRMATION)
                }
              >
                {pending
                  ? "Deleting…"
                  : freightOnDock
                    ? "Delete this docked PO"
                    : "Delete this entry"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setDeleting(false);
                setConfirmText("");
                setDockConfirmText("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
