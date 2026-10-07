"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ItemCube, Pallet } from "@/lib/inventory-schema";
import { cubingWorkflow, type CubingLocation } from "@/lib/cubing/workflow";
import { profilesFromCubes } from "@/lib/cubing/capacity";
import { formatCubicInches } from "@/lib/cubing/measure";
import { breakDownReceivingPallet } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";

export function PalletCubeDirective({
  orderId,
  pallet,
  cubes,
  locations,
  canBreakDown,
}: {
  orderId: string;
  pallet: Pallet;
  cubes: ItemCube[];
  locations: CubingLocation[];
  canBreakDown: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pendingCases = pallet.cases.filter((item) => !item.putawayPostedAt);
  const plan = cubingWorkflow({
    cases: pendingCases.map((item) => ({
      id: item.id,
      sku: item.sku,
      quantity: item.quantityInCase,
    })),
    cubes: profilesFromCubes(cubes),
    locations,
  });

  if (plan.status === "empty") return null;

  return (
    <div className="grid gap-2 border-t border-border px-3 py-3">
      <p className="text-xs font-medium">
        Cubing
        {plan.totalCubicInches > 0
          ? ` · ${formatCubicInches(plan.totalCubicInches)}`
          : ""}
        {pallet.cubeRoute === "rack"
          ? " · directed to a racked location"
          : pallet.cubeRoute === "pallet"
            ? " · directed to a full pallet location"
            : ""}
      </p>
      <p className="text-xs text-muted-foreground">{plan.directive}</p>
      {plan.status === "missing-cube" ? (
        <Link href="/cubing" className="text-xs underline">
          Open the Cubing tab
        </Link>
      ) : null}
      {canBreakDown && plan.status === "break-down" ? (
        <div>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await breakDownReceivingPallet(orderId, pallet.id);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              });
            }}
          >
            {pending
              ? "Breaking down…"
              : `Break down to ${plan.loads[0]?.caseCount ?? 0} cases`}
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
