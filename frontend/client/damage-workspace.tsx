"use client";

import { FormattedDate, T, useT } from "@/frontend/client/language";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { damageOut } from "@/backend/server/serverAction";
import type { DamageEvent, DamageTotals } from "@/lib/inventory/damage";
import { inventoryQuantityCubeMessage } from "@/lib/cubing/workflow";
import type { InventoryRow, ItemCube, Location } from "@/lib/inventory-schema";
import type { LocationCubeRow } from "@/frontend/client/location-cube-table";
import { matchesScan, type ScanPayload } from "@/lib/scan-code";
import { formatSignedInt } from "@/lib/format";
import { LIMITS } from "@/lib/validation/limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, NativeSelect } from "@/frontend/client/field";
import { ScanInput } from "@/frontend/client/scan-input";
import {
  LargeInputConfirm,
  largeInputPayload,
} from "@/frontend/client/large-input-confirm";
import {
  PhotoDraftCollector,
  revokePhotoDrafts,
  type PhotoDraft,
} from "@/frontend/client/photo-proof";
import { uploadProofPhotos } from "@/frontend/client/photo-api";
import { ProcessAlert } from "@/frontend/client/process-alert";

const REASONS = [
  "Crushed",
  "Wet",
  "Torn packaging",
  "Expired",
  "Customer return",
] as const;

export type DamageReportRow = DamageEvent & {
  sourceLocationCode: string;
  holdLocationCode: string;
};

