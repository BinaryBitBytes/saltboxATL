"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { InventoryItem, ItemCube, Location, ReceivingOrder, Room } from "@/lib/inventory-schema";
import { putawayMergesExistingProjectStock } from "@/lib/moves/project";
import type { CubingLocation } from "@/lib/cubing/workflow";
import { formatCubicInches, storageClassLabel } from "@/lib/cubing/measure";
import { PalletCubeDirective } from "@/frontend/client/pallet-cube-directive";
import { isAwaitingPutaway } from "@/lib/inventory-schema";
import { casesPendingPutaway, isCasePutawayPosted } from "@/lib/receiving/reopen";
import {
  assignReceivingPutawayLocation,
  completePutaway,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import { formatCaseItemLine, formatPalletHeading } from "@/lib/format";
import { LIMITS } from "@/lib/validation/limits";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-destructive">{error}</p>;
}

export function PutawayWorkspace({
  order,
  rooms,
  locations,
  cubes = [],
  cubingLocations = [],
  inventoryItems = [],
  jobIdNumber = null,
  canApproveProjectCombine = false,
}: {
  order: ReceivingOrder;
  rooms: Room[];
  locations: Location[];
  cubes?: ItemCube[];
  cubingLocations?: CubingLocation[];
  inventoryItems?: InventoryItem[];
  jobIdNumber?: string | null;
  canApproveProjectCombine?: boolean;
}) {
  const awaiting = isAwaitingPutaway(order.status);
  const pendingCases = casesPendingPutaway(order);
  const missingLocations = pendingCases.filter((item) => !item.putawayLocationId).length;
  const totalUnits = pendingCases.reduce((sum, item) => sum + item.quantityInCase, 0);
  const locationCodes = useMemo(
    () => new Map(locations.map((location) => [location.id, location.code])),
    [locations],
  );
  const needsProjectApproval = putawayMergesExistingProjectStock({
    items: inventoryItems,
    cases: pendingCases,
    projectId: jobIdNumber,
  });

  if (order.status === "draft" || order.status === "in-progress") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Receiving still open</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Finish checking in pallets and cases on the receiving order before
            putaway can start.
          </p>
          <Button
            nativeButton={false}
            render={<Link href={`/receiving/${order.id}`} />}
          >
            Open receiving
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (order.status === "cancelled") {
    return (
      <p className="text-sm text-muted-foreground">
        This receiving order was cancelled and cannot be put away.
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {awaiting ? "Assign putaway locations" : "Putaway complete"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {order.pallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pallets on this order.</p>
          ) : (
            order.pallets.map((pallet) => (
              <div
                key={pallet.id}
                className="rounded-lg border border-border px-3 py-3"
              >
                <p className="text-sm font-medium">
                  {formatPalletHeading(pallet)}
                </p>
                <PalletCubeDirective
                  orderId={order.id}
                  pallet={pallet}
                  cubes={cubes}
                  locations={cubingLocations}
                  canBreakDown={awaiting}
                />
                <ul className="mt-2 grid gap-3">
                  {pallet.cases.map((item) => (
                    <li key={`${item.id}:${item.putawayLocationId ?? "none"}`}>
                      {awaiting && !isCasePutawayPosted(item) ? (
                        <PutawayCaseRow
                          orderId={order.id}
                          palletId={pallet.id}
                          palletNumber={pallet.palletNumber}
                          item={item}
                          rooms={rooms}
                          locations={locations}
                          cubingLocations={cubingLocations}
                          preferredRoute={pallet.cubeRoute}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {formatCaseItemLine(item)}
                          {" · "}
                          {isCasePutawayPosted(item)
                            ? "on-hand"
                            : item.putawayLocationId
                              ? locationCodes.get(item.putawayLocationId) ??
                                item.putawayLocationId
                              : "no location"}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {awaiting ? (
        <PutawayActions
          orderId={order.id}
          totalUnits={totalUnits}
          missingLocations={missingLocations}
          needsProjectApproval={needsProjectApproval}
          canApproveProjectCombine={canApproveProjectCombine}
          jobIdNumber={jobIdNumber}
        />
      ) : null}
    </div>
  );
}

function PutawayCaseRow({
  orderId,
  palletId,
  palletNumber,
  item,
  rooms,
  locations,
  cubingLocations,
  preferredRoute,
}: {
  orderId: string;
  palletId: string;
  palletNumber: string;
  item: ReceivingOrder["pallets"][number]["cases"][number];
  rooms: Room[];
  locations: Location[];
  cubingLocations: CubingLocation[];
  preferredRoute: "pallet" | "rack" | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState(item.putawayRoomId ?? rooms[0]?.id ?? "");
  const [locationId, setLocationId] = useState(item.putawayLocationId ?? "");
  const [destinationMode, setDestinationMode] = useState<"bin" | "move">(
    item.putawayLocationId &&
      locations.some(
        (location) =>
          location.id === item.putawayLocationId && location.storageClass === "container",
      )
      ? "move"
      : "bin",
  );
  const cubeById = new Map(cubingLocations.map((location) => [location.id, location]));
  const roomById = new Map(rooms.map((room) => [room.id, room.name]));
  const moveLocations = locations
    .filter((location) => location.isActive)
    .sort((left, right) => left.code.localeCompare(right.code));
  const roomLocations = locations
    .filter((location) => location.isActive && location.roomId === roomId)
    .sort((left, right) => {
      const leftPreferred = cubeById.get(left.id)?.storageClass === preferredRoute ? 0 : 1;
      const rightPreferred = cubeById.get(right.id)?.storageClass === preferredRoute ? 0 : 1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      return left.code.localeCompare(right.code);
    });

  function save(applyToPallet: boolean) {
    setError(null);
    if (!locationId) {
      setError("Select a putaway location.");
      return;
    }
    const selected = locations.find((location) => location.id === locationId);
    startTransition(async () => {
      const result = await assignReceivingPutawayLocation(
        orderId,
        palletId,
        item.id,
        {
          putawayRoomId: selected?.roomId ?? roomId ?? null,
          putawayLocationId: locationId,
          applyToPallet,
        },
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2 rounded-md border border-border px-2 py-2">
      <p className="text-xs">{formatCaseItemLine(item)}</p>
      <p className="text-xs text-muted-foreground">{item.description}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={destinationMode === "bin" ? "default" : "outline"}
          onClick={() => {
            setDestinationMode("bin");
            setLocationId("");
          }}
        >
          Bin in room
        </Button>
        <Button
          type="button"
          size="sm"
          variant={destinationMode === "move" ? "default" : "outline"}
          onClick={() => {
            setDestinationMode("move");
            setLocationId("");
          }}
        >
          RF move
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {destinationMode === "bin" ? (
          <Field label="Room">
            <NativeSelect
              value={roomId}
              onChange={(event) => {
                setRoomId(event.target.value);
                setLocationId("");
              }}
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            RF move can land this case in any active location, including a transfer trailer.
          </p>
        )}
        <Field label="Location">
          <NativeSelect
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Select location</option>
            {(destinationMode === "move" ? moveLocations : roomLocations).map((location) => {
              const cube = cubeById.get(location.id);
              const open = cube
                ? cube.cubeCapacityCubicInches - cube.committedCubicInches
                : null;
              const trailer =
                location.storageClass === "container"
                  ? ` · ${storageClassLabel(location.storageClass)} · ${roomById.get(location.roomId) ?? "site"}`
                  : "";
              const cubeLabel = cube
                ? location.storageClass === "container"
                  ? ` · ${formatCubicInches(Math.max(0, open ?? 0))} open`
                  : ` · ${storageClassLabel(cube.storageClass)} · ${formatCubicInches(Math.max(0, open ?? 0))} open`
                : "";
              return (
                <option key={location.id} value={location.id}>
                  {location.code}
                  {trailer}
                  {cubeLabel}
                </option>
              );
            })}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => save(false)}>
          {pending ? "Saving…" : item.putawayLocationId ? "Update location" : "Save location"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => save(true)}
        >
          Apply to pallet {palletNumber}
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function PutawayActions({
  orderId,
  totalUnits,
  missingLocations,
  needsProjectApproval,
  canApproveProjectCombine,
  jobIdNumber,
}: {
  orderId: string;
  totalUnits: number;
  missingLocations: number;
  needsProjectApproval: boolean;
  canApproveProjectCombine: boolean;
  jobIdNumber: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const [approveProjectCombine, setApproveProjectCombine] = useState(false);

  return (
    <div className="grid gap-3">
      {missingLocations > 0 ? (
        <p className="text-sm text-muted-foreground">
          {missingLocations} case{missingLocations === 1 ? "" : "s"} still need a
          putaway location.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          All cases have locations. Completing putaway adds this stock to on-hand
          inventory.
        </p>
      )}
      {needsProjectApproval ? (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">
            This putaway combines on-hand inventory tracked by project ID {jobIdNumber}.
            A manager has to approve that combine.
          </p>
          {canApproveProjectCombine ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={approveProjectCombine}
                onChange={(event) => setApproveProjectCombine(event.target.checked)}
              />
              Approve combining project-tracked inventory
            </label>
          ) : null}
        </div>
      ) : null}
      <LargeInputConfirm
        total={totalUnits}
        threshold={LIMITS.largeQuantity}
        label="putaway total"
        confirmed={confirmLargeInput}
        onConfirmedChange={setConfirmLargeInput}
        confirmationQuantity={confirmationQuantity}
        onConfirmationQuantityChange={setConfirmationQuantity}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={pending || missingLocations > 0}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await completePutaway(orderId, {
                ...largeInputPayload(
                  totalUnits,
                  confirmLargeInput,
                  confirmationQuantity,
                ),
                approveProjectCombine,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.push("/inventory");
              router.refresh();
            });
          }}
        >
          {pending ? "Putting away…" : "Complete putaway"}
        </Button>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
