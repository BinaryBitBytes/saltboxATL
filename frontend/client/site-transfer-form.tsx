"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orderSiteTransferAction } from "@/backend/server/site-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import { T } from "@/frontend/client/language";
import { LIMITS } from "@/lib/validation/limits";

export type TransferSourceOption = {
  inventoryItemId: string;
  siteId: string;
  siteLabel: string;
  locationId: string;
  locationCode: string;
  sku: string;
  quantity: number;
};

export type TransferDestinationOption = {
  locationId: string;
  siteId: string;
  siteLabel: string;
  locationCode: string;
};

export function SiteTransferForm({
  sources,
  destinations,
}: {
  sources: TransferSourceOption[];
  destinations: TransferDestinationOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState(sources[0]?.inventoryItemId ?? "");
  const [destinationId, setDestinationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");

  const source = sources.find((entry) => entry.inventoryItemId === sourceId) ?? sources[0];
  const destinationChoices = useMemo(
    () => destinations.filter((entry) => entry.siteId !== source?.siteId),
    [destinations, source?.siteId],
  );
  const destination =
    destinationChoices.find((entry) => entry.locationId === destinationId) ??
    destinationChoices[0];

  if (!source || !destination) {
    return (
      <p className="text-sm text-muted-foreground">
        <T>Add stock at two work sites before ordering a transfer.</T>
      </p>
    );
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await orderSiteTransferAction({
            inventoryItemId: source.inventoryItemId,
            destinationLocationId: destination.locationId,
            quantity,
            notes,
            ...largeInputPayload(
              quantity,
              confirmLargeInput,
              confirmationQuantity,
              LIMITS.largeQuantity,
            ),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setNotes("");
          router.refresh();
        });
      }}
    >
      <Field label="From stock" htmlFor="transfer-source">
        <NativeSelect
          id="transfer-source"
          value={source.inventoryItemId}
          onChange={(event) => {
            setSourceId(event.target.value);
            setDestinationId("");
          }}
        >
          {sources.map((entry) => (
            <option key={entry.inventoryItemId} value={entry.inventoryItemId}>
              {entry.siteLabel} · {entry.locationCode} · {entry.sku} · {entry.quantity}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="To location" htmlFor="transfer-destination">
        <NativeSelect
          id="transfer-destination"
          value={destination.locationId}
          onChange={(event) => setDestinationId(event.target.value)}
        >
          {destinationChoices.map((entry) => (
            <option key={entry.locationId} value={entry.locationId}>
              {entry.siteLabel} · {entry.locationCode}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Quantity" htmlFor="transfer-quantity">
        <Input
          id="transfer-quantity"
          type="number"
          min={1}
          max={source.quantity}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
      </Field>
      <Field label="Notes" htmlFor="transfer-notes">
        <Textarea
          id="transfer-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Why this stock should move"
        />
      </Field>
      <div className="sm:col-span-2">
        <LargeInputConfirm
          total={quantity}
          label="transfer quantity"
          confirmed={confirmLargeInput}
          onConfirmedChange={setConfirmLargeInput}
          confirmationQuantity={confirmationQuantity}
          onConfirmationQuantityChange={setConfirmationQuantity}
        />
      </div>
      {error ? (
        <p className="text-xs text-destructive sm:col-span-2">
          <T>{error}</T>
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <T>Ordering transfer…</T> : <T>Order transfer</T>}
        </Button>
      </div>
    </form>
  );
}