export function DamageWorkspace({
  inventory,
  locations,
  cubes = [],
  locationCubes = [],
  totals,
  rows,
}: {
  inventory: InventoryRow[];
  locations: Location[];
  cubes?: ItemCube[];
  locationCubes?: LocationCubeRow[];
  totals: DamageTotals;
  rows: DamageReportRow[];
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [scannedCode, setScannedCode] = useState<string | undefined>();
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");

  const stock = useMemo(
    () => inventory.filter((line) => line.quantity > 0),
    [inventory],
  );
  const source = stock.find((line) => line.id === sourceId);
  const holdLocationId =
    locations.find((location) => location.code === "DMG-01" && location.isActive)?.id ??
    "";
  const sourceAtHold = Boolean(source && holdLocationId && source.locationId === holdLocationId);
  const holdHint = holdCubeHint({
    source,
    quantity,
    inventory,
    cubes,
    locationCubes,
    holdLocationId,
    sourceAtHold,
  });

  function chooseSource(id: string) {
    setSourceId(id);
    setQuantity(1);
    setError(null);
    setNotice(null);
    setConfirmLargeInput(false);
    setConfirmationQuantity("");
  }

  function applyScan(payload: ScanPayload) {
    setScannedCode(payload.raw);
    const matches = stock.filter((item) => matchesScan(item, payload));
    if (matches.length === 1) {
      chooseSource(matches[0].id);
      return;
    }
    if (matches.length > 1) {
      setError("Multiple matching inventory lines. Choose a specific location.");
      return;
    }
    const atBin = stock.filter(
      (item) =>
        item.locationCode.toLowerCase() === payload.raw.trim().toLowerCase(),
    );
    if (atBin.length === 1) {
      chooseSource(atBin[0].id);
      return;
    }
    setError("No matching stock. Scan a bin code or a SKU that is on hand.");
  }

  function post(disposition: "write-off" | "hold") {
    if (!source || pending) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("Quantity must be at least 1.");
      return;
    }
    if (disposition === "hold" && (!holdLocationId || sourceAtHold)) {
      setError("Damaged units are already in that hold location. Write them off instead.");
      return;
    }
    setError(null);
    setNotice(null);
    const drafts = photoDrafts;
    startTransition(async () => {
      const result = await damageOut({
        inventoryItemId: source.id,
        quantity,
        reason: reason.trim(),
        notes,
        scannedCode,
        moveDamagedToLocationId:
          disposition === "hold" ? holdLocationId : undefined,
        ...largeInputPayload(quantity, confirmLargeInput, confirmationQuantity),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      revokePhotoDrafts(drafts);
      setPhotoDrafts([]);
      setSourceId("");
      setQuantity(1);
      setReason("");
      setNotes("");
      setScannedCode(undefined);
      setConfirmLargeInput(false);
      setConfirmationQuantity("");
      if (drafts.length > 0) {
        const uploaded = await uploadProofPhotos({
          ownerType: "adjustment",
          ownerId: result.data.referenceId,
          files: drafts.map((draft) => draft.file),
        });
        if (!uploaded.ok) {
          setError(`Damage posted, but photos failed: ${uploaded.error}`);
          router.refresh();
          return;
        }
      }
      setNotice(
        t("Damaged {{quantity}} of {{sku}}.", {
          quantity: result.data.unitsDamaged,
          sku: result.data.sku,
        }),
      );
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <T>Damage out</T>
          </CardTitle>
          <CardDescription>
            <T>Scan a line, tap a reason, then write it off or move it to the damage hold.</T>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ScanInput
            autoFocus
            onScan={applyScan}
            placeholder="Scan UPC, SKU, or bin"
          />
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              post("write-off");
            }}
          >
            <Field label="Inventory line">
              <NativeSelect
                value={sourceId}
                onChange={(event) => chooseSource(event.target.value)}
              >
                <option value="">
                  {stock.length === 0 ? "No stock can be damaged." : "Choose stock"}
                </option>
                {stock.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.locationCode} · qty {item.quantity}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {source ? (
              <p className="text-xs text-muted-foreground">
                {source.description || source.sku} · {source.roomName}/
                {source.locationCode} · <T>On hand</T> {source.quantity}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="Quantity" htmlFor="damage-quantity">
                <Input
                  id="damage-quantity"
                  type="number"
                  min={1}
                  max={source?.quantity}
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                disabled={!source}
                onClick={() => source && setQuantity(source.quantity)}
              >
                <T>All on hand</T>
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((label) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={reason === label ? "default" : "outline"}
                  onClick={() => setReason(label)}
                >
                  <T>{label}</T>
                </Button>
              ))}
            </div>
            <Field label="Reason" htmlFor="damage-reason">
              <Input
                id="damage-reason"
                value={reason}
                placeholder="Choose a reason"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <Field label="Notes" htmlFor="damage-notes">
              <Textarea
                id="damage-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <PhotoDraftCollector
              drafts={photoDrafts}
              onChange={setPhotoDrafts}
              disabled={pending}
              title="Proof of damage"
              description="Photograph crushed cartons, wet freight, or other damage before posting."
            />
            {sourceAtHold ? (
              <p className="text-xs text-muted-foreground">
                <T>This line is already in the damage hold. Write it off to remove it.</T>
              </p>
            ) : null}
            {holdHint ? (
              <p className={holdHint.blocks ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {holdHint.text}
              </p>
            ) : null}
            <LargeInputConfirm
              total={quantity}
              threshold={LIMITS.largeQuantity}
              label="damage quantity"
              confirmed={confirmLargeInput}
              onConfirmedChange={setConfirmLargeInput}
              confirmationQuantity={confirmationQuantity}
              onConfirmationQuantityChange={setConfirmationQuantity}
            />
            {error ? <ProcessAlert message={error} /> : null}
            {notice ? (
              <p className="text-sm" role="status">
                {notice}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || !source}>
                {pending ? <T>Damaging…</T> : <T>Write off</T>}
              </Button>
              {holdLocationId ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !source || sourceAtHold}
                  onClick={() => post("hold")}
                >
                  <T>Move to DMG-01</T>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <T>Damage report</T>
          </CardTitle>
          <CardDescription>
            <T>Damage postings only. A hold move counts once and does not reduce on-hand quantity.</T>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Total label="Damage events" value={String(totals.events)} />
            <Total label="Units damaged" value={String(totals.unitsDamaged)} />
            <Total label="Written off" value={String(totals.unitsWrittenOff)} />
            <Total label="Held" value={String(totals.unitsHeld)} />
            <Total label="On-hand change" value={formatSignedInt(totals.onHandDelta)} />
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <T>No damage has been reported.</T>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T>When</T>
                  </TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>
                    <T>From</T>
                  </TableHead>
                  <TableHead>
                    <T>Disposition</T>
                  </TableHead>
                  <TableHead>
                    <T>Units damaged</T>
                  </TableHead>
                  <TableHead>
                    <T>Written off</T>
                  </TableHead>
                  <TableHead>
                    <T>Held</T>
                  </TableHead>
                  <TableHead>
                    <T>On-hand change</T>
                  </TableHead>
                  <TableHead>
                    <T>Reason</T>
                  </TableHead>
                  <TableHead>
                    <T>Reported by</T>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <FormattedDate value={row.occurredAt} />
                    </TableCell>
                    <TableCell>{row.sku}</TableCell>
                    <TableCell>{row.sourceLocationCode}</TableCell>
                    <TableCell>
                      {row.disposition === "hold" ? (
                        <T>Hold</T>
                      ) : (
                        <T>Write-off</T>
                      )}
                      {row.disposition === "hold" && row.holdLocationCode !== "—"
                        ? ` · ${row.holdLocationCode}`
                        : ""}
                    </TableCell>
                    <TableCell>{row.unitsDamaged}</TableCell>
                    <TableCell>{row.unitsWrittenOff}</TableCell>
                    <TableCell>{row.unitsHeld}</TableCell>
                    <TableCell>{formatSignedInt(row.onHandDelta)}</TableCell>
                    <TableCell>{row.reason || "—"}</TableCell>
                    <TableCell>{row.actor || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">
        <T>{label}</T>
      </p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function holdCubeHint(input: {
  source: InventoryRow | undefined;
  quantity: number;
  inventory: InventoryRow[];
  cubes: ItemCube[];
  locationCubes: LocationCubeRow[];
  holdLocationId: string;
  sourceAtHold: boolean;
}): { text: string; blocks: boolean } | null {
  const { source, quantity } = input;
  if (!source || quantity < 1 || !input.holdLocationId || input.sourceAtHold) {
    return null;
  }
  const cube = input.cubes.find((entry) => entry.sku === source.sku);
  const location = input.locationCubes.find((entry) => entry.id === input.holdLocationId);
  if (!location || !cube) return null;
  const destination = input.inventory.find(
    (item) =>
      item.sku === source.sku &&
      item.locationId === input.holdLocationId &&
      (item.batch ?? null) === (source.batch ?? null),
  );
  const before = destination?.quantity ?? 0;
  const message = inventoryQuantityCubeMessage({
    sku: source.sku,
    locationCode: location.code,
    capacity: location.cubeCapacityCubicInches,
    committedCubicInches: location.committedCubicInches,
    cube: {
      sku: cube.sku,
      cubicInches: cube.cubicInches,
      unitsPerCase: cube.unitsPerCase,
    },
    quantityBefore: before,
    quantityAfter: before + quantity,
  });
  return message ? { text: message, blocks: true } : null;
}
