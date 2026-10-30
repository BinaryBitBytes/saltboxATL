"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  loadFacilityTransferAction,
  receiveFacilityTransferAction,
} from "@/backend/server/transfer-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import { T } from "@/frontend/client/language";
import { LIMITS } from "@/lib/validation/limits";

export type OutboundStockOption = {
  inventoryItemId: string;
  locationCode: string;
  sku: string;
  quantity: number;
  description: string;
};

export type DestinationFacilityOption = {
  id: string;
  nomenclature: string;
  label: string;
};

export function OutboundTransferForm({
  stock,
  destinations,
  suggestedTrailer,
}: {
  stock: OutboundStockOption[];
  destinations: DestinationFacilityOption[];
  suggestedTrailer: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stockId, setStockId] = useState(stock[0]?.inventoryItemId ?? "");
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const [trailerCode, setTrailerCode] = useState(suggestedTrailer);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const source = stock.find((entry) => entry.inventoryItemId === stockId) ?? stock[0];
  const destination =
    destinations.find((entry) => entry.id === destinationId) ?? destinations[0];

  if (!source || !destination) {
    return (
      <p className="text-sm text-muted-foreground">
        <T>Add on-hand stock and a second facility before loading a transfer trailer.</T>
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
          const result = await loadFacilityTransferAction({
            inventoryItemId: source.inventoryItemId,
            destinationSiteId: destination.id,
            trailerCode,
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
          setQuantity(1);
          router.refresh();
        });
      }}
    >
      <Field label="From stock" htmlFor="outbound-stock">
        <NativeSelect
          id="outbound-stock"
          value={source.inventoryItemId}
          onChange={(event) => setStockId(event.target.value)}
        >
          {stock.map((entry) => (
            <option key={entry.inventoryItemId} value={entry.inventoryItemId}>
              {entry.locationCode} · {entry.sku} · {entry.quantity}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Destination facility" htmlFor="outbound-destination">
        <NativeSelect
          id="outbound-destination"
          value={destination.id}
          onChange={(event) => setDestinationId(event.target.value)}
        >
          {destinations.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.nomenclature} · {entry.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Trailer number" htmlFor="outbound-trailer">
        <Input
          id="outbound-trailer"
          value={trailerCode}
          onChange={(event) => setTrailerCode(event.target.value.toUpperCase())}
          autoCapitalize="characters"
        />
      </Field>
      <Field label="Quantity" htmlFor="outbound-quantity">
        <Input
          id="outbound-quantity"
          type="number"
          min={1}
          max={source.quantity}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
      </Field>
      <Field label="Notes" htmlFor="outbound-notes" className="sm:col-span-2">
        <Textarea
          id="outbound-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Door, seal, or load note"
        />
      </Field>
      <div className="sm:col-span-2">
        <LargeInputConfirm
          total={quantity}
          label="load quantity"
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
          {pending ? <T>Loading…</T> : <T>Load trailer</T>}
        </Button>
      </div>
    </form>
  );
}

export type InboundTransferLineOption = {
  id: string;
  sku: string;
  description: string;
  quantityLoaded: number;
  quantityReceived: number;
  openQuantity: number;
};

export type InboundTransferOption = {
  id: string;
  trailerCode: string;
  sourceNomenclature: string;
  destinationNomenclature: string;
  inTransitUnits: number;
  lines: InboundTransferLineOption[];
};

export function InboundTransferForm({ transfers }: { transfers: InboundTransferOption[] }) {
  const open = transfers.filter((transfer) => transfer.inTransitUnits > 0);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [transferId, setTransferId] = useState(open[0]?.id ?? "");
  const [verified, setVerified] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      open.flatMap((transfer) =>
        transfer.lines
          .filter((line) => line.openQuantity > 0)
          .map((line) => [line.id, line.openQuantity]),
      ),
    ),
  );
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const transfer = open.find((entry) => entry.id === transferId) ?? open[0];

  if (!transfer) {
    return (
      <p className="text-sm text-muted-foreground">
        <T>No inbound transfer trailers are waiting at this facility.</T>
      </p>
    );
  }

  const receiptLines = transfer.lines.filter((line) => line.openQuantity > 0);
  const receiptTotal = receiptLines.reduce(
    (sum, line) => sum + (quantities[line.id] || 0),
    0,
  );

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const lines = receiptLines
          .map((line) => ({ lineId: line.id, quantity: quantities[line.id] || 0 }))
          .filter((line) => line.quantity > 0);
        if (!verified) {
          setError("Verify the receipt before routing this trailer into the facility.");
          return;
        }
        if (lines.length === 0) {
          setError("Enter the quantity received on this trailer.");
          return;
        }
        startTransition(async () => {
          const result = await receiveFacilityTransferAction({
            transferId: transfer.id,
            verified: true,
            lines,
            ...largeInputPayload(
              receiptTotal,
              confirmLargeInput,
              confirmationQuantity,
              LIMITS.largeQuantity,
            ),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setVerified(false);
          router.refresh();
        });
      }}
    >
      <Field label="Transfer trailer" htmlFor="inbound-trailer">
        <NativeSelect
          id="inbound-trailer"
          value={transfer.id}
          onChange={(event) => setTransferId(event.target.value)}
        >
          {open.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.trailerCode} · {entry.sourceNomenclature} · {entry.inTransitUnits} in transit
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="border-b text-left">
            <tr>
              <th className="px-2 py-2 font-medium"><T>SKU</T></th>
              <th className="px-2 py-2 font-medium"><T>Loaded</T></th>
              <th className="px-2 py-2 font-medium"><T>Received</T></th>
              <th className="px-2 py-2 font-medium"><T>Open quantity</T></th>
              <th className="px-2 py-2 font-medium"><T>Receive</T></th>
            </tr>
          </thead>
          <tbody>
            {receiptLines.map((line) => (
              <tr key={line.id} className="border-b last:border-0">
                <td className="px-2 py-2">
                  <div className="font-medium">{line.sku}</div>
                  <div className="text-muted-foreground">{line.description}</div>
                </td>
                <td className="px-2 py-2">{line.quantityLoaded}</td>
                <td className="px-2 py-2">{line.quantityReceived}</td>
                <td className="px-2 py-2">{line.openQuantity}</td>
                <td className="px-2 py-2">
                  <Input
                    aria-label={`Receive ${line.sku}`}
                    type="number"
                    min={0}
                    max={line.openQuantity}
                    value={quantities[line.id] ?? line.openQuantity}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [line.id]: Number(event.target.value),
                      }))
                    }
                    className="w-24"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={verified}
          onChange={(event) => setVerified(event.target.checked)}
        />
        <T>Receipt verified</T>
      </label>
      <LargeInputConfirm
        total={receiptTotal}
        label="receipt quantity"
        confirmed={confirmLargeInput}
        onConfirmedChange={setConfirmLargeInput}
        confirmationQuantity={confirmationQuantity}
        onConfirmationQuantityChange={setConfirmationQuantity}
      />
      {error ? (
        <p className="text-xs text-destructive">
          <T>{error}</T>
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <T>Verifying…</T> : <T>Verify receipt</T>}
        </Button>
      </div>
    </form>
  );
}
