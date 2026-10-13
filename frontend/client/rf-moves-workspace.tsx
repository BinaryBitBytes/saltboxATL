"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Room, SiteTransfer, StorageClass } from "@/lib/inventory-schema";
import { storageClassLabel } from "@/lib/cubing/measure";
import {
  combineNeedsApproval,
  distinctProjectIds,
} from "@/lib/moves/project";
import {
  arriveSiteTransfer,
  cancelSiteTransfer,
  consolidateInventory,
  departSiteTransfer,
  loadSiteTransfer,
  moveInventory,
  openSiteTransfer,
  unloadSiteTransfer,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import { LIMITS } from "@/lib/validation/limits";

export type MoveLine = {
  id: string;
  sku: string;
  description: string;
  batch: string | null;
  locationId: string;
  locationCode: string;
  roomId: string;
  roomName: string;
  quantity: number;
  reserved: number;
  available: number;
  projectId: string | null;
};

export type MoveLocation = {
  id: string;
  code: string;
  roomId: string;
  roomName: string;
  storageClass: StorageClass;
};

function lineLabel(line: MoveLine): string {
  const project = line.projectId ? ` · ${line.projectId}` : "";
  const batch = line.batch ? ` · ${line.batch}` : "";
  return `${line.sku} · ${line.locationCode} · ${line.available} available${batch}${project}`;
}

function locationLabel(location: MoveLocation): string {
  const trailer =
    location.storageClass === "container"
      ? ` · ${storageClassLabel(location.storageClass)}`
      : "";
  return `${location.code}${trailer} · ${location.roomName}`;
}

function ProjectApproval({
  needed,
  canApprove,
  approved,
  onApprovedChange,
  detail,
}: {
  needed: boolean;
  canApprove: boolean;
  approved: boolean;
  onApprovedChange: (value: boolean) => void;
  detail: string;
}) {
  if (!needed) return null;
  return (
    <div className="grid gap-2 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        {detail} A manager has to approve combining project-tracked inventory.
      </p>
      {canApprove ? (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => onApprovedChange(event.target.checked)}
          />
          Approve combining project-tracked inventory
        </label>
      ) : null}
    </div>
  );
}

