"use client";

import { useState } from "react";
import type { InventoryRow, Location } from "@/lib/inventory-schema";
import { InventoryTable } from "@/frontend/client/inventory-table";
import { AdjustmentForm } from "@/frontend/client/adjustment-form";

export function InventoryWorkspace({
  rows,
  locations,
  canAdjust = false,
}: {
  rows: InventoryRow[];
  locations: Location[];
  canAdjust?: boolean;
}) {
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

  return (
    <div
      className={
        canAdjust
          ? "grid gap-6 min-[56rem]:grid-cols-[minmax(0,1fr)_22rem]"
          : "grid gap-6"
      }
    >
      <InventoryTable
        initialRows={rows}
        selectedItemId={selectedItemId}
        onSelectItem={setSelectedItemId}
      />
      {canAdjust ? (
        <AdjustmentForm
          inventory={rows}
          locations={locations}
          selectedItemId={selectedItemId}
          onSelectedItemIdChange={setSelectedItemId}
        />
      ) : null}
    </div>
  );
}
