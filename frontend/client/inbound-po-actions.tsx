"use client";

import { T, useT } from "@/frontend/client/language";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
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
import { INBOUND_DELETE_CONFIRMATION } from "@/lib/inventory-schema";
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

export function InboundPoActions({ order }: { order: InboundPoDraft }) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
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
    setError(null);
    startTransition(async () => {
      const result = await deleteInboundPurchaseOrder({
        id: order.id,
        confirmText,
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
            setError(null);
            setConfirmText("");
            setDeleting(true);
          }}
          disabled={pending}
        >
          Delete entry
        </Button>
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
                <option value="cancelled"><T>Cancelled</T></option>
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

      {deleting ? (
        <form
          onSubmit={remove}
          className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-medium">
            {t("You are deleting PO {{po}}.", { po: order.purchaseOrderNumber })}
          </p>
          <p className="text-sm text-muted-foreground">
            <T>
              This removes this inbound card, its saved PDF, and the expected receiving load. It does not remove freight the dock has already started. This cannot be undone.
            </T>
          </p>
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
          {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || confirmText !== INBOUND_DELETE_CONFIRMATION}
            >
              {pending ? "Deleting…" : "Delete this entry"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setDeleting(false);
                setConfirmText("");
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
