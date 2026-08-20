"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Location, ReceivingOrder, Room } from "@/lib/inventory-schema";
import { isAwaitingPutaway } from "@/lib/inventory-schema";
import {
  assignReceivingPutawayLocation,
  completePutaway,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LargeInputConfirm, largeInputPayload } from "@/frontend/client/large-input-confirm";
import { LIMITS } from "@/lib/validation/limits";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-destructive">{error}</p>;
}

export function PutawayWorkspace({
  order,
  rooms,
  locations,
}: {
  order: ReceivingOrder;
  rooms: Room[];
  locations: Location[];
}) {
  const awaiting = isAwaitingPutaway(order.status);
  const cases = order.pallets.flatMap((pallet) => pallet.cases);
  const missingLocations = cases.filter((item) => !item.putawayLocationId).length;
  const totalUnits = cases.reduce((sum, item) => sum + item.quantityInCase, 0);
  const locationCodes = useMemo(
    () => new Map(locations.map((location) => [location.id, location.code])),
    [locations],
  );

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
                  Pallet {pallet.palletNumber}
                  {pallet.isPartial ? " · partial" : ""}
                </p>
                <ul className="mt-2 grid gap-3">
                  {pallet.cases.map((item) => (
                    <li key={`${item.id}:${item.putawayLocationId ?? "none"}`}>
                      {awaiting ? (
                        <PutawayCaseRow
                          orderId={order.id}
                          palletId={pallet.id}
                          palletNumber={pallet.palletNumber}
                          item={item}
                          rooms={rooms}
                          locations={locations}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {item.sku} · UPC {item.upc} · qty {item.quantityInCase}
                          {" · "}
                          {item.putawayLocationId
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
}: {
  orderId: string;
  palletId: string;
  palletNumber: string;
  item: ReceivingOrder["pallets"][number]["cases"][number];
  rooms: Room[];
  locations: Location[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState(item.putawayRoomId ?? rooms[0]?.id ?? "");
  const [locationId, setLocationId] = useState(item.putawayLocationId ?? "");
  const roomLocations = locations.filter(
    (location) => location.isActive && location.roomId === roomId,
  );

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
      <p className="text-xs">
        {item.sku} · UPC {item.upc} · qty {item.quantityInCase}
      </p>
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
            <option value="">Select location</option>
            {roomLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code}
              </option>
            ))}
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
}: {
  orderId: string;
  totalUnits: number;
  missingLocations: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");

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
              const result = await completePutaway(
                orderId,
                largeInputPayload(
                  totalUnits,
                  confirmLargeInput,
                  confirmationQuantity,
                ),
              );
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
