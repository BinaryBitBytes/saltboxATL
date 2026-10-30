"use client";

import { T } from "@/frontend/client/language";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ItemCube, Location, ReceivingOrder, Room } from "@/lib/inventory-schema";
import type { CubingLocation } from "@/lib/cubing/workflow";
import { caseCubicInches, formatCubicInches, storageClassLabel } from "@/lib/cubing/measure";
import {
  allocatePutawayQuantity,
  type PutawaySlot,
} from "@/lib/cubing/putaway-allocation";
import { FORCED_CUBE_LABEL, FORCED_CUBE_ROW_CLASS, isForcedCube } from "@/lib/cubing/forced-cube";
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
import { ProcessAlert } from "@/frontend/client/process-alert";

function ErrorText({ error }: { error: string | null }) {
  return <ProcessAlert message={error} />;
}

export function PutawayWorkspace({
  order,
  rooms,
  locations,
  cubes = [],
  cubingLocations = [],
  allocation,
}: {
  order: ReceivingOrder;
  rooms: Room[];
  locations: Location[];
  cubes?: ItemCube[];
  cubingLocations?: CubingLocation[];
  allocation: {
    division: string;
    siteId: string;
    projectId: string | null;
    poNumber: string;
    slots: PutawaySlot[];
  };
}) {
  const awaiting = isAwaitingPutaway(order.status);
  const pendingCases = casesPendingPutaway(order);
  const missingLocations = pendingCases.filter((item) => !item.putawayLocationId).length;
  const totalUnits = pendingCases.reduce((sum, item) => sum + item.quantityInCase, 0);
  const locationCodes = useMemo(
    () => new Map(locations.map((location) => [location.id, location.code])),
    [locations],
  );

  if (order.status === "draft" || order.status === "in-progress") {
    return (
      <Card>
        <CardHeader>
          <CardTitle><T>Receiving still open</T></CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground"><T>Finish checking in pallets and cases on the receiving order before putaway can start.</T></p>
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
      <p className="text-sm text-muted-foreground"><T>This receiving order was cancelled and cannot be put away.</T></p>
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
            <p className="text-sm text-muted-foreground"><T>No pallets on this order.</T></p>
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
                          allocation={allocation}
                          cubes={cubes}
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
          lines={pendingCases.map((item) => ({
            id: item.id,
            sku: item.sku,
            quantity: item.quantityInCase,
            locationCode: item.putawayLocationId
              ? locationCodes.get(item.putawayLocationId) ?? item.putawayLocationId
              : null,
            cubeForced: item.cubeForced === true,
          }))}
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
  allocation,
  cubes,
}: {
  orderId: string;
  palletId: string;
  palletNumber: string;
  item: ReceivingOrder["pallets"][number]["cases"][number];
  rooms: Room[];
  locations: Location[];
  cubingLocations: CubingLocation[];
  preferredRoute: "pallet" | "rack" | null;
  allocation: {
    division: string;
    siteId: string;
    projectId: string | null;
    poNumber: string;
    slots: PutawaySlot[];
  };
  cubes: ItemCube[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [forceCube, setForceCube] = useState(item.cubeForced === true);
  const [roomId, setRoomId] = useState(item.putawayRoomId ?? rooms[0]?.id ?? "");
  const [locationId, setLocationId] = useState(item.putawayLocationId ?? "");
  const cube = cubes.find((entry) => entry.sku === item.sku);
  const preview = useMemo(() => {
    if (!locationId || !cube) return null;
    const reserved =
      item.putawayLocationId === locationId
        ? caseCubicInches(item.quantityInCase, cube)
        : 0;
    return allocatePutawayQuantity({
      quantity: item.quantityInCase,
      cubicInchesPerUnit: cube.cubicInches / cube.unitsPerCase,
      projectId: allocation.projectId,
      poNumber: allocation.poNumber,
      sku: item.sku,
      batch: item.batch,
      division: allocation.division,
      siteId: allocation.siteId,
      locationId,
      locations: allocation.slots,
      force: forceCube,
      reservedCubicInches: reserved,
    });
  }, [allocation, cube, forceCube, item, locationId]);
  const cubeById = new Map(cubingLocations.map((location) => [location.id, location]));
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
    startTransition(async () => {
      const result = await assignReceivingPutawayLocation(
        orderId,
        palletId,
        item.id,
        {
          putawayRoomId: roomId || null,
          putawayLocationId: locationId,
          applyToPallet,
          forceCube,
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
      <div className="grid gap-2 sm:grid-cols-2">
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
        <Field label="Location">
          <NativeSelect
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value=""><T>Select location</T></option>
            {roomLocations.map((location) => {
              const cube = cubeById.get(location.id);
              const open = cube
                ? cube.cubeCapacityCubicInches - cube.committedCubicInches
                : null;
              return (
                <option key={location.id} value={location.id}>
                  {location.code}
                  {cube
                    ? ` · ${storageClassLabel(cube.storageClass)} · ${formatCubicInches(Math.max(0, open ?? 0))} open`
                    : ""}
                </option>
              );
            })}
          </NativeSelect>
        </Field>
      </div>
      {preview ? (
        <p className={preview.ok ? "text-xs" : "text-xs text-destructive"}>
          {preview.ok ? preview.verification : preview.error}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={forceCube}
          onChange={(event) => setForceCube(event.target.checked)}
        />
        <T>Force into this location</T>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || (preview != null && !preview.ok)} onClick={() => save(false)}>
          {pending ? "Saving…" : item.putawayLocationId ? "Update location" : "Save location"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || (preview != null && !preview.ok)}
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
  lines,
}: {
  orderId: string;
  totalUnits: number;
  missingLocations: number;
  lines: Array<{
    id: string;
    sku: string;
    quantity: number;
    locationCode: string | null;
    cubeForced: boolean;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const [confirmCubeFit, setConfirmCubeFit] = useState(false);

  return (
    <div className="grid gap-3">
      {missingLocations > 0 ? (
        <p className="text-sm text-muted-foreground">
          {missingLocations} case{missingLocations === 1 ? "" : "s"} still need a
          putaway location.
        </p>
      ) : (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <p className="text-sm"><T>Verify this inventory will fit before it is added to on-hand stock.</T></p>
          <ul className="grid gap-1">
            {lines.map((line) => (
              <li
                key={line.id}
                data-cube-forced={line.cubeForced ? "true" : undefined}
                className={
                  line.cubeForced
                    ? `rounded px-2 py-1 text-xs ${FORCED_CUBE_ROW_CLASS}`
                    : "text-xs text-muted-foreground"
                }
              >
                {line.sku} · {line.quantity} · {line.locationCode ?? "no location"}
                {line.cubeForced ? ` · ${FORCED_CUBE_LABEL}` : ""}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={confirmCubeFit}
              onChange={(event) => setConfirmCubeFit(event.target.checked)}
            />
            <T>I verified this inventory will fit</T>
          </label>
        </div>
      )}
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
          disabled={pending || missingLocations > 0 || !confirmCubeFit}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await completePutaway(orderId, {
                ...largeInputPayload(
                  totalUnits,
                  confirmLargeInput,
                  confirmationQuantity,
                ),
                confirmCubeFit,
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
