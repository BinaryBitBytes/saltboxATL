"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { T, useT } from "@/frontend/client/language";
import {
  initiatePickAllocation,
  initiateSlotting,
  releaseAllocation,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AllocationPickView = {
  orderNumber: string;
  pickRequestNumber: string;
  quantityNeeded: number;
  quantityCovered: number;
};

export type OnHandAllocationRow = {
  inventoryItemId: string;
  sku: string;
  description: string;
  locationCode: string;
  quantity: number;
  allocatable: number;
  picks: AllocationPickView[];
};

export type PendingAllocationLine = {
  caseId: string;
  sku: string;
  description: string;
  quantity: number;
  locationCode: string | null;
  routeLabel: "Full pallet" | "Rack slot" | "Shelf slot" | "Not directed yet";
  picks: AllocationPickView[];
};

export type PendingAllocationOrder = {
  id: string;
  orderNumber: string;
  vendor: string;
  poNumber: string;
  lines: PendingAllocationLine[];
};

export type OpenAllocationRow = {
  id: string;
  kind: "pick" | "slot";
  sku: string;
  quantity: number;
  locationCode: string;
  reference: string;
  picks: AllocationPickView[];
};

function PickReport({ picks }: { picks: AllocationPickView[] }) {
  const t = useT();
  const covered = picks.filter((pick) => pick.quantityCovered > 0);
  if (picks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <T>No open picks for this SKU.</T>
      </p>
    );
  }
  const summary = covered
    .map((pick) => `${pick.quantityCovered} on ${pick.pickRequestNumber} (${pick.orderNumber})`)
    .join(", ");
  const short = covered.some((pick) => pick.quantityCovered < pick.quantityNeeded);
  return (
    <div className="grid gap-1 text-xs">
      {covered.length > 0 ? (
        <p>{t("Could fill {{picks}}.", { picks: summary })}</p>
      ) : (
        <p className="text-muted-foreground">
          <T>No open picks for this SKU.</T>
        </p>
      )}
      {short ? (
        <p className="text-muted-foreground">
          <T>Some open picks still need more of this SKU.</T>
        </p>
      ) : null}
    </div>
  );
}

export function AllocationWorkspace({
  onHand,
  pending,
  openAllocations,
}: {
  onHand: OnHandAllocationRow[];
  pending: PendingAllocationOrder[];
  openAllocations: OpenAllocationRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [working, startTransition] = useTransition();

  function run(key: string, work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      const result = await work();
      setPendingKey(null);
      if (!result.ok) {
        setError(result.error ?? "Unable to update this allocation.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      {error ? <p className="text-sm text-destructive"><T>{error}</T></p> : null}

      <Card>
        <CardHeader>
          <CardTitle><T>On-hand inventory</T></CardTitle>
          <CardDescription>
            <T>Allocate a received line and report the open picks it could fill. The bin stays reserved.</T>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {onHand.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <T>No on-hand inventory to allocate.</T>
            </p>
          ) : (
            <div className="grid gap-3">
              {onHand.map((row) => (
                <OnHandControls
                  key={row.inventoryItemId}
                  row={row}
                  busy={working && pendingKey === row.inventoryItemId}
                  disabled={working}
                  onAllocate={(quantity) =>
                    run(row.inventoryItemId, () =>
                      initiatePickAllocation(row.inventoryItemId, quantity),
                    )
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><T>Pending putaway</T></CardTitle>
          <CardDescription>
            <T>Slot a received line into its shelf, rack, or full pallet location and reserve that slot until putaway posts.</T>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <T>No pending inventory to slot.</T>
            </p>
          ) : (
            pending.map((order) => (
              <div key={order.id} className="grid gap-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {order.orderNumber} · {order.vendor}
                    </p>
                    <p className="text-xs text-muted-foreground">PO {order.poNumber}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={working}
                      onClick={() =>
                        run(order.id, () => initiateSlotting(order.id))
                      }
                    >
                      {working && pendingKey === order.id ? <T>Slotting…</T> : <T>Slot order</T>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/putaway/${order.id}`} />}
                    >
                      <T>Putaway</T>
                    </Button>
                  </div>
                </div>
                {order.lines.map((line) => (
                  <div key={line.caseId} className="grid gap-1 rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs">
                        {line.sku} · {line.quantity} · <T>{line.routeLabel}</T>
                        {line.locationCode ? ` · ${line.locationCode}` : ""}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={working}
                        onClick={() =>
                          run(line.caseId, () => initiateSlotting(order.id, line.caseId))
                        }
                      >
                        {working && pendingKey === line.caseId ? <T>Slotting…</T> : <T>Slot line</T>}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{line.description}</p>
                    <PickReport picks={line.picks} />
                  </div>
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><T>Open allocations</T></CardTitle>
          <CardDescription>
            <T>Reserved location</T>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {openAllocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <T>No open allocations.</T>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><T>Kind</T></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead><T>Quantity</T></TableHead>
                  <TableHead><T>Reserved location</T></TableHead>
                  <TableHead><T>Picks</T></TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openAllocations.map((allocation) => (
                  <TableRow key={allocation.id}>
                    <TableCell>{allocation.kind === "pick" ? <T>Allocate for picks</T> : <T>Slot line</T>}</TableCell>
                    <TableCell>
                      {allocation.sku}
                      <p className="text-xs text-muted-foreground">{allocation.reference}</p>
                    </TableCell>
                    <TableCell>{allocation.quantity}</TableCell>
                    <TableCell>{allocation.locationCode}</TableCell>
                    <TableCell>
                      <PickReport picks={allocation.picks} />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={working}
                        onClick={() =>
                          run(allocation.id, () => releaseAllocation(allocation.id))
                        }
                      >
                        {working && pendingKey === allocation.id ? <T>Releasing…</T> : <T>Release</T>}
                      </Button>
                    </TableCell>
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

function OnHandControls({
  row,
  busy,
  disabled,
  onAllocate,
}: {
  row: OnHandAllocationRow;
  busy: boolean;
  disabled: boolean;
  onAllocate: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(row.allocatable);

  return (
    <div className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {row.sku} · {row.locationCode}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.description} · <T>Quantity</T> {row.quantity}
            {row.allocatable < row.quantity ? ` · ${row.allocatable} free` : ""}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-xs">
            <T>Quantity</T>
            <Input
              type="number"
              min={1}
              max={row.allocatable}
              value={quantity}
              disabled={disabled || row.allocatable <= 0}
              onChange={(event) => setQuantity(Number(event.target.value))}
              className="w-24"
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={
              disabled ||
              row.allocatable <= 0 ||
              !Number.isInteger(quantity) ||
              quantity < 1 ||
              quantity > row.allocatable
            }
            onClick={() => onAllocate(quantity)}
          >
            {busy ? <T>Allocating…</T> : <T>Allocate for picks</T>}
          </Button>
        </div>
      </div>
      <PickReport picks={row.picks} />
    </div>
  );
}