export function RfMovesWorkspace({
  lines,
  locations,
  rooms,
  transfers,
  canApprove,
}: {
  lines: MoveLine[];
  locations: MoveLocation[];
  rooms: Room[];
  transfers: SiteTransfer[];
  canApprove: boolean;
}) {
  const [mode, setMode] = useState<"move" | "consolidate" | "transfer">("move");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["move", "Move"],
            ["consolidate", "Consolidate"],
            ["transfer", "Site transfer"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={mode === value ? "default" : "outline"}
            onClick={() => setMode(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {mode === "move" ? (
        <MovePanel lines={lines} locations={locations} canApprove={canApprove} />
      ) : null}
      {mode === "consolidate" ? (
        <ConsolidatePanel lines={lines} locations={locations} canApprove={canApprove} />
      ) : null}
      {mode === "transfer" ? (
        <TransferPanel
          lines={lines}
          locations={locations}
          rooms={rooms}
          transfers={transfers}
          canApprove={canApprove}
        />
      ) : null}
    </div>
  );
}

function MovePanel({
  lines,
  locations,
  canApprove,
}: {
  lines: MoveLine[];
  locations: MoveLocation[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inventoryItemId, setInventoryItemId] = useState(lines[0]?.id ?? "");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [approved, setApproved] = useState(false);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const source = lines.find((line) => line.id === inventoryItemId);
  const qty = Number(quantity);
  const destination = locations.find((location) => location.id === destinationLocationId);
  const merges = Boolean(
    source &&
      destination &&
      lines.some(
        (line) =>
          line.id !== source.id &&
          line.quantity > 0 &&
          line.locationId === destination.id &&
          line.sku === source.sku &&
          (line.batch ?? null) === (source.batch ?? null) &&
          (line.projectId ?? null) === (source.projectId ?? null),
      ),
  );
  const needsApproval = Boolean(source && merges && source.projectId);

  function submit() {
    setError(null);
    if (!source || !destinationLocationId || !Number.isInteger(qty) || qty < 1) {
      setError("Choose a line, a destination, and a quantity.");
      return;
    }
    startTransition(async () => {
      const result = await moveInventory({
        inventoryItemId: source.id,
        destinationLocationId,
        quantity: qty,
        approveProjectCombine: approved,
        ...largeInputPayload(qty, confirmLargeInput, confirmationQuantity),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setQuantity("");
      setApproved(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Move inventory</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="From">
          <NativeSelect
            value={inventoryItemId}
            onChange={(event) => setInventoryItemId(event.target.value)}
          >
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {lineLabel(line)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Quantity">
          <Input
            inputMode="numeric"
            value={quantity}
            placeholder={source ? String(source.available) : "0"}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <Field label="To">
          <NativeSelect
            value={destinationLocationId}
            onChange={(event) => setDestinationLocationId(event.target.value)}
          >
            <option value="">Select location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <ProjectApproval
          needed={needsApproval}
          canApprove={canApprove}
          approved={approved}
          onApprovedChange={setApproved}
          detail={`Moving onto existing ${source?.projectId ?? "project"} stock combines those quantities.`}
        />
        <LargeInputConfirm
          total={Number.isInteger(qty) ? qty : 0}
          threshold={LIMITS.largeQuantity}
          label="move quantity"
          confirmed={confirmLargeInput}
          onConfirmedChange={setConfirmLargeInput}
          confirmationQuantity={confirmationQuantity}
          onConfirmationQuantityChange={setConfirmationQuantity}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button type="button" disabled={pending} onClick={submit}>
          {pending ? "Moving…" : "Move"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ConsolidatePanel({
  lines,
  locations,
  canApprove,
}: {
  lines: MoveLine[];
  locations: MoveLocation[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sku, setSku] = useState(lines[0]?.sku ?? "");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [resultingProjectId, setResultingProjectId] = useState<string | null | undefined>(
    undefined,
  );
  const [approved, setApproved] = useState(false);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const skus = useMemo(
    () => [...new Set(lines.map((line) => line.sku))].sort(),
    [lines],
  );
  const candidates = lines.filter((line) => line.sku === sku && line.available > 0);
  const chosen = candidates.filter((line) => selected[line.id] != null);
  const projects = distinctProjectIds(chosen.map((line) => line.projectId));
  const needsChoice = projects.length > 1;
  const needsApproval = combineNeedsApproval(chosen.map((line) => line.projectId));
  const total = chosen.reduce((sum, line) => sum + (Number(selected[line.id]) || 0), 0);

  function submit() {
    setError(null);
    const payloadLines = chosen
      .map((line) => ({
        inventoryItemId: line.id,
        quantity: Number(selected[line.id]),
      }))
      .filter((line) => Number.isInteger(line.quantity) && line.quantity > 0);
    if (payloadLines.length < 2 || !destinationLocationId) {
      setError("Select at least two lines and a destination location.");
      return;
    }
    if (needsChoice && resultingProjectId === undefined) {
      setError("Choose the project ID to keep.");
      return;
    }
    startTransition(async () => {
      const result = await consolidateInventory({
        destinationLocationId,
        lines: payloadLines,
        ...(needsChoice ? { resultingProjectId: resultingProjectId ?? null } : {}),
        approveProjectCombine: approved,
        ...largeInputPayload(total, confirmLargeInput, confirmationQuantity),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected({});
      setApproved(false);
      setResultingProjectId(undefined);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consolidate locations</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="SKU">
          <NativeSelect
            value={sku}
            onChange={(event) => {
              setSku(event.target.value);
              setSelected({});
              setResultingProjectId(undefined);
            }}
          >
            {skus.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-2">
          {candidates.map((line) => {
            const checked = selected[line.id] != null;
            return (
              <label key={line.id} className="grid gap-2 rounded-md border border-border p-2 text-xs sm:grid-cols-[1fr_6rem]">
                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = { ...current };
                        if (event.target.checked) next[line.id] = String(line.available);
                        else delete next[line.id];
                        return next;
                      });
                      setResultingProjectId(undefined);
                    }}
                  />
                  <span>
                    {line.locationCode} · {line.roomName}
                    {line.batch ? ` · batch ${line.batch}` : ""}
                    {line.projectId ? ` · ${line.projectId}` : " · untracked"}
                    {` · ${line.available} available`}
                  </span>
                </span>
                <Input
                  inputMode="numeric"
                  disabled={!checked}
                  value={selected[line.id] ?? ""}
                  onChange={(event) =>
                    setSelected((current) => ({ ...current, [line.id]: event.target.value }))
                  }
                />
              </label>
            );
          })}
        </div>
        <Field label="Destination">
          <NativeSelect
            value={destinationLocationId}
            onChange={(event) => setDestinationLocationId(event.target.value)}
          >
            <option value="">Select location</option>
            {locations
              .filter((location) => location.storageClass !== "container")
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
          </NativeSelect>
        </Field>
        {needsChoice ? (
          <Field label="Project ID to keep">
            <NativeSelect
              value={
                resultingProjectId === undefined
                  ? ""
                  : resultingProjectId === null
                    ? "__untracked"
                    : resultingProjectId
              }
              onChange={(event) => {
                const value = event.target.value;
                if (value === "") setResultingProjectId(undefined);
                else if (value === "__untracked") setResultingProjectId(null);
                else setResultingProjectId(value);
              }}
            >
              <option value="">Choose project ID</option>
              {projects.map((projectId) => (
                <option key={projectId ?? "__untracked"} value={projectId ?? "__untracked"}>
                  {projectId ?? "Untracked"}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <ProjectApproval
          needed={needsApproval}
          canApprove={canApprove}
          approved={approved}
          onApprovedChange={setApproved}
          detail="These lines include project-tracked inventory."
        />
        <LargeInputConfirm
          total={total}
          threshold={LIMITS.largeQuantity}
          label="consolidate quantity"
          confirmed={confirmLargeInput}
          onConfirmedChange={setConfirmLargeInput}
          confirmationQuantity={confirmationQuantity}
          onConfirmationQuantityChange={setConfirmationQuantity}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button type="button" disabled={pending} onClick={submit}>
          {pending ? "Consolidating…" : "Consolidate"}
        </Button>
      </CardContent>
    </Card>
  );
}

function TransferPanel({
  lines,
  locations,
  rooms,
  transfers,
  canApprove,
}: {
  lines: MoveLine[];
  locations: MoveLocation[];
  rooms: Room[];
  transfers: SiteTransfer[];
  canApprove: boolean;
}) {
  const trailers = locations.filter((location) => location.storageClass === "container");
  const open = transfers.filter(
    (transfer) => transfer.status !== "unloaded" && transfer.status !== "cancelled",
  );

  return (
    <div className="grid gap-4">
      <OpenTransferForm trailers={trailers} rooms={rooms} />
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open site transfers.</p>
      ) : (
        open.map((transfer) => (
          <TransferCard
            key={transfer.id}
            transfer={transfer}
            lines={lines}
            locations={locations}
            rooms={rooms}
            canApprove={canApprove}
          />
        ))
      )}
    </div>
  );
}

function OpenTransferForm({
  trailers,
  rooms,
}: {
  trailers: MoveLocation[];
  rooms: Room[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [trailerLocationId, setTrailerLocationId] = useState(trailers[0]?.id ?? "");
  const trailer = trailers.find((location) => location.id === trailerLocationId);
  const [fromRoomId, setFromRoomId] = useState(trailer?.roomId ?? rooms[0]?.id ?? "");
  const [toRoomId, setToRoomId] = useState(
    rooms.find((room) => room.id !== (trailer?.roomId ?? ""))?.id ?? "",
  );
  const [notes, setNotes] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await openSiteTransfer({
        trailerLocationId,
        fromRoomId,
        toRoomId,
        notes,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotes("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open a site transfer</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="Trailer">
          <NativeSelect
            value={trailerLocationId}
            onChange={(event) => {
              const next = trailers.find((location) => location.id === event.target.value);
              setTrailerLocationId(event.target.value);
              if (next) setFromRoomId(next.roomId);
            }}
          >
            {trailers.map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="From building">
            <NativeSelect value={fromRoomId} onChange={(event) => setFromRoomId(event.target.value)}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="To building">
            <NativeSelect value={toRoomId} onChange={(event) => setToRoomId(event.target.value)}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Notes">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button type="button" disabled={pending || trailers.length === 0} onClick={submit}>
          {pending ? "Opening…" : "Open transfer"}
        </Button>
      </CardContent>
    </Card>
  );
}

function TransferCard({
  transfer,
  lines,
  locations,
  rooms,
  canApprove,
}: {
  transfer: SiteTransfer;
  lines: MoveLine[];
  locations: MoveLocation[];
  rooms: Room[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [palletNumber, setPalletNumber] = useState("P1");
  const [quantity, setQuantity] = useState("");
  const [approved, setApproved] = useState(false);
  const [lineId, setLineId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [unloadQuantity, setUnloadQuantity] = useState("");
  const trailer = locations.find((location) => location.id === transfer.trailerLocationId);
  const fromRoom = rooms.find((room) => room.id === transfer.fromRoomId)?.name ?? "Origin";
  const toRoom = rooms.find((room) => room.id === transfer.toRoomId)?.name ?? "Destination";
  const manifest = transfer.pallets.flatMap((pallet) =>
    pallet.lines.map((line) => ({ ...line, palletNumber: pallet.palletNumber })),
  );
  const source = lines.find((line) => line.id === inventoryItemId);
  const qty = Number(quantity);
  const merges = Boolean(
    source &&
      trailer &&
      lines.some(
        (line) =>
          line.id !== source.id &&
          line.quantity > 0 &&
          line.locationId === trailer.id &&
          line.sku === source.sku &&
          (line.batch ?? null) === (source.batch ?? null) &&
          (line.projectId ?? null) === (source.projectId ?? null),
      ),
  );
  const unloadLine = manifest.find((line) => line.id === lineId);
  const unloadMerges = Boolean(
    unloadLine &&
      lines.some(
        (line) =>
          line.quantity > 0 &&
          line.locationId === destinationLocationId &&
          line.sku === unloadLine.sku &&
          (line.batch ?? null) === (unloadLine.batch ?? null) &&
          (line.projectId ?? null) === (unloadLine.projectId ?? null),
      ),
  );
  const destinations = locations.filter(
    (location) =>
      location.roomId === transfer.toRoomId && location.storageClass !== "container",
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Unable to update the transfer.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {transfer.transferNumber} · {transfer.status}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          {trailer?.code ?? "Trailer"} from {fromRoom} to {toRoom}
        </p>
        {manifest.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pallets loaded.</p>
        ) : (
          <ul className="grid gap-1 text-xs">
            {manifest.map((line) => (
              <li key={line.id}>
                {line.palletNumber} · {line.sku} · {line.quantity}
                {line.projectId ? ` · ${line.projectId}` : ""}
              </li>
            ))}
          </ul>
        )}
        {transfer.status === "loading" ? (
          <div className="grid gap-2">
            <Field label="Load inventory">
              <NativeSelect
                value={inventoryItemId}
                onChange={(event) => setInventoryItemId(event.target.value)}
              >
                <option value="">Select line</option>
                {lines
                  .filter((line) => line.available > 0)
                  .map((line) => (
                    <option key={line.id} value={line.id}>
                      {lineLabel(line)}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Pallet">
                <Input value={palletNumber} onChange={(event) => setPalletNumber(event.target.value)} />
              </Field>
              <Field label="Quantity">
                <Input
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>
            </div>
            <ProjectApproval
              needed={Boolean(
                (source?.projectId && merges) ||
                  manifest.some((line) => line.projectId),
              )}
              canApprove={canApprove}
              approved={approved}
              onApprovedChange={setApproved}
              detail="Combining or returning project-tracked inventory needs administrative approval."
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await loadSiteTransfer({
                      transferId: transfer.id,
                      inventoryItemId,
                      palletNumber,
                      quantity: qty,
                      approveProjectCombine: approved,
                    });
                    if (result.ok) setQuantity("");
                    return result;
                  })
                }
              >
                Load pallet
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => run(async () => departSiteTransfer({ transferId: transfer.id }))}
              >
                Depart
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(async () =>
                    cancelSiteTransfer({
                      transferId: transfer.id,
                      approveProjectCombine: approved,
                    }),
                  )
                }
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {transfer.status === "in-transit" ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(async () => arriveSiteTransfer({ transferId: transfer.id }))}
          >
            Arrive at {toRoom}
          </Button>
        ) : null}
        {transfer.status === "arrived" ? (
          <div className="grid gap-2">
            <Field label="Pallet line">
              <NativeSelect value={lineId} onChange={(event) => setLineId(event.target.value)}>
                <option value="">Select line</option>
                {manifest.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.palletNumber} · {line.sku} · {line.quantity}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={`Unload into ${toRoom}`}>
              <NativeSelect
                value={destinationLocationId}
                onChange={(event) => setDestinationLocationId(event.target.value)}
              >
                <option value="">Select location</option>
                {destinations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {locationLabel(location)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Quantity">
              <Input
                inputMode="numeric"
                value={unloadQuantity}
                onChange={(event) => setUnloadQuantity(event.target.value)}
              />
            </Field>
            <ProjectApproval
              needed={Boolean(unloadLine?.projectId && unloadMerges)}
              canApprove={canApprove}
              approved={approved}
              onApprovedChange={setApproved}
              detail="Unloading onto existing project stock combines those quantities."
            />
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () =>
                  unloadSiteTransfer({
                    transferId: transfer.id,
                    lineId,
                    destinationLocationId,
                    quantity: Number(unloadQuantity),
                    approveProjectCombine: approved,
                  }),
                )
              }
            >
              Unload
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
