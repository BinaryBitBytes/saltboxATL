"use client";

import { T, useT } from "@/frontend/client/language";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveInventory } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/frontend/client/field";
import { ScanInput } from "@/frontend/client/scan-input";
import {
  LargeInputConfirm,
  largeInputPayload,
} from "@/frontend/client/large-input-confirm";
import type { InventoryRow, Location } from "@/lib/inventory-schema";
import { matchesScan, type ScanPayload } from "@/lib/scan-code";

export type MoveLine = InventoryRow & { available: number };

function locationFromScan(
  locations: Location[],
  payload: ScanPayload,
): Location | undefined {
  const codes = [payload.locationCode, payload.raw, payload.sku]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return locations.find((location) => codes.includes(location.code.toLowerCase()));
}

export function RfMoveForm({
  lines,
  locations,
  recent,
}: {
  lines: MoveLine[];
  locations: Location[];
  recent: Array<{
    id: string;
    sku: string;
    quantity: number;
    fromCode: string;
    toCode: string;
  }>;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [scannedCode, setScannedCode] = useState<string | undefined>();
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");

  const movable = useMemo(
    () => lines.filter((line) => line.available > 0 && line.quantity > 0),
    [lines],
  );
  const source = movable.find((line) => line.id === sourceId);
  const visible = fromLocationId
    ? movable.filter((line) => line.locationId === fromLocationId)
    : movable;
  const destinations = locations.filter(
    (location) => location.isActive && location.id !== source?.locationId,
  );

  function chooseSource(id: string) {
    const line = movable.find((entry) => entry.id === id);
    setSourceId(id);
    setFromLocationId(line?.locationId ?? "");
    setDestinationId("");
    setQuantity(1);
    setError(null);
    setHint(null);
  }

  function onScan(payload: ScanPayload) {
    setScannedCode(payload.raw);
    setError(null);
    setNotice(null);
    const location = locationFromScan(locations, payload);
    if (location) {
      if (!source || source.locationId === location.id) {
        const atBin = movable.filter((line) => line.locationId === location.id);
        setFromLocationId(location.id);
        setDestinationId("");
        if (atBin.length === 1) {
          setSourceId(atBin[0].id);
          setQuantity(1);
          setHint(null);
          return;
        }
        setSourceId("");
        setHint(
          atBin.length === 0
            ? "That bin is empty."
            : "Choose the stock in this bin.",
        );
        return;
      }
      if (!location.isActive) {
        setHint(`Location ${location.code} is inactive and cannot be used for an RF move.`);
        return;
      }
      setDestinationId(location.id);
      setHint(null);
      return;
    }

    const matches = movable.filter((line) => matchesScan(line, payload));
    if (matches.length === 1) {
      chooseSource(matches[0].id);
      return;
    }
    if (matches.length > 1) {
      setFromLocationId("");
      setSourceId("");
      setHint("Multiple matching inventory lines. Choose a specific location.");
      return;
    }
    setHint("No matching stock. Scan a bin code or a SKU that is on hand.");
  }

  const maxQuantity = source?.available ?? 1;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <T>RF Moves</T>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ScanInput
            autoFocus
            placeholder="Scan from bin, SKU, or destination bin"
            onScan={onScan}
          />
          {hint ? (
            <p className="text-sm text-muted-foreground">
              <T>{hint}</T>
            </p>
          ) : null}
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!source || !destinationId) return;
              setError(null);
              setNotice(null);
              startTransition(async () => {
                const result = await moveInventory({
                  inventoryItemId: source.id,
                  destinationLocationId: destinationId,
                  quantity,
                  scannedCode,
                  ...largeInputPayload(quantity, confirmLargeInput, confirmationQuantity),
                });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setNotice(
                  t("Moved {{quantity}} of {{sku}} from {{from}} to {{to}}.", {
                    quantity: result.data.quantity,
                    sku: result.data.sku,
                    from: result.data.sourceLocationCode,
                    to: result.data.destinationLocationCode,
                  }),
                );
                setSourceId("");
                setFromLocationId("");
                setDestinationId("");
                setQuantity(1);
                setConfirmLargeInput(false);
                setConfirmationQuantity("");
                router.refresh();
              });
            }}
          >
            <Field label="From">
              <NativeSelect
                value={sourceId}
                onChange={(event) => chooseSource(event.target.value)}
              >
                <option value="">
                  {visible.length === 0 ? "No stock can be moved." : "Choose stock"}
                </option>
                {visible.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.sku} · {line.locationCode} · {line.available} available
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {source ? (
              <p className="text-sm">
                <T>On hand</T> {source.quantity}
                {" · "}
                <T>Available</T> {source.available}
                {source.roomName ? ` · ${source.roomName}` : ""}
              </p>
            ) : null}
            <Field label="Quantity">
              <Input
                type="number"
                min={1}
                max={maxQuantity}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
              />
            </Field>
            <Field label="To">
              <NativeSelect
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                <option value="">Choose destination bin</option>
                {destinations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <LargeInputConfirm
              total={quantity}
              label="move quantity"
              confirmed={confirmLargeInput}
              onConfirmedChange={setConfirmLargeInput}
              confirmationQuantity={confirmationQuantity}
              onConfirmationQuantityChange={setConfirmationQuantity}
            />
            {error ? (
              <p className="text-sm text-destructive">
                <T>{error}</T>
              </p>
            ) : null}
            {notice ? <p className="text-sm">{notice}</p> : null}
            <Button
              type="submit"
              disabled={pending || !source || !destinationId || quantity < 1 || quantity > maxQuantity}
            >
              {pending ? "Moving…" : "Move stock"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <T>Recent moves</T>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <T>No moves yet.</T>
            </p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {recent.map((move) => (
                <li key={move.id} className="font-mono">
                  {move.quantity} {move.sku} {move.fromCode} → {move.toCode}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
