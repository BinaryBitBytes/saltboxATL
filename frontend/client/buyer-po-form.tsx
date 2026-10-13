"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBuyerPurchaseOrder } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/frontend/client/field";
import {
  LargeInputConfirm,
  largeInputPayload,
} from "@/frontend/client/large-input-confirm";
import { localDateTimeValue, toIsoDateTime } from "@/lib/format";
import { LIMITS } from "@/lib/validation/limits";

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

function emptyLine(): LineDraft {
  return {
    key: nextLineKey(),
    sku: "",
    upc: "",
    description: "",
    quantity: "1",
  };
}

export function BuyerPoForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [projectId, setProjectId] = useState("");
  const [vendor, setVendor] = useState("");
  const [carrier, setCarrier] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [expectedArrival, setExpectedArrival] = useState(localDateTimeValue());
  const [expectedPalletCount, setExpectedPalletCount] = useState("1");
  const [status, setStatus] = useState<"expected" | "in-transit" | "cancelled">(
    "expected",
  );
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");

  const expectedUnits = lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0),
    0,
  );

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const expectedArrivalAt = toIsoDateTime(expectedArrival);
    if (!expectedArrivalAt) {
      setError("Enter the expected arrival date and time.");
      return;
    }
    startTransition(async () => {
      const result = await saveBuyerPurchaseOrder({
        purchaseOrderNumber,
        projectId,
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
      setPurchaseOrderNumber("");
      setProjectId("");
      setVendor("");
      setCarrier("");
      setBuyerName("");
      setNotes("");
      setLines([emptyLine()]);
      setConfirmLargeInput(false);
      setConfirmationQuantity("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buyer PO number" htmlFor="buyer-po">
          <Input
            id="buyer-po"
            value={purchaseOrderNumber}
            onChange={(event) => setPurchaseOrderNumber(event.target.value)}
            required
          />
        </Field>
        <Field label="Project ID" htmlFor="project-id">
          <Input
            id="project-id"
            value={projectId}
            maxLength={LIMITS.code}
            placeholder="Buyer project reference"
            onChange={(event) => setProjectId(event.target.value)}
          />
        </Field>
        <Field label="Vendor" htmlFor="buyer-vendor">
          <Input
            id="buyer-vendor"
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            required
          />
        </Field>
        <Field label="Carrier" htmlFor="buyer-carrier">
          <Input
            id="buyer-carrier"
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
            required
          />
        </Field>
        <Field label="Expected arrival" htmlFor="expected-arrival">
          <Input
            id="expected-arrival"
            type="datetime-local"
            value={expectedArrival}
            onChange={(event) => setExpectedArrival(event.target.value)}
            required
          />
        </Field>
        <Field label="Buyer name" htmlFor="buyer-name">
          <Input
            id="buyer-name"
            value={buyerName}
            onChange={(event) => setBuyerName(event.target.value)}
          />
        </Field>
        <Field label="Expected pallets" htmlFor="expected-pallets">
          <Input
            id="expected-pallets"
            type="number"
            min={0}
            value={expectedPalletCount}
            onChange={(event) => setExpectedPalletCount(event.target.value)}
          />
        </Field>
        <Field label="Status" htmlFor="expectation-status">
          <NativeSelect
            id="expectation-status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as typeof status)
            }
          >
            <option value="expected">Expected</option>
            <option value="in-transit">In transit</option>
            <option value="cancelled">Cancelled</option>
          </NativeSelect>
        </Field>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Expected contents</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((current) => [...current, emptyLine()])}
          >
            Add line
          </Button>
        </div>
        {lines.map((line, index) => (
          <div
            key={line.key}
            className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-12"
          >
            <Field label="SKU" htmlFor={`sku-${line.key}`} className="sm:col-span-3">
              <Input
                id={`sku-${line.key}`}
                value={line.sku}
                onChange={(event) => updateLine(line.key, { sku: event.target.value })}
              />
            </Field>
            <Field label="UPC" htmlFor={`upc-${line.key}`} className="sm:col-span-3">
              <Input
                id={`upc-${line.key}`}
                value={line.upc}
                onChange={(event) => updateLine(line.key, { upc: event.target.value })}
              />
            </Field>
            <Field
              label="Description"
              htmlFor={`desc-${line.key}`}
              className="sm:col-span-4"
            >
              <Input
                id={`desc-${line.key}`}
                value={line.description}
                onChange={(event) =>
                  updateLine(line.key, { description: event.target.value })
                }
              />
            </Field>
            <Field label="Qty" htmlFor={`qty-${line.key}`} className="sm:col-span-1">
              <Input
                id={`qty-${line.key}`}
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
            <span className="sr-only">Line {index + 1}</span>
          </div>
        ))}
      </div>

      <Field label="Notes" htmlFor="buyer-notes">
        <Textarea
          id="buyer-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What the dock should expect before the freight arrives"
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

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save buyer PO"}
        </Button>
      </div>
    </form>
  );
}
